// @vitest-environment jsdom
/** T-242 内联评审报告：取数通道与失败提示；确认与改稿在文档操作栏。T-286：操作栏随文档标签切换。T-287：报告只渲染一份 Markdown，采纳/放弃与报告时间进操作栏。T-333：已处置评审结论压成一行，意见列表转轻量只读。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { RequirementDetail } from '../src/pages/requirement-detail.tsx'
import type { ReviewDecisions } from '../src/intake/prompts.ts'
import type { ProposalRow, RequirementDocRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const REVIEWED: RequirementDocRow = {
  id: 'REQ-01',
  title: '评审需求',
  text: '需求正文',
  state: 'draft',
  options: [],
  versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }],
  reviews: [
    { round: 2, at: '2026-11-17T11:00:00+08:00', report: 'requirements/REQ-01/reviews/R2.md' },
    { round: 1, at: '2026-11-17T10:00:00+08:00', report: 'requirements/REQ-01/reviews/R1.md' },
  ],
}

/** 结构化报告：带分类、优先级与四要素，驱动紧凑表与逐条裁决。 */
const STRUCTURED_REPORT = `## 摘要

整体需要改，重点是边界与验收。

## 待改项

### 文档完备性

- **代发订单边界未写清**。位置：正文「范围」一节。问题：只写了普通订单。建议：补上代发订单不参与佣金。优先级：高

### 合理性

- 位置：验收口径。问题：异常返回码缺失。建议：补一条异常返回码。【中】

### 需求角度

- 位置：背景。建议：删掉无关的竞品对比。优先级：低`

/** 不带分类标题的报告：级别列表头退化为单列，优先级徽标仍保留语义色。 */
const NO_CATEGORY_REPORT = `## 摘要

整体需要改。

## 待改项

- **边界未写清**。位置：正文。问题：缺边界。建议：补边界。优先级：高
- 位置：验收。建议：补异常码。【中】`

/** 七条意见的报告：超过筛选条的五条阈值，可按高/中/低过滤。 */
const DENSE_REPORT = `## 摘要

整体需要改，边界与验收都要补。

## 待改项

- 位置：正文「范围」。问题：缺边界一。建议：补边界一。优先级：高
- 位置：正文「范围」。问题：缺边界二。建议：补边界二。优先级：高
- 位置：正文「范围」。问题：缺边界三。建议：补边界三。优先级：高
- 位置：正文「范围」。问题：缺边界四。建议：补边界四。优先级：高
- 位置：验收口径。问题：缺异常码一。建议：补异常码一。优先级：中
- 位置：验收口径。问题：缺异常码二。建议：补异常码二。优先级：中
- 位置：背景。建议：删掉无关的竞品对比。优先级：低`

/** 六条同优先级意见：条数过阈值但优先级没有区分度，筛选条同样收起。 */
const SINGLE_PRIORITY_REPORT = `## 摘要

整体需要改。

## 待改项

${Array.from({ length: 6 }, (_, index) => `- 位置：正文。问题：缺边界 ${String(index + 1)}。建议：补边界。优先级：高`).join('\n')}`

/** 已采纳并产出新版本：结论行给出完整说法与版本入口。 */
const ACCEPTED: RequirementDocRow = {
  ...REVIEWED,
  versions: [
    { n: 1, at: '2026-11-17T09:00:00+08:00' },
    { n: 2, at: '2026-11-17T12:00:00+08:00' },
    { n: 3, at: '2026-11-17T13:00:00+08:00' },
  ],
  reviews: [
    {
      round: 2,
      at: '2026-11-17T11:00:00+08:00',
      report: 'requirements/REQ-01/reviews/R2.md',
      decision: 'accepted',
      decidedAt: '2026-11-17T12:00:00+08:00',
      appliedVersion: 3,
    },
    {
      round: 1,
      at: '2026-11-17T10:00:00+08:00',
      report: 'requirements/REQ-01/reviews/R1.md',
      decision: 'rejected',
    },
  ],
}

const UNREVIEWED: RequirementDocRow = {
  id: 'REQ-02',
  title: '未评审需求',
  text: '正文',
  state: 'draft',
  options: [],
  versions: [],
  reviews: [],
}

function projectionOf(row: RequirementDocRow, proposals: readonly ProposalRow[] = []): SpecProjection {
  return {
    tasks: [],
    rules: [],
    contracts: [],
    proposals,
    requirements: [row],
    groups: [],
    roles: [],
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    problems: [],
  }
}

let container: HTMLDivElement
let root: Root
let reads: { readonly scope: string; readonly path: string }[]
let commands: string[]
let failRead = false
let reportText: string | null = null

