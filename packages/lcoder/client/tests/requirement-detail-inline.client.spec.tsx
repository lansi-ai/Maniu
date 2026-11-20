// @vitest-environment jsdom
/** T-281：详情同窗编排——内联正文、说明栏、差异内嵌、分层 Esc 与只读红线。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { RequirementDetail, type ModifyState, type RequirementDetailProps } from '../src/pages/requirement-detail.tsx'
import type { ProposalRow, RequirementChangeRow, RequirementDocRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const BODY = '# 佣金改造\n\n## 验收\n\n- 自营订单按下限兜底\n\n| 场景 | 口径 |\n| --- | --- |\n| 自营 | 兜底 |\n'

const DRAFT: RequirementDocRow = {
  id: 'REQ-01',
  title: '佣金改造',
  text: BODY,
  state: 'draft',
  options: [],
  openedAt: '2026-11-17T09:00:00+08:00',
  versions: [
    { n: 1, at: '2026-11-17T09:00:00+08:00' },
    { n: 2, at: '2026-11-17T11:00:00+08:00' },
  ],
  reviews: [],
}

const CHANGE: RequirementChangeRow = {
  mode: 'patch',
  target: 'REQ-01',
  baseContent: BODY,
  content: '# 佣金改造\n\n## 验收\n\n- 自营订单免佣',
  analysis: '按用户说明改了佣金口径。',
}

const PROPOSAL: ProposalRow = {
  id: 'P-01',
  title: '佣金改造修改',
  problem: '按用户说明修改',
  options: [],
  recommendation: '建议采纳。',
  decision: 'draft',
  decidedAt: null,
  requirementChange: CHANGE,
}

function projectionOf(requirements: readonly RequirementDocRow[]): SpecProjection {
  return {
    tasks: [],
    rules: [],
    contracts: [],
    proposals: [],
    requirements,
    groups: [],
    roles: [],
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    problems: [],
    flow: null,
  }
}

let container: HTMLDivElement
let root: Root
let commands: string[]
let calls: {
  close: Mock<() => void>
  modifyRequest: Mock<() => void>
  textChange: Mock<(text: string) => void>
  submit: Mock<() => void>
  cancel: Mock<() => void>
  viewDiff: Mock<() => void>
  closeDiff: Mock<() => void>
  applied: Mock<() => void>
  reload: Mock<() => void>
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  commands = []
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(async (namespace: string, method: string, args: Record<string, unknown>) => {
        if (namespace === 'commands' && method === 'execute') {
          commands.push(String(args.line))
          return { ok: true, value: { result: { kind: 'success', text: '已应用' } } }
        }
        if (namespace === 'workspaceFiles' && method === 'read') {
          return { ok: true, value: { text: BODY } }
        }
        return { ok: true, value: {} }
      }),
    },
  })
  calls = {
    close: vi.fn(),
    modifyRequest: vi.fn(),
    textChange: vi.fn(),
    submit: vi.fn(),
    cancel: vi.fn(),
    viewDiff: vi.fn(),
    closeDiff: vi.fn(),
    applied: vi.fn(),
    reload: vi.fn(),
  }
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

async function press(testId: string): Promise<void> {
  const node = element(testId)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await Promise.resolve()
  })
}

function esc(): void {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
}

interface RenderExtra {
  readonly row?: RequirementDocRow | undefined
  readonly modify?: ModifyState | undefined
  readonly patchProposal?: ({ readonly proposal: ProposalRow; readonly change: RequirementChangeRow }) | undefined
  readonly diffOpen?: boolean | undefined
  readonly readerOpen?: boolean | undefined
}

let currentProps: RequirementDetailProps

function render(extra: RenderExtra = {}): void {
  const row = extra.row ?? DRAFT
  currentProps = {
    row,
    project: PROJECT,
    projection: projectionOf([row]),
    sessions: [],
    onClose: calls.close,
    onOpenTask: () => {},
    onOpenReader: () => {},
    onReload: calls.reload,
    onSplit: async () => ({ ok: true, message: '' }),
    onReview: async () => ({ ok: true, message: '' }),
    onRevise: async () => ({ ok: true, message: '' }),
    onModifyRequest: calls.modifyRequest,
    onCreateBased: async () => ({ ok: true, message: '' }),
    onOpenTasks: () => {},
    modify: extra.modify,
    onModifyTextChange: calls.textChange,
    onModifySubmit: calls.submit,
    onModifyCancel: calls.cancel,
    patchProposal: extra.patchProposal,
    diffOpen: extra.diffOpen,
    onViewDiff: calls.viewDiff,
    onCloseDiff: calls.closeDiff,
    onApplied: calls.applied,
    readerOpen: extra.readerOpen,
  }
  act(() => { root.render(<RequirementDetail {...currentProps} />) })
}

function modifyOf(partial: Partial<ModifyState>): ModifyState {
  return { open: true, text: '', status: 'idle', ...partial }
}

describe('草稿顶部入口按送审锁定门禁分流', () => {
  it('无评审与已采纳产出未审新版时可改，待处置轮次锁定改稿入口', async () => {
    const withReviews: readonly RequirementDocRow[] = [
      { ...DRAFT, reviews: [] },
      { ...DRAFT, reviews: [{ round: 1, at: '2026-11-17T10:30:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', role: 'maniu-pm' }] },
      { ...DRAFT, reviews: [{ round: 1, at: '2026-11-17T10:30:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', role: 'maniu-pm', decision: 'accepted', appliedVersion: 2 }] },
    ]
    const expectedDisabled = [false, true, false]
    withReviews.forEach((row, index) => {
      render({ row })
      const revise = element('requirement-detail-revise') as HTMLButtonElement
      expect(revise).not.toBeNull()
      expect(revise.disabled).toBe(expectedDisabled[index])
    })
    // 当前停在已采纳且产出 v2 的可改状态，点击仍走打开说明栏回调。
    await press('requirement-detail-revise')
    expect(calls.modifyRequest).toHaveBeenCalledTimes(1)
  })

  it('非草稿与只读文档没有修改入口', () => {
    for (const state of ['confirmed', 'released', 'closed', 'unknown'] as const) {
      render({ row: { ...DRAFT, state } })
      expect(element('requirement-detail-revise')).toBeNull()
    }
  })
})

describe('内联正文', () => {
  it('正文容器带 markdown-body 语义排版与不透明表面类，开箱即读', () => {
    render()
    const body = element('requirement-document-body') as HTMLElement
    expect(body.className).toContain('markdown-body')
    expect(body.className).toContain('document-body')
    expect(body.querySelector('h1')?.textContent).toContain('佣金改造')
    expect(body.querySelector('h2')?.textContent).toContain('验收')
    expect(body.querySelector('table')).not.toBeNull()
    expect(body.querySelector('ol, ul')).not.toBeNull()
  })

  it('展开收起说明栏不重置正文阅读位置（正文容器不卸载）', () => {
    render()
    const bodyBefore = element('requirement-document-body')
    const scroll = container.querySelector('.detail-drawer-body') as HTMLElement
    scroll.scrollTop = 140
    render({ modify: modifyOf({ text: '要改的点' }) })
    expect(element('requirement-document-body')).toBe(bodyBefore)
    expect(scroll.scrollTop).toBe(140)
    render({ modify: undefined })
    expect(element('requirement-document-body')).toBe(bodyBefore)
    expect(scroll.scrollTop).toBe(140)
  })
})

describe('同窗说明栏', () => {
  it('展开后自动聚焦输入框；空白说明不可提交；取消只回调收起', async () => {
    render({ modify: modifyOf({ text: '   ' }) })
    expect(document.activeElement).toBe(element('requirement-modify-note'))
    expect((element('requirement-modify-start') as HTMLButtonElement).disabled).toBe(true)
    await press('requirement-modify-cancel')
    expect(calls.cancel).toHaveBeenCalledTimes(1)
    expect(calls.submit).not.toHaveBeenCalled()
  })

  it('非空说明可提交；生成中禁用重复提交，失败保留说明与原因可重试', () => {
    render({ modify: modifyOf({ text: '改佣金口径' }) })
    expect((element('requirement-modify-start') as HTMLButtonElement).disabled).toBe(false)
    render({ modify: modifyOf({ text: '改佣金口径', status: 'running' }) })
    expect((element('requirement-modify-start') as HTMLButtonElement).disabled).toBe(true)
    expect(element('requirement-modify-generating')).not.toBeNull()
    render({ modify: modifyOf({ text: '改佣金口径', status: 'failed', error: '会话建立失败' }) })
    expect(element('requirement-modify-failed')?.textContent).toContain('会话建立失败')
    expect((element('requirement-modify-note') as HTMLTextAreaElement).value).toBe('改佣金口径')
    expect((element('requirement-modify-start') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('提案与差异在同一详情', () => {
  const ready = modifyOf({ text: '改佣金口径', status: 'ready' })

  it('提案就绪不自动切走，查看差异后才内嵌展示，返回正文不另开弹窗', async () => {
    render({ modify: ready, patchProposal: { proposal: PROPOSAL, change: CHANGE } })
    expect(element('requirement-document-body')).not.toBeNull()
    expect(element('requirement-inline-compare')).toBeNull()
    expect(element('requirement-modify-view-diff')).not.toBeNull()
    await press('requirement-modify-view-diff')
    expect(calls.viewDiff).toHaveBeenCalledTimes(1)

    render({ modify: ready, patchProposal: { proposal: PROPOSAL, change: CHANGE }, diffOpen: true })
    expect(element('requirement-inline-compare')).not.toBeNull()
    expect(element('proposal-compare')).toBeNull()
    expect(element('compare-entries')).not.toBeNull()
    expect(element('compare-close')?.textContent).toContain('返回正文')
    expect(element('compare-apply-hint')?.textContent).toContain('不生成新版本')
    await press('compare-close')
    expect(calls.closeDiff).toHaveBeenCalledTimes(1)

    render({ modify: ready, patchProposal: { proposal: PROPOSAL, change: CHANGE } })
    expect(element('requirement-document-body')).not.toBeNull()
    expect(element('requirement-inline-compare')).toBeNull()
  })

  it('应用修改复用 /proposal_approve，只回刷新与应用回调，不升版不处置评审', async () => {
    render({ modify: ready, patchProposal: { proposal: PROPOSAL, change: CHANGE }, diffOpen: true })
    await press('compare-approve')
    expect(commands).toEqual(['/proposal_approve P-01'])
    expect(calls.reload).toHaveBeenCalledTimes(1)
    expect(calls.applied).toHaveBeenCalledTimes(1)
    expect(calls.closeDiff).toHaveBeenCalledTimes(1)
    expect(commands.some(line => line.includes('version') || line.includes('review_decide'))).toBe(false)
  })

  it('拒绝不改正文、不升版，只走 /proposal_reject', async () => {
    render({ modify: ready, patchProposal: { proposal: PROPOSAL, change: CHANGE }, diffOpen: true })
    await press('compare-reject')
    expect(commands).toEqual(['/proposal_reject P-01'])
    expect(calls.applied).not.toHaveBeenCalled()
  })
})

describe('键盘分层退出', () => {
  it('差异 → 说明栏 → 详情依次 Esc，阅读层打开时详情不抢 Esc', () => {
    render({ modify: modifyOf({ text: 'x' }), patchProposal: { proposal: PROPOSAL, change: CHANGE }, diffOpen: true })
    esc()
    expect(calls.closeDiff).toHaveBeenCalledTimes(1)
    expect(calls.cancel).not.toHaveBeenCalled()
    expect(calls.close).not.toHaveBeenCalled()

    render({ modify: modifyOf({ text: 'x' }) })
    esc()
    expect(calls.cancel).toHaveBeenCalledTimes(1)
    expect(calls.close).not.toHaveBeenCalled()

    render()
    esc()
    expect(calls.close).toHaveBeenCalledTimes(1)

    render({ readerOpen: true })
    esc()
    expect(calls.close).toHaveBeenCalledTimes(1)
  })

  it('版本对照打开时 Esc 先关对照，不关详情', async () => {
    render()
    await press('requirement-compare-version')
    expect(element('requirement-version-compare')).not.toBeNull()
    esc()
    expect(element('requirement-version-compare')).toBeNull()
    expect(calls.close).not.toHaveBeenCalled()
  })
})
