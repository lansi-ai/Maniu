// @vitest-environment jsdom
/** T-249：提案对比视图——new 全文、revise 逐条目差异加两栏对照、确认拒绝走人机命令并刷新投影。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProposalCompare } from '../src/pages/proposal-compare.tsx'
import type { ProposalRow, RequirementChangeRow, RequirementDocRow } from '../src/spec/rows.ts'

const OLD_BODY = '# 佣金改造\n\n- 自营订单按下限兜底\n\n## 验收\n\n- 佣金不为负'
const NEW_BODY = '# 佣金改造\n\n- 自营订单免佣\n\n## 验收\n\n- 自营佣金为 0\n- 代发保持原费率'

const TARGET: RequirementDocRow = {
  id: 'REQ-01',
  title: '佣金改造',
  text: OLD_BODY,
  state: 'draft',
  options: [],
  versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }, { n: 2, at: '2026-11-17T10:00:00+08:00' }],
  reviews: [],
}

function proposalOf(change: RequirementChangeRow): ProposalRow {
  return {
    id: 'P-01',
    title: '佣金改造',
    problem: change.analysis,
    options: [],
    recommendation: '建议采纳。',
    decision: 'draft',
    decidedAt: null,
    requirementChange: change,
  }
}

const REVISE: RequirementChangeRow = { mode: 'revise', target: 'REQ-01', baseVersion: 2, content: NEW_BODY, analysis: '与现有需求不冲突；影响面集中在结算。' }
const NEW: RequirementChangeRow = { mode: 'new', content: NEW_BODY, analysis: '与现有需求不冲突；建议优先级高。' }

let container: HTMLDivElement
let root: Root
let commandLines: string[]
let readPaths: string[]
let commandAnswer: { readonly ok: boolean; readonly text: string }
let readAnswer: { readonly ok: boolean; readonly text: string }

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  commandLines = []
  readPaths = []
  commandAnswer = { ok: true, text: '已批准' }
  readAnswer = { ok: true, text: OLD_BODY }
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(async (namespace: string, method: string, args: Record<string, unknown>) => {
        if (namespace === 'commands' && method === 'execute') {
          commandLines.push(String(args.line))
          return { ok: true, value: { result: { kind: commandAnswer.ok ? 'success' : 'error', text: commandAnswer.text } } }
        }
        if (namespace === 'workspaceFiles' && method === 'read') {
          readPaths.push(String(args.path))
          return readAnswer.ok
            ? { ok: true, value: { text: readAnswer.text } }
            : { ok: false, error: { code: 'lcoder/spec-missing', message: 'not found' } }
        }
        return { ok: true, value: {} }
      }),
    },
  })
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
    await Promise.resolve()
  })
}

interface Callbacks {
  readonly reload: () => void
  readonly close: () => void
}

async function renderCompare(change: RequirementChangeRow, callbacks: Callbacks): Promise<void> {
  await act(async () => {
    root.render(
      <ProposalCompare
        proposal={proposalOf(change)}
        change={change}
        requirements={[TARGET]}
        scopeSessionId="session-scope"
        onClose={callbacks.close}
        onReload={callbacks.reload}
      />,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('提案对比视图', () => {
  it('new：展示分析结论与新条目全文，确认走 /proposal_approve 并刷新关闭', async () => {
    const callbacks = { reload: vi.fn(() => {}), close: vi.fn(() => {}) }
    await renderCompare(NEW, callbacks)

    expect(element('proposal-compare')).not.toBeNull()
    expect(element('compare-analysis')?.textContent).toContain('与现有需求不冲突')
    expect(element('compare-new-body')?.textContent).toContain('自营订单免佣')
    expect(element('compare-old')).toBeNull()

    await press('compare-approve')
    expect(commandLines).toEqual(['/proposal_approve P-01'])
    expect(callbacks.reload).toHaveBeenCalledTimes(1)
    expect(callbacks.close).toHaveBeenCalledTimes(1)
  })

  it('revise：读基线快照，列变更条目，两栏全文对照着色', async () => {
    const callbacks = { reload: vi.fn(() => {}), close: vi.fn(() => {}) }
    await renderCompare(REVISE, callbacks)

    expect(readPaths).toEqual(['.spec/requirements/REQ-01/versions/v2.md'])
    const entries = [...container.querySelectorAll('[data-testid="compare-entry"]')]
    expect(entries.map(node => node.getAttribute('data-kind'))).toContain('added')
    expect(entries.map(node => node.getAttribute('data-kind'))).toContain('removed')
    expect(entries.some(node => node.textContent?.includes('自营订单免佣'))).toBe(true)
    expect(entries.some(node => node.textContent?.includes('自营订单按下限兜底'))).toBe(true)

    expect(element('compare-old')?.textContent).toContain('自营订单按下限兜底')
    expect(element('compare-new')?.textContent).toContain('代发保持原费率')
    expect(container.querySelectorAll('.compare-line.removed').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.compare-line.added').length).toBeGreaterThan(0)
    expect(element('compare-mode')?.textContent).toContain('REQ-01')
    expect(element('compare-mode')?.textContent).toContain('v2')
  })

  it('拒绝走 /proposal_reject；失败时显示回执且不关闭', async () => {
    const callbacks = { reload: vi.fn(() => {}), close: vi.fn(() => {}) }
    commandAnswer = { ok: false, text: '决定态已经是 approved' }
    await renderCompare(REVISE, callbacks)

    await press('compare-reject')
    expect(commandLines).toEqual(['/proposal_reject P-01'])
    expect(callbacks.reload).not.toHaveBeenCalled()
    expect(callbacks.close).not.toHaveBeenCalled()
    expect(element('compare-result')?.textContent).toContain('决定态已经是 approved')
  })

  it('基线快照读不到时退回当前正文并给出说明', async () => {
    const callbacks = { reload: vi.fn(() => {}), close: vi.fn(() => {}) }
    readAnswer = { ok: false, text: '' }
    await renderCompare(REVISE, callbacks)

    expect(element('compare-baseline-fallback')).not.toBeNull()
    expect(element('compare-old')?.textContent).toContain('自营订单按下限兜底')
  })

  it('正文没有差异时给空态说明', async () => {
    const callbacks = { reload: vi.fn(() => {}), close: vi.fn(() => {}) }
    await renderCompare({ ...REVISE, content: OLD_BODY }, callbacks)
    expect(element('compare-no-change')).not.toBeNull()
  })
})