async function fakeCall(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  if (namespace === 'workspaceFiles' && method === 'read') {
    const path = typeof args.path === 'string' ? args.path : ''
    reads.push({ scope: String(args.workspaceFileScopeId), path })
    if (failRead) return { ok: false, error: { code: 'ENOENT', message: '文件不存在' } }
    return { ok: true, value: { text: reportText ?? `# 评审结论 ${path}` } }
  }
  if (namespace === 'commands' && method === 'execute') {
    commands.push(String(args.line))
    return { ok: true, value: { result: { kind: 'success', text: 'REQ-01 已过审' } } }
  }
  throw new Error(`未预期调用 ${namespace}/${method}`)
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  reads = []
  commands = []
  failRead = false
  reportText = null
  Object.defineProperty(window, 'lcoder', { configurable: true, value: { call: vi.fn(fakeCall) } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
})

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

/** 主提交按钮旁的计数徽标文本。 */
function countText(kind: 'accepted' | 'questioned' | 'rejected'): string | null {
  return container.querySelector(`[data-testid="requirement-review-count"][data-kind="${kind}"]`)?.textContent ?? null
}

/** 展开批量菜单并点击其中一项。 */
async function applyBatch(action: string): Promise<void> {
  await press('requirement-review-batch-trigger')
  await pressSelector(`[data-testid="requirement-review-batch"][data-action="${action}"]`)
}

interface DetailCalls {
  readonly readers: string[]
  readonly revise: Mock<(decisions?: ReviewDecisions) => Promise<{ readonly ok: boolean; readonly message: string }>>
  readonly modifyRequest: Mock<() => void>
  readonly reload: Mock<() => void>
}

function callsOf(): DetailCalls {
  return {
    readers: [],
    revise: vi.fn(async () => ({ ok: true, message: '改稿指令已发送' })),
    modifyRequest: vi.fn(),
    reload: vi.fn(),
  }
}

async function renderDetail(
  row: RequirementDocRow,
  calls: DetailCalls,
  proposals: readonly ProposalRow[] = [],
): Promise<void> {
  act(() => {
    root.render(
      <RequirementDetail
        row={row}
        project={PROJECT}
        projection={projectionOf(row, proposals)}
        sessions={[]}
        onClose={() => {}}
        onOpenTask={() => {}}
        onOpenReader={(path) => { calls.readers.push(path) }}
        onReload={calls.reload}
        onSplit={async () => ({ ok: true, message: 'ok' })}
        onReview={async () => ({ ok: true, message: 'ok' })}
        onRevise={calls.revise}
        onModifyRequest={calls.modifyRequest}
        onCreateBased={async () => ({ ok: true, message: 'ok' })}
        onOpenTasks={() => {}}
      />,
    )
  })
  await act(async () => { await Promise.resolve() })
}

async function press(testId: string): Promise<void> {
  const node = element(testId)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function pressSelector(selector: string): Promise<void> {
  const node = container.querySelector(selector)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

/** 走原生 setter 触发 React 的受控输入更新。 */
async function typeTextarea(selector: string, value: string): Promise<void> {
  const node = container.querySelector<HTMLTextAreaElement>(selector)
  expect(node).not.toBeNull()
  if (node === null) return
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('内联评审报告', () => {
  it('报告标签直接渲染完整 Markdown，取数走作用域会话与 .spec 相对路径', async () => {
    await renderDetail(REVIEWED, callsOf())
    const section = element('requirement-review-report')
    expect(section?.getAttribute('data-round')).toBe('2')
    expect(reads).toEqual([{ scope: 'session-scope', path: '.spec/requirements/REQ-01/reviews/R2.md' }])
    const body = element('requirement-report-body')
    expect(body?.textContent).toContain('评审结论 .spec/requirements/REQ-01/reviews/R2.md')
    expect(body?.querySelector('h1')).not.toBeNull()
    expect(body?.classList.contains('document-body')).toBe(true)
    // 报告只画一遍：没有摘要卡、摘录与收起开关。
    expect(element('requirement-report-summary')).toBeNull()
    expect(element('requirement-report-excerpt')).toBeNull()
    expect(element('requirement-report-toggle')).toBeNull()
  })

  it('轮次增加后重读新报告，全文换新', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    const next: RequirementDocRow = {
      ...REVIEWED,
      reviews: [...REVIEWED.reviews, { round: 3, at: '2026-11-17T12:00:00+08:00', report: 'requirements/REQ-01/reviews/R3.md' }],
    }
    await renderDetail(next, calls)
    expect(element('requirement-review-report')?.getAttribute('data-round')).toBe('3')
    expect(reads[reads.length - 1]?.path).toBe('.spec/requirements/REQ-01/reviews/R3.md')
    expect(element('requirement-report-body')?.textContent).toContain('R3.md')
  })

  it('历史抽屉逐轮可打开报告，时刻按可读格式展示', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    const items = container.querySelectorAll('[data-testid="requirement-review-history-item"]')
    expect(items).toHaveLength(2)
    expect(items[0]?.getAttribute('data-round')).toBe('2')
    expect(items[1]?.getAttribute('data-round')).toBe('1')
    expect(items[1]?.textContent).toContain('2026-11-17 10:00')
    await pressSelector('[data-testid="requirement-review-history-item"][data-round="1"] [data-testid="requirement-open-report"]')
    expect(calls.readers).toEqual(['.spec/requirements/REQ-01/reviews/R1.md'])
  })

  it('读取失败给可读错误，正文不再渲染', async () => {
    failRead = true
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    expect(element('requirement-report-failed')?.textContent).toContain('评审报告读取失败')
    expect(element('requirement-report-failed')?.textContent).toContain('ENOENT')
    expect(element('requirement-report-body')).toBeNull()
    expect(element('requirement-report-open')).toBeNull()
    expect(calls.readers).toEqual([])
  })

  it('未评审时给空态文案，也不发读取请求', async () => {
    await renderDetail(UNREVIEWED, callsOf())
    expect(element('requirement-report-empty')?.textContent).toContain('还没有评审报告')
    expect(element('requirement-report-summary')).toBeNull()
    expect(reads).toHaveLength(0)
  })
})

describe('文档操作栏的确认与改稿', () => {
  it('确认需求仍走人机命令，成功后展示回执', async () => {
    const resolved: RequirementDocRow = {
      ...REVIEWED,
      reviews: REVIEWED.reviews.map(review => ({ ...review, decision: 'accepted' as const })),
    }
    await renderDetail(resolved, callsOf())
    const approve = element('requirement-approve') as HTMLButtonElement
    expect(approve.disabled).toBe(false)
    await press('requirement-approve')
    expect(commands).toEqual(['/requirement_approve REQ-01'])
    expect(element('requirement-action-result')).toBeNull()
  })

  it('已确认状态不再渲染确认与改稿按钮，改动走基于此版本新建', async () => {
    const confirmed: RequirementDocRow = { ...REVIEWED, state: 'confirmed' }
    await renderDetail(confirmed, callsOf())
    expect(element('requirement-approve')).toBeNull()
    expect(element('requirement-detail-revise')).toBeNull()
    expect(element('requirement-detail-create-based')).not.toBeNull()
  })

  it('报告依据正文被 patch 改动后不再叠加第二条黄色横幅，报告仍按原依据保留', async () => {
    const stale: RequirementDocRow = {
      ...REVIEWED,
      reviews: REVIEWED.reviews.map(review => ({ ...review, baseContent: '# 报告依据的原正文' })),
    }
    await renderDetail(stale, callsOf())
    expect(element('requirement-review-report')).not.toBeNull()
    expect(element('requirement-report-body')).not.toBeNull()
    expect(element('requirement-report-baseline-changed')).toBeNull()

    const same: RequirementDocRow = {
      ...REVIEWED,
      reviews: REVIEWED.reviews.map(review => ({ ...review, baseContent: REVIEWED.text })),
    }
    await renderDetail(same, callsOf())
    expect(element('requirement-report-baseline-changed')).toBeNull()
  })

  it('待处置评审送审即锁定：修改需求禁用，正文面黄条可一键回评审面', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    const revise = element('requirement-detail-revise') as HTMLButtonElement
    expect(revise).not.toBeNull()
    expect(revise.disabled).toBe(true)
    expect(revise.title).toContain('送审后已锁定')
    await press('requirement-detail-revise')
    expect(calls.modifyRequest).not.toHaveBeenCalled()
    expect(calls.revise).not.toHaveBeenCalled()
    expect(element('requirement-action-result')).toBeNull()
    // 评审面下方就是裁决栏，不重复顶部黄条；正文面才给带跳转入口的黄条。
    expect(element('requirement-review-pending-reason')).toBeNull()
    await pressSelector('[data-testid="requirement-workface-body"]')
    expect(element('requirement-review-pending-reason')?.textContent).toContain(
      'R2 评审待处理：当前需求版本已锁定',
    )
    expect(element('requirement-goto-review')).not.toBeNull()
    await press('requirement-goto-review')
    expect(element('requirement-workface-review')?.getAttribute('data-active')).toBe('true')
  })
})

describe('评审结论三态与处置动作', () => {
  it('报告标签展示评审决策栏，草稿按钮统一位于顶部操作栏', async () => {
    await renderDetail(REVIEWED, callsOf())
    const tabs = element('requirement-doc-tabs') as HTMLElement
    const actions = element('requirement-actions') as HTMLElement
    expect(tabs.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(element('requirement-actions-review')?.getAttribute('data-round')).toBe('2')
    expect(element('requirement-review-accept')).not.toBeNull()
    expect(element('requirement-review-reject')).not.toBeNull()
    expect(element('requirement-global-actions')?.querySelector('[data-testid="requirement-detail-review"]')).not.toBeNull()

    await pressSelector('[data-testid="requirement-workface-body"]')
    expect(element('requirement-actions-review')).toBeNull()
    expect(element('requirement-review-accept')).toBeNull()
    expect(element('requirement-actions')?.hasAttribute('hidden')).toBe(true)
    expect(element('requirement-detail-review')).not.toBeNull()
    expect(element('requirement-document-body')).not.toBeNull()
  })

  it('待处理轮次的结论由标签徽标表达，操作栏只给采纳与放弃并隐藏无用时间戳', async () => {
    await renderDetail(REVIEWED, callsOf())
    const tab = element('requirement-workface-review')
    expect(tab?.getAttribute('data-pending')).toBe('true')
    expect(tab?.textContent).toContain('待处理')
    expect(element('requirement-workface-pending-badge')?.textContent).toContain('待处理')
    expect(element('requirement-timeline-review-status')?.textContent).toContain('待处理')
    expect(element('requirement-review-accept')?.textContent).toContain('提交所选处理')
    expect(countText('accepted')).toBeNull()
    expect(countText('questioned')).toBeNull()
    expect(countText('rejected')).toBeNull()
    expect(element('requirement-review-reject')?.textContent).toContain('放弃本轮')
    expect(element('requirement-review-at')).toBeNull()
    // 采纳走 requirement_revise 直接落新版本，「去顶部对比」的灰字提示已删除。
    expect(element('requirement-review-accept-hint')).toBeNull()
  })

  it('采纳意见走改稿回调，默认把全部条目作为采纳项传给 onRevise', async () => {
    reportText = STRUCTURED_REPORT
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    const accept = element('requirement-review-accept') as HTMLButtonElement
    expect(accept.disabled).toBe(false)
    expect(countText('accepted')).toBe('采纳 3')
    expect(countText('questioned')).toBe('待澄清 0')
    expect(countText('rejected')).toBe('拒绝 0')
    await press('requirement-review-accept')
    expect(calls.revise).toHaveBeenCalledTimes(1)
    expect(calls.revise.mock.calls[0]?.[0]).toEqual({
      accepted: ['代发订单边界未写清', '验收口径', '背景'],
      questioned: [],
      rejected: [],
    })
    expect(element('requirement-action-result')).toBeNull()
  })

  it('放弃本轮意见走 decide 命令并刷新投影；采纳生成新版后解锁复评', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    await press('requirement-review-reject')
    expect(commands).toEqual(['/requirement_review_decide REQ-01 2 rejected'])
    expect(calls.reload).toHaveBeenCalledTimes(1)
    expect(element('requirement-action-result')).toBeNull()

    const accepted: RequirementDocRow = {
      ...REVIEWED,
      versions: [...REVIEWED.versions, { n: 3, at: '2026-11-17T12:00:00+08:00' }],
      reviews: [
        {
          round: 2,
          at: '2026-11-17T11:00:00+08:00',
          report: 'requirements/REQ-01/reviews/R2.md',
          decision: 'accepted',
          decidedAt: '2026-11-17T12:00:00+08:00',
          appliedVersion: 3,
        },
        {
          round: 1,
          at: '2026-11-17T10:00:00+08:00',
          report: 'requirements/REQ-01/reviews/R1.md',
          decision: 'rejected',
        },
      ],
    }
    await renderDetail(accepted, calls)
    const tab = element('requirement-workface-review')
    expect(tab?.getAttribute('data-pending')).toBe('false')
    expect(element('requirement-timeline-review-status')?.textContent).toContain('已采纳')
    expect(element('requirement-review-decision')).toBeNull()
    expect(element('requirement-review-status')).toBeNull()
    expect((element('requirement-detail-review') as HTMLButtonElement).disabled).toBe(false)
    expect(element('requirement-guide')).toBeNull()
  })

  it('历史轮次逐轮展示结论徽标，待处理的可一键标记放弃', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    const items = container.querySelectorAll('[data-testid="requirement-review-history-item"]')
    expect(items).toHaveLength(2)
    const pending = container.querySelector('[data-testid="requirement-review-history-item"][data-round="2"]')
    const historyStatus = pending?.querySelector('[data-testid="requirement-review-history-status"]')
    expect(historyStatus?.getAttribute('data-decision')).toBe('pending')
    const reject = pending?.querySelector('[data-testid="requirement-review-history-reject"]')
    expect(reject).not.toBeNull()
    await act(async () => {
      ;(reject as HTMLElement).click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(commands).toEqual(['/requirement_review_decide REQ-01 2 rejected'])
    expect(calls.reload).toHaveBeenCalledTimes(1)
  })

  it('有待对比的改稿提案时，待处置原因之外补一条去对比提示', async () => {
    const proposal: ProposalRow = {
      id: 'P-01',
      title: '改稿提案',
      problem: '代发订单边界',
      options: [],
      recommendation: '补边界',
      decision: 'draft',
      decidedAt: null,
      requirementChange: {
        mode: 'patch',
        target: 'REQ-01',
        baseContent: '旧正文',
        content: '新正文',
        analysis: '分析',
      },
    }
    await renderDetail(REVIEWED, callsOf(), [proposal])
    expect(element('requirement-review-proposal-hint')?.textContent).toContain('去对比')
  })
})

describe('结构化待改项表格与逐条裁决', () => {
  beforeEach(() => { reportText = STRUCTURED_REPORT })

  it('默认只渲染摘要条与单行紧凑表，不渲染 Markdown 文字墙与长问题正文', async () => {
    await renderDetail(REVIEWED, callsOf())
    expect(element('requirement-review-summary-bar')?.textContent).toContain('整体需要改，重点是边界与验收。')
    expect(element('requirement-review-todos')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="requirement-review-todo-row"]')).toHaveLength(3)
    const firstRow = container.querySelector('[data-testid="requirement-review-todo-row"][data-index="0"]')
    expect(firstRow?.textContent).toContain('代发订单边界未写清')
    expect(firstRow?.textContent).toContain('文档完备性')
    expect(container.textContent).not.toContain('补上代发订单不参与佣金')
    expect(container.textContent).not.toContain('异常返回码缺失')
    expect(element('requirement-report-body')).toBeNull()
  })

  it('点击行在原位展开详情卡片，位置只在卡片顶部出现一次，问题/建议/输入上下通栏', async () => {
    await renderDetail(REVIEWED, callsOf())
    // 主表三列，不再有「涉及位置」列；位置只在展开卡片里出现一次。
    const headers = Array.from(container.querySelectorAll('.review-todo-table thead th'))
    expect(headers).toHaveLength(3)
    expect(headers.some(th => (th.textContent ?? '').includes('涉及位置'))).toBe(false)
    expect(container.querySelector('.review-todo-location')).toBeNull()

    const row = container.querySelector('[data-testid="requirement-review-todo-row"][data-index="0"]')
    expect(row?.className).not.toContain('is-expanded')
    expect(row?.querySelector('.review-todo-arrow svg')).not.toBeNull()
    expect(row?.textContent).not.toContain('▸')

    await pressSelector('[data-testid="requirement-review-todo-row"][data-index="0"]')
    const detail = element('requirement-review-todo-detail')
    expect(detail?.className).toContain('todo-detail-row')
    expect(detail?.getAttribute('data-index')).toBe('0')
    expect(row?.className).toContain('is-expanded')
    expect(row?.querySelector('.review-todo-arrow svg')).not.toBeNull()
    expect(row?.textContent).not.toContain('▾')
    expect(detail?.querySelector('.todo-detail-card')).not.toBeNull()
    expect(detail?.querySelectorAll('.todo-detail-location-inline')).toHaveLength(1)
    expect(detail?.querySelector('.todo-detail-location-inline')?.textContent).toContain('正文「范围」一节')
    expect(detail?.querySelector('td')?.getAttribute('colspan')).toBe('3')
    // 位置不重复占列，也不再作为 h6 分区出现。
    expect(Array.from(detail?.querySelectorAll('h6') ?? []).some(h => h.textContent?.includes('涉及位置'))).toBe(false)
    expect(detail?.querySelectorAll('.todo-detail-block')).toHaveLength(3)
    expect(detail?.textContent).toContain('⚠️问题说明')
    expect(detail?.textContent).toContain('💡修改建议')
    expect(detail?.textContent).toContain('💬疑问或指定改法')
    expect(detail?.textContent).toContain('只写了普通订单')
    expect(detail?.textContent).toContain('补上代发订单不参与佣金')
    const note = detail?.querySelector<HTMLTextAreaElement>('[data-testid="requirement-review-todo-note"]')
    expect(note).not.toBeNull()
    expect(note?.getAttribute('rows')).toBe('1')
    await pressSelector('[data-testid="requirement-review-todo-row"][data-index="0"]')
    expect(element('requirement-review-todo-detail')).toBeNull()
  })

  it('切换三态并把疑问与补充改法作为结构化 decisions 传给 onRevise', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    await pressSelector('[data-testid="requirement-review-todo-verdict"][data-index="0"][data-verdict="reject"]')
    await pressSelector('[data-testid="requirement-review-todo-verdict"][data-index="1"][data-verdict="question"]')
    await typeTextarea('[data-testid="requirement-review-todo-note"][data-index="1"]', '必须补 500 返回码吗？')
    await pressSelector('[data-testid="requirement-review-todo-row"][data-index="2"]')
    await typeTextarea('[data-testid="requirement-review-todo-note"][data-index="2"]', '用表格列出边界')

    const accept = element('requirement-review-accept') as HTMLButtonElement
    expect(countText('accepted')).toBe('采纳 1')
    expect(countText('questioned')).toBe('待澄清 1')
    expect(countText('rejected')).toBe('拒绝 1')
    expect(accept.getAttribute('data-accepted')).toBe('1')
    await press('requirement-review-accept')
    expect(calls.revise.mock.calls[0]?.[0]).toEqual({
      accepted: ['背景（补充改法：用表格列出边界）'],
      questioned: [{ item: '验收口径', question: '必须补 500 返回码吗？' }],
      rejected: ['代发订单边界未写清'],
    })
  })

  it('有疑问但未填写说明时主动作禁用并提示先填写', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    await pressSelector('[data-testid="requirement-review-todo-verdict"][data-index="0"][data-verdict="question"]')
    const accept = element('requirement-review-accept') as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    expect(accept.title).toContain('有疑问的条目请先填写疑问或指定改法')
    await typeTextarea('[data-testid="requirement-review-todo-note"][data-index="0"]', '请解释边界')
    expect((element('requirement-review-accept') as HTMLButtonElement).disabled).toBe(false)
  })

  it('分段筛选过滤表格行，批量菜单三项一次性改写裁决', async () => {
    reportText = DENSE_REPORT
    await renderDetail(REVIEWED, callsOf())
    await pressSelector('[data-testid="requirement-review-filter"][data-priority="high"]')
    expect(container.querySelectorAll('[data-testid="requirement-review-todo-row"]')).toHaveLength(4)
    await pressSelector('[data-testid="requirement-review-filter"][data-priority="all"]')
    expect(container.querySelectorAll('[data-testid="requirement-review-todo-row"]')).toHaveLength(7)

    await applyBatch('highOnly')
    expect(countText('accepted')).toBe('采纳 4')
    expect(countText('rejected')).toBe('拒绝 3')
    await applyBatch('allReject')
    const accept = element('requirement-review-accept') as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    expect(accept.title).toContain('若全部不改请点右侧放弃本轮意见')
    await applyBatch('allAccept')
    expect((element('requirement-review-accept') as HTMLButtonElement).disabled).toBe(false)
  })

  it('切换 Markdown 原文后只显示全文，切回恢复结构化表', async () => {
    await renderDetail(REVIEWED, callsOf())
    await press('requirement-report-markdown-toggle')
    expect(element('requirement-report-body')?.textContent).toContain('代发订单边界未写清')
    expect(element('requirement-review-todos')).toBeNull()
    await press('requirement-report-markdown-toggle')
    expect(element('requirement-report-body')).toBeNull()
    expect(element('requirement-review-todos')).not.toBeNull()
  })

  it('优先级徽标带 data-priority 语义色属性，不再被 tag 类压成灰片', async () => {
    await renderDetail(REVIEWED, callsOf())
    const chips = Array.from(container.querySelectorAll('.review-todo-priority'))
    expect(chips.map(chip => chip.getAttribute('data-priority'))).toEqual(['high', 'medium', 'low'])
    expect(chips.map(chip => chip.textContent)).toEqual(['高', '中', '低'])
    for (const chip of chips) expect(chip.classList.contains('tag')).toBe(false)
  })

  it('三态裁决按钮按 verdict 给出独立 active 类，有疑问时输入框展开三行', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    await pressSelector('[data-testid="requirement-review-todo-verdict"][data-index="0"][data-verdict="reject"]')
    const rejected = container.querySelector('[data-testid="requirement-review-todo-verdict"][data-index="0"][data-verdict="reject"]')
    expect(rejected?.classList.contains('is-active')).toBe(true)
    expect(rejected?.classList.contains('is-active-reject')).toBe(true)
    expect(container.querySelector('[data-testid="requirement-review-todo-verdict"][data-index="0"][data-verdict="accept"]')?.classList.contains('is-active')).toBe(false)

    await pressSelector('[data-testid="requirement-review-todo-verdict"][data-index="1"][data-verdict="question"]')
    const question = container.querySelector('[data-testid="requirement-review-todo-verdict"][data-index="1"][data-verdict="question"]')
    expect(question?.classList.contains('is-active-question')).toBe(true)
    const note = container.querySelector<HTMLTextAreaElement>('[data-testid="requirement-review-todo-note"][data-index="1"]')
    expect(note?.getAttribute('rows')).toBe('3')
    expect(calls.revise).not.toHaveBeenCalled()
  })

  it('核心摘要默认折叠两行，点击摘要条展开并再次收起', async () => {
    await renderDetail(REVIEWED, callsOf())
    expect(element('requirement-review-summary-bar')?.getAttribute('data-expanded')).toBe('false')
    expect(element('requirement-review-summary-bar')?.classList.contains('is-summary-expanded')).toBe(false)
    expect(element('requirement-review-summary-toggle')?.querySelector('svg')).not.toBeNull()
    await press('requirement-review-summary-bar')
    expect(element('requirement-review-summary-bar')?.getAttribute('data-expanded')).toBe('true')
    expect(element('requirement-review-summary-bar')?.classList.contains('is-summary-expanded')).toBe(true)
    await press('requirement-review-summary-bar')
    expect(element('requirement-review-summary-bar')?.getAttribute('data-expanded')).toBe('false')
  })

  it('批量裁决收进单个菜单，三项保留 testid 与 data-action，默认收起且可 Esc 关闭', async () => {
    await renderDetail(REVIEWED, callsOf())
    const trigger = element('requirement-review-batch-trigger') as HTMLButtonElement
    expect(trigger).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-testid="requirement-review-batch"]')).toHaveLength(0)

    await press('requirement-review-batch-trigger')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const batch = Array.from(container.querySelectorAll('[data-testid="requirement-review-batch"]'))
    expect(batch.map(node => node.getAttribute('data-action'))).toEqual(['allAccept', 'highOnly', 'allReject'])
    for (const node of batch) expect(node.classList.contains('review-batch-menu-item')).toBe(true)
    expect(container.querySelector('.review-batch-trigger svg')).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(element('requirement-review-batch-trigger')?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-testid="requirement-review-batch"]')).toHaveLength(0)
  })

  it('待处置评审面显示待处理高亮，已处置评审面转成一行结论', async () => {
    await renderDetail(REVIEWED, callsOf())
    expect(element('requirement-workface-review')?.getAttribute('data-pending')).toBe('true')
    expect(element('requirement-workface-pending-badge')).not.toBeNull()
    expect(element('requirement-review-decided')).toBeNull()

    const decided: RequirementDocRow = {
      ...REVIEWED,
      reviews: REVIEWED.reviews.map(review => ({ ...review, decision: 'accepted' as const })),
    }
    reportText = STRUCTURED_REPORT
    await renderDetail(decided, callsOf())
    expect(element('requirement-workface-review')?.getAttribute('data-pending')).toBe('false')
    const decidedBar = element('requirement-review-decided-bar')
    expect(decidedBar).not.toBeNull()
    expect(decidedBar?.contains(element('requirement-review-decided'))).toBe(true)
    expect(element('requirement-review-decided')?.textContent).toBe('第 2 轮评审 · 已采纳 · 11-17')
    expect(decidedBar?.querySelector('.review-decided-dot')?.getAttribute('data-decision')).toBe('accepted')
    expect(element('requirement-review-decided-status')).toBeNull()
    // 单版本需求没有批注入口，原文入口改为文字链接。
    expect(element('requirement-review-open-changes')).toBeNull()
    expect(element('requirement-report-markdown-toggle')?.textContent).toBe('查看评审原文')
    expect(element('requirement-review-batch-trigger')).toBeNull()
    expect(container.querySelector('.review-todo-table thead')).toBeNull()
    expect(container.querySelector('.review-todo-table.is-readonly')).not.toBeNull()
    expect(container.querySelectorAll('.review-todo-verdict')).toHaveLength(0)
    await pressSelector('[data-testid="requirement-review-todo-row"][data-index="0"]')
    const detailCell = container.querySelector('.todo-detail-row td') as HTMLTableCellElement | null
    expect(detailCell?.colSpan).toBe(2)
  })

  it('不再显示评审时间戳，Markdown 原文图标按钮随视图留在下方工具栏', async () => {
    await renderDetail(REVIEWED, callsOf())
    expect(element('requirement-review-at')).toBeNull()
    const toolbar = element('requirement-review-toolbar')
    const toggle = toolbar?.querySelector('[data-testid="requirement-report-markdown-toggle"]')
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-label')).toBe('查看报告 Markdown 原文')
    expect(container.querySelector('.review-report-topbar')).toBeNull()

    await press('requirement-report-markdown-toggle')
    const docToolbar = element('requirement-review-report')?.querySelector('.requirement-doc-toolbar')
    const backToggle = docToolbar?.querySelector('[data-testid="requirement-report-markdown-toggle"]')
    expect(backToggle).not.toBeNull()
    expect(backToggle?.getAttribute('aria-label')).toBe('收起 Markdown 原文')
  })

  it('整份报告都无分类时表头只显示级别，级别列标记收窄', async () => {
    reportText = NO_CATEGORY_REPORT
    await renderDetail(REVIEWED, callsOf())
    const table = container.querySelector('.review-todo-table')
    expect(table?.getAttribute('data-has-category')).toBe('false')
    expect(table?.querySelector('th')?.textContent).toBe('级别')
  })
})

