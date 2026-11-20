// @vitest-environment jsdom
/** T-242 内联评审报告：取数通道与失败提示；确认与改稿在文档操作栏。T-286：操作栏随文档标签切换。T-287：报告只渲染一份 Markdown，采纳/放弃与报告时间进操作栏。 */
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

  it('历史轮次逐轮可打开报告，时刻按可读格式展示', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    expect(element('requirement-report-history-toggle')).toBeNull()
    const items = container.querySelectorAll('[data-testid="requirement-review-history-item"]')
    expect(items).toHaveLength(1)
    expect(items[0]?.getAttribute('data-round')).toBe('1')
    expect(items[0]?.textContent).toContain('2026-11-17 10:00')
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
    expect(element('requirement-action-result')?.textContent).toContain('REQ-01 已过审')
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

  it('待处置评审送审即锁定：文档操作栏的修改需求禁用，改走报告里的采纳/放弃', async () => {
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
    expect(element('requirement-review-pending-reason')?.textContent).toBe(
      'R2 评审待处理：当前需求版本已锁定，请在下方表格逐条确认「采纳 / 拒绝 / 有疑问」后提交。',
    )
  })
})

describe('评审结论三态与处置动作', () => {
  it('报告与草稿标签各自只给当前文档的动作，标签栏在操作栏上方', async () => {
    await renderDetail(REVIEWED, callsOf())
    const tabs = element('requirement-doc-tabs') as HTMLElement
    const actions = element('requirement-actions') as HTMLElement
    expect(tabs.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(element('requirement-actions-review')?.getAttribute('data-round')).toBe('2')
    expect(element('requirement-review-accept')).not.toBeNull()
    expect(element('requirement-review-reject')).not.toBeNull()
    expect(element('requirement-actions-draft')?.hasAttribute('hidden')).toBe(true)
    expect(element('requirement-detail-review')?.closest('[hidden]')).not.toBeNull()

    await pressSelector('[data-testid="requirement-doc-tab-draft"]')
    expect(element('requirement-actions-review')).toBeNull()
    expect(element('requirement-review-accept')).toBeNull()
    expect(element('requirement-actions-draft')?.hasAttribute('hidden')).toBe(false)
    expect(element('requirement-detail-review')).not.toBeNull()
    expect(element('requirement-document-body')).not.toBeNull()
  })

  it('待处理轮次的结论由标签徽标表达，操作栏只给采纳与放弃并标出报告时间', async () => {
    await renderDetail(REVIEWED, callsOf())
    const tab = element('requirement-doc-tab-review')
    expect(tab?.getAttribute('data-decision')).toBe('pending')
    expect(tab?.textContent).toContain('待处理')
    expect(element('requirement-timeline-review-status')?.textContent).toContain('待处理')
    expect(element('requirement-review-accept')?.textContent).toContain('提交所选处理')
    expect(countText('accepted')).toBe('采纳 0')
    expect(countText('questioned')).toBe('待澄清 0')
    expect(countText('rejected')).toBe('拒绝 0')
    expect(element('requirement-review-reject')?.textContent).toContain('整轮放弃（全部不改）')
    expect(element('requirement-review-at')?.textContent).toBe('2026-11-17 11:00')
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
    expect(element('requirement-action-result')?.textContent).toContain('改稿指令已发送')
  })

  it('放弃本轮意见走 decide 命令并刷新投影；采纳生成新版后解锁复评', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    await press('requirement-review-reject')
    expect(commands).toEqual(['/requirement_review_decide REQ-01 2 rejected'])
    expect(calls.reload).toHaveBeenCalledTimes(1)
    expect(element('requirement-action-result')?.getAttribute('data-ok')).toBe('true')

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
    const tab = element('requirement-doc-tab-review')
    expect(tab?.getAttribute('data-decision')).toBe('accepted')
    expect(tab?.textContent).toContain('已采纳（→ v3）')
    expect(element('requirement-review-decision')).toBeNull()
    expect(element('requirement-review-status')).toBeNull()
    expect((element('requirement-detail-review') as HTMLButtonElement).disabled).toBe(false)
    expect(element('requirement-guide')?.textContent).toContain('已生成 v3')
  })

  it('历史轮次逐轮展示结论徽标，待处理的可一键标记放弃', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    const items = container.querySelectorAll('[data-testid="requirement-review-history-item"]')
    expect(items).toHaveLength(1)
    const historyStatus = items[0]?.querySelector('[data-testid="requirement-review-history-status"]')
    expect(historyStatus?.getAttribute('data-decision')).toBe('pending')
    const reject = items[0]?.querySelector('[data-testid="requirement-review-history-reject"]')
    expect(reject).not.toBeNull()
    await act(async () => {
      ;(reject as HTMLElement).click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(commands).toEqual(['/requirement_review_decide REQ-01 1 rejected'])
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
    await renderDetail(REVIEWED, callsOf())
    await pressSelector('[data-testid="requirement-review-filter"][data-priority="high"]')
    expect(container.querySelectorAll('[data-testid="requirement-review-todo-row"]')).toHaveLength(1)
    await pressSelector('[data-testid="requirement-review-filter"][data-priority="all"]')
    expect(container.querySelectorAll('[data-testid="requirement-review-todo-row"]')).toHaveLength(3)

    await applyBatch('highOnly')
    expect(countText('accepted')).toBe('采纳 1')
    expect(countText('rejected')).toBe('拒绝 2')
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

  it('待处理报告标签不再显示只读徽标，已处置轮次仍显示', async () => {
    await renderDetail(REVIEWED, callsOf())
    expect(element('requirement-doc-tab-review')?.getAttribute('data-decision')).toBe('pending')
    expect(element('requirement-doc-tab-review')?.querySelector('[data-state="locked"]')).toBeNull()

    const decided: RequirementDocRow = {
      ...REVIEWED,
      reviews: REVIEWED.reviews.map(review => ({ ...review, decision: 'accepted' as const })),
    }
    await renderDetail(decided, callsOf())
    expect(element('requirement-doc-tab-review')?.querySelector('[data-state="locked"]')).not.toBeNull()
  })

  it('报告时间与 Markdown 切换同处第三层操作行右侧的元信息组', async () => {
    await renderDetail(REVIEWED, callsOf())
    const meta = container.querySelector('.requirement-review-meta')
    expect(meta).not.toBeNull()
    expect(meta?.querySelector('[data-testid="requirement-review-at"]')?.textContent).toBe('2026-11-17 11:00')
    expect(meta?.querySelector('[data-testid="requirement-report-markdown-toggle"]')).not.toBeNull()
    expect(container.querySelector('.review-report-topbar')).toBeNull()
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

  it('三态 active 分色、拒绝行删除线、展开卡片与摘要两行截断都有规则', () => {
    expect(css).toContain(".verdict-button.is-active[data-verdict='accept']")
    expect(css).toContain('color-mix(in oklab, var(--success) 18%, var(--surface))')
    expect(css).toContain(".verdict-button.is-active[data-verdict='reject']")
    expect(css).toContain(".verdict-button.is-active[data-verdict='question']")
    expect(css).toContain('.review-todo-row.is-rejected .review-todo-title strong { text-decoration: line-through; }')
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
})

describe('T-290 评审操作层级与展开布局', () => {
  beforeEach(() => { reportText = STRUCTURED_REPORT })

  it('操作栏只有一个主提交与一个次放弃，计数徽标在主按钮旁，元信息在另一侧', async () => {
    reportText = STRUCTURED_REPORT
    await renderDetail(REVIEWED, callsOf())
    const actions = element('requirement-actions-review') as HTMLElement
    expect(actions.querySelectorAll('[data-testid="requirement-review-accept"]')).toHaveLength(1)
    expect(actions.querySelectorAll('[data-testid="requirement-review-reject"]')).toHaveLength(1)
    const primary = actions.querySelector('.review-primary-action') as HTMLElement
    expect(primary).not.toBeNull()
    expect(primary.querySelector('[data-testid="requirement-review-accept"]')).not.toBeNull()
    expect(primary.querySelectorAll('[data-testid="requirement-review-count"]')).toHaveLength(3)
    expect(primary.querySelector('[data-testid="requirement-review-reject"]')).toBeNull()
    const meta = actions.querySelector('.requirement-review-meta') as HTMLElement
    expect(meta.querySelector('[data-testid="requirement-review-at"]')).not.toBeNull()
    expect(meta.querySelector('[data-testid="requirement-report-markdown-toggle"]')).not.toBeNull()
    expect(primary.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('优先级筛选是连体分段控件，四项各带计数且只有一个选中', async () => {
    reportText = STRUCTURED_REPORT
    await renderDetail(REVIEWED, callsOf())
    const segments = Array.from(container.querySelectorAll('[data-testid="requirement-review-filter"]'))
    expect(segments).toHaveLength(4)
    expect(segments.map(node => node.getAttribute('data-priority'))).toEqual(['all', 'high', 'medium', 'low'])
    expect(segments.map(node => node.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
    expect(segments[0]?.textContent).toContain('全部 3')
    expect(segments[1]?.textContent).toContain('高优 1')
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
})