describe('评审表样式契约', () => {
  const css = readFileSync(resolve(process.cwd(), 'packages/lcoder/client/src/pages/workbench.css'), 'utf8')

  it('优先级语义色是高对比危险红/警告琥珀，低与未标注为中性灰', () => {
    expect(css).toContain(".review-todo-priority[data-priority='high']")
    expect(css).toContain('color-mix(in oklab, var(--danger) 16%, var(--surface))')
    expect(css).toContain(".review-todo-priority[data-priority='medium']")
    expect(css).toContain('color-mix(in oklab, var(--warning) 16%, var(--surface))')
    expect(css).toContain(".review-todo-priority[data-priority='low'],")
    expect(css).toContain(".review-todo-priority[data-priority='none']")
    expect(css).toContain("[data-has-category='false'] th:nth-child(1) { width: 76px; }")
  })

  it('三态 active 分色、展开卡片与摘要两行截断都有规则，拒绝行不再弱化', () => {
    expect(css).toContain(".verdict-button.is-active[data-verdict='accept']")
    expect(css).toContain('color-mix(in oklab, var(--success) 18%, var(--surface))')
    expect(css).toContain(".verdict-button.is-active[data-verdict='reject']")
    expect(css).toContain(".verdict-button.is-active[data-verdict='question']")
    expect(css).not.toContain('.review-todo-row.is-rejected')
    expect(css).toContain('.review-todo-table tbody tr.todo-detail-row:hover { background: var(--surface); }')
    expect(css).toMatch(/\.todo-detail-card \{[^}]*border: 1px solid var\(--border\);/)
    expect(css).not.toMatch(/\.todo-detail-card \{[^}]*border-left/)
    expect(css).toContain('-webkit-line-clamp: 2;')
  })

  it('行高 42px、斑马纹与 13.5px 标题字号落到 CSS', () => {
    expect(css).toContain('height: 42px;')
    expect(css).toContain('.review-todo-table tbody tr:nth-child(even)')
    expect(css).toContain('font-size: 13.5px; font-weight: 600;')
    expect(css).toContain('padding: 4px 10px;')
    expect(css).toContain('border-radius: 999px;')
  })

  it('黄色横幅只自带左边框且留底部间距，表格与卡片用中性容器不贯穿警示色条', () => {
    expect(css).toContain('border-left: 4px solid var(--warning);')
    expect(css).toMatch(/\.detail-warning \{[^}]*margin: 6px 0 10px;[^}]*\}/)
    expect(css).not.toContain("detail-section[data-doc-active='true'][data-pending-report='true'] { box-shadow: inset 3px 0 0 var(--warning); }")
    expect(css).toContain('.review-todo-table th:nth-child(3) { width: 200px; }')
    expect(css).not.toContain('.review-todo-location')
    expect(css).toContain('.review-segmented {')
    expect(css).toContain('.review-batch-menu {')
  })

  it('结论行是纯文字加圆点，摘要条用浅底提示块，只读列表有自己的分隔线', () => {
    expect(css).toContain(".review-decided-dot[data-decision='accepted'] { background: var(--success); }")
    expect(css).toContain(".review-decided-dot[data-decision='rejected'] { background: var(--muted); }")
    expect(css).toMatch(/\.review-summary-bar \{[^}]*border: 0;/)
    expect(css).toContain('.review-summary-bar:hover { background:')
    expect(css).not.toContain('.review-summary-bar:hover { border-color: var(--accent); }')
    expect(css).toContain('.review-todo-table.is-readonly { min-width: 0; }')
    expect(css).toContain('.review-todo-table.is-readonly tbody tr.review-todo-row > td { box-shadow: inset 0 -1px 0 var(--separator); }')
  })
})

describe('T-290 评审操作层级与展开布局', () => {
  beforeEach(() => { reportText = STRUCTURED_REPORT })

  it('操作栏只保留主提交与次放弃，裁决计数与 Markdown 图标切换在下方工具栏右侧', async () => {
    reportText = STRUCTURED_REPORT
    await renderDetail(REVIEWED, callsOf())
    const actions = element('requirement-actions-review') as HTMLElement
    expect(actions.querySelectorAll('[data-testid="requirement-review-accept"]')).toHaveLength(1)
    expect(actions.querySelectorAll('[data-testid="requirement-review-reject"]')).toHaveLength(1)
    expect(actions.querySelectorAll('[data-testid="requirement-review-count"]')).toHaveLength(0)
    expect(actions.querySelector('[data-testid="requirement-report-markdown-toggle"]')).toBeNull()
    expect(actions.querySelector('[data-testid="requirement-review-at"]')).toBeNull()

    const toolbar = element('requirement-review-toolbar') as HTMLElement
    const right = toolbar.querySelector('.review-toolbar-right') as HTMLElement
    expect(right).not.toBeNull()
    expect(right.querySelectorAll('[data-testid="requirement-review-count"]')).toHaveLength(3)
    expect(right.querySelector('[data-testid="requirement-report-markdown-toggle"]')).not.toBeNull()
  })

  it('优先级筛选是连体分段控件，四项各带计数且只有一个选中', async () => {
    reportText = DENSE_REPORT
    await renderDetail(REVIEWED, callsOf())
    const segments = Array.from(container.querySelectorAll('[data-testid="requirement-review-filter"]'))
    expect(segments).toHaveLength(4)
    expect(segments.map(node => node.getAttribute('data-priority'))).toEqual(['all', 'high', 'medium', 'low'])
    expect(segments.map(node => node.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
    expect(segments[0]?.textContent).toContain('全部 7')
    expect(segments[1]?.textContent).toContain('高 4')
    expect(segments[2]?.textContent).toContain('中 2')
    expect(segments.every(node => node.classList.contains('review-segment'))).toBe(true)
    expect(segments[0]?.parentElement?.classList.contains('review-segmented')).toBe(true)
    await pressSelector('[data-testid="requirement-review-filter"][data-priority="medium"]')
    const after = Array.from(container.querySelectorAll('[data-testid="requirement-review-filter"]'))
    expect(after.map(node => node.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false'])
  })

  it('批量菜单默认收起，点击遮罩即关闭，三项不会常驻筛选行', async () => {
    await renderDetail(REVIEWED, callsOf())
    const toolbar = element('requirement-review-toolbar') as HTMLElement
    expect(toolbar.querySelector('[data-testid="requirement-review-batch"]')).toBeNull()
    await press('requirement-review-batch-trigger')
    expect(toolbar.querySelectorAll('[data-testid="requirement-review-batch"]')).toHaveLength(3)
    expect(element('requirement-review-batch-backdrop')).not.toBeNull()
    await press('requirement-review-batch-backdrop')
    expect(toolbar.querySelectorAll('[data-testid="requirement-review-batch"]')).toHaveLength(0)
  })

  it('三态互斥，点击裁决不触发展开，切到有疑问自动展开并聚焦输入', async () => {
    await renderDetail(REVIEWED, callsOf())
    const verdict = (option: string) => container.querySelector(`[data-testid="requirement-review-todo-verdict"][data-index="0"][data-verdict="${option}"]`)
    await pressSelector('[data-testid="requirement-review-todo-verdict"][data-index="0"][data-verdict="accept"]')
    expect(verdict('accept')?.classList.contains('is-active')).toBe(true)
    await pressSelector('[data-testid="requirement-review-todo-verdict"][data-index="0"][data-verdict="reject"]')
    expect(verdict('accept')?.classList.contains('is-active')).toBe(false)
    expect(verdict('reject')?.classList.contains('is-active')).toBe(true)
    expect(element('requirement-review-todo-detail')).toBeNull()
    expect(element('requirement-review-todo-row')?.getAttribute('data-verdict')).toBe('reject')

    await pressSelector('[data-testid="requirement-review-todo-verdict"][data-index="0"][data-verdict="question"]')
    expect(element('requirement-review-todo-detail')?.getAttribute('data-index')).toBe('0')
    const note = container.querySelector('[data-testid="requirement-review-todo-note"][data-index="0"]')
    expect(document.activeElement).toBe(note)
  })

  it('结论为可以确认且无待改项时渲染确认通过按钮，点击后发送 accepted 裁决并刷新', async () => {
    reportText = '## 结论\n可以确认\n\n## 待改项\n无'
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)

    expect(element('requirement-review-accept')).toBeNull()
    const passBtn = element('requirement-review-pass') as HTMLButtonElement | null
    expect(passBtn).not.toBeNull()
    expect(passBtn?.disabled).toBe(false)
    expect(passBtn?.textContent).toBe('确认通过')
    expect(element('requirement-review-reject')).not.toBeNull()

    await press('requirement-review-pass')
    expect(commands).toContain('/requirement_review_decide REQ-01 2 accepted')
    expect(calls.reload).toHaveBeenCalledTimes(1)
  })
})

describe('T-333 已处置评审的只读视图', () => {
  beforeEach(() => { reportText = STRUCTURED_REPORT })

  it('结论是一行完整文字，右侧并列版本改动与原文文字链接', async () => {
    await renderDetail(ACCEPTED, callsOf())
    await press('requirement-workface-review')
    expect(element('requirement-review-decided')?.textContent).toBe('第 2 轮评审 · 已采纳，已改进为 v3 · 11-17')
    const bar = element('requirement-review-decided-bar') as HTMLElement
    expect(bar.querySelector('.review-decided-dot')?.getAttribute('data-decision')).toBe('accepted')
    expect(element('requirement-review-open-changes')?.textContent).toBe('查看 v3 的修改 →')
    expect(element('requirement-report-markdown-toggle')?.textContent).toBe('查看评审原文')
    expect(bar.querySelectorAll('.link-button')).toHaveLength(2)
    // 三条意见没有筛选需要，工具栏整体收起。
    expect(element('requirement-review-toolbar')).toBeNull()
  })

  it('查看 v3 的修改回到正文、展开批注并按该版本筛选', async () => {
    await renderDetail(ACCEPTED, callsOf())
    await press('requirement-workface-review')
    await press('requirement-review-open-changes')
    expect(element('requirement-workface-body')?.getAttribute('data-active')).toBe('true')
    expect(element('requirement-annotation-track')).not.toBeNull()
    const filter = container.querySelector('[data-testid="requirement-annotation-filter"][data-version="3"]')
    expect(filter?.getAttribute('aria-pressed')).toBe('true')
    expect(reads.filter(read => read.path.includes('/versions/'))).toHaveLength(3)
  })

  it('批注数据没有该版本时筛选回退全部，不留空列表', async () => {
    const stale: RequirementDocRow = {
      ...ACCEPTED,
      versions: ACCEPTED.versions.slice(0, 2),
      reviews: ACCEPTED.reviews.map(review => review.round === 2 ? { ...review, appliedVersion: 9 } : review),
    }
    await renderDetail(stale, callsOf())
    await press('requirement-workface-review')
    await press('requirement-review-open-changes')
    const all = container.querySelector('[data-testid="requirement-annotation-filter"][data-version="all"]')
    expect(all?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid="requirement-annotation-filter"][data-version="9"]')).toBeNull()
  })

  it('只读时原文链接留在结论行，切换后文案变成返回意见列表', async () => {
    await renderDetail(ACCEPTED, callsOf())
    await press('requirement-workface-review')
    await press('requirement-report-markdown-toggle')
    expect(element('requirement-report-body')?.textContent).toContain('代发订单边界未写清')
    expect(element('requirement-review-todos')).toBeNull()
    expect(element('requirement-report-markdown-toggle')?.textContent).toBe('返回意见列表')
    await press('requirement-report-markdown-toggle')
    expect(element('requirement-report-body')).toBeNull()
    expect(element('requirement-review-todos')).not.toBeNull()
  })

  it('意见不超过 5 条时不渲染筛选条，意见照常全部列出', async () => {
    await renderDetail(REVIEWED, callsOf())
    expect(element('requirement-review-toolbar')).not.toBeNull()
    expect(container.querySelector('.review-segmented')).toBeNull()
    expect(container.querySelectorAll('[data-testid="requirement-review-todo-row"]')).toHaveLength(3)
  })

  it('优先级只有一种时不渲染筛选条，六条意见全部列出', async () => {
    reportText = SINGLE_PRIORITY_REPORT
    await renderDetail(REVIEWED, callsOf())
    expect(container.querySelector('.review-segmented')).toBeNull()
    expect(container.querySelectorAll('[data-testid="requirement-review-todo-row"]')).toHaveLength(6)
  })

  it('只读列表无表头与裁决，左侧 Chip 用分类、备注无内容时整块隐藏', async () => {
    await renderDetail(ACCEPTED, callsOf())
    await press('requirement-workface-review')
    expect(container.querySelector('.review-todo-table thead')).toBeNull()
    const rows = Array.from(container.querySelectorAll('[data-testid="requirement-review-todo-row"]'))
    expect(rows).toHaveLength(3)
    const first = rows[0]
    expect(first?.querySelector('.review-todo-priority')?.textContent).toBe('文档完备性')
    expect(first?.querySelector('.review-todo-category')).toBeNull()
    expect(first?.querySelector('.review-todo-title-inner')?.lastElementChild?.classList.contains('review-todo-arrow')).toBe(true)
    await pressSelector('[data-testid="requirement-review-todo-row"][data-index="0"]')
    const detail = element('requirement-review-todo-detail')
    expect(detail?.querySelector('.todo-detail-problem')).not.toBeNull()
    expect(detail?.querySelector('.todo-detail-suggestion')).not.toBeNull()
    expect(detail?.querySelector('.todo-detail-note')).toBeNull()
    expect(detail?.querySelector('textarea')).toBeNull()
  })
})
