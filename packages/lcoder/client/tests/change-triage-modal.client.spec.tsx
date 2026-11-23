// @vitest-environment jsdom
/** T-305：统一「提变更 / 加功能」分流弹窗、入口可见性、手动改选级别与三级通道会话路由测试。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeTriageModal, type ChangeTriageConfirmPayload } from '../src/pages/change-triage-modal.tsx'
import { RequirementDetail } from '../src/pages/requirement-detail.tsx'
import { RequirementsPage } from '../src/pages/requirements.tsx'
import type { RequirementDocRow, TaskRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const DRAFT_REQ: RequirementDocRow = {
  id: 'REQ-01',
  title: '草稿需求',
  text: '# 草稿需求\n\n- 原文',
  state: 'draft',
  options: [],
  versions: [{ n: 1, at: '2026-11-20T09:00:00+08:00' }],
  reviews: [],
}

const CONFIRMED_REQ: RequirementDocRow = {
  id: 'REQ-02',
  title: '报销管理',
  text: '# 报销管理\n\n- 支持提交报销单',
  state: 'confirmed',
  options: [],
  versions: [{ n: 1, at: '2026-11-20T09:00:00+08:00' }],
  reviews: [],
  amendCount: 2,
}

const RELEASED_REQ: RequirementDocRow = {
  id: 'REQ-03',
  title: '已上线需求',
  text: '# 已上线需求\n\n- 已发布正文',
  state: 'released',
  options: [],
  versions: [{ n: 1, at: '2026-11-20T09:00:00+08:00' }],
  reviews: [],
}

const CLOSED_REQ: RequirementDocRow = {
  id: 'REQ-04',
  title: '已关闭需求',
  text: '# 已关闭需求',
  state: 'closed',
  options: [],
  versions: [],
  reviews: [],
}

const ACTIVE_TASK: TaskRow = {
  id: 'T-01',
  title: '报销表单开发',
  description: '',
  attachments: [],
  state: 'implementing',
  grade: 'B',
  rules: [],
  evidence: [],
  dependsOn: [],
  paths: ['src/expense/'],
  irreversible: [],
  requirement: 'REQ-02',
  track: 'h5',
}

function projectionOf(requirements: readonly RequirementDocRow[], tasks: readonly TaskRow[] = []): SpecProjection {
  return {
    tasks,
    rules: [],
    contracts: [],
    proposals: [],
    requirements,
    groups: [],
    roles: [],
    project: {
      kind: 'web',
      repoUrl: 'https://example.com/repo.git',
      branch: 'main',
      docs: { product: '', architecture: '', tests: '' },
      environments: [],
      tracks: [],
    },
    secrets: {},
    automation: null,
    agents: null,
    problems: [],
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') } })
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { call: vi.fn(async () => ({ ok: true, value: { text: '' } })) },
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
  return document.querySelector(`[data-testid="${testId}"]`)
}

async function press(testId: string): Promise<void> {
  const node = element(testId)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function selectTarget(value: string): Promise<void> {
  const node = element('change-triage-target') as HTMLSelectElement
  expect(node).not.toBeNull()
  await act(async () => {
    // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到 select 节点。
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    setter?.call(node, value)
    node.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function typeDescription(value: string): Promise<void> {
  const node = element('change-triage-description') as HTMLTextAreaElement
  expect(node).not.toBeNull()
  await act(async () => {
    // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到输入框。
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('ChangeTriageModal 组件交互', () => {
  it('支持预选目标需求、实时四维分级展示、手动改选级别与确认回调', async () => {
    const confirmed: ChangeTriageConfirmPayload[] = []
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <ChangeTriageModal
          isOpen
          requirements={[DRAFT_REQ, CONFIRMED_REQ, RELEASED_REQ]}
          tasks={[ACTIVE_TASK]}
          tracks={[]}
          projectKind="web"
          initialTargetId="REQ-02"
          onClose={onClose}
          onConfirm={async (payload) => {
            confirmed.push(payload)
            return { ok: true, message: 'ok' }
          }}
        />,
      )
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(element('change-triage-modal')).not.toBeNull()
    expect((element('change-triage-target') as HTMLSelectElement).value).toBe('REQ-02')

    await typeDescription('报销表单加个发票号字段')
    expect(element('change-triage-recommended-level')?.getAttribute('data-level')).toBe('S')
    expect(element('change-triage-recommended-level')?.getAttribute('data-effective-level')).toBe('S')
    expect(element('change-triage-impact-update')?.textContent).toContain('requirement_amend')
    expect(element('change-triage-impact-keep')?.textContent).toContain('confirmed')
    // 默认收起手动改选，不平铺通道卡片
    expect(element('change-triage-level-M')).toBeNull()

    // 展开手动改选并改选为 M 级，影响说明同步切换，确认后发送改选后的 M / delta
    await press('change-triage-override-toggle')
    await press('change-triage-level-M')
    expect(element('change-triage-recommended-level')?.getAttribute('data-effective-level')).toBe('M')
    expect(element('change-triage-impact-update')?.textContent).toContain('增量修订提案')
    expect(element('change-triage-override-reset')).not.toBeNull()

    await press('change-triage-confirm')
    expect(confirmed).toEqual([{
      targetId: 'REQ-02',
      description: '报销表单加个发票号字段',
      level: 'M',
      actionKind: 'delta',
      recommendedLevel: 'S',
    }])

    await press('change-triage-close')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('已上线需求与独立新建时禁用 S 级并给出提示，切换到 L 级可确认', async () => {
    const confirmed: ChangeTriageConfirmPayload[] = []
    await act(async () => {
      root.render(
        <ChangeTriageModal
          isOpen
          requirements={[CONFIRMED_REQ, RELEASED_REQ]}
          tasks={[]}
          tracks={[]}
          projectKind="web"
          initialTargetId={null}
          onClose={() => {}}
          onConfirm={async (payload) => {
            confirmed.push(payload)
            return { ok: true, message: 'ok' }
          }}
        />,
      )
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect((element('change-triage-target') as HTMLSelectElement).value).toBe('')
    await press('change-triage-override-toggle')
    expect((element('change-triage-level-S') as HTMLButtonElement).disabled).toBe(true)
    expect((element('change-triage-level-M') as HTMLButtonElement).disabled).toBe(true)

    await selectTarget('REQ-03')
    expect((element('change-triage-level-S') as HTMLButtonElement).disabled).toBe(true)
    expect((element('change-triage-level-M') as HTMLButtonElement).disabled).toBe(false)

    await typeDescription('我想加入 Windows 桌面版')
    expect(element('change-triage-recommended-level')?.getAttribute('data-level')).toBe('L')
    await press('change-triage-confirm')
    expect(confirmed[0]).toMatchObject({
      targetId: 'REQ-03',
      level: 'L',
      actionKind: 'milestone',
    })
  })
})

describe('需求页与详情页统一入口与三级通道路由', () => {
  it('需求页顶栏显示统一变更入口并保留既有全部按钮，详情页按状态控制入口与微调计数展示', async () => {
    const started: { prompt: string; preset?: string }[] = []
    act(() => {
      root.render(
        <RequirementsPage
          project={PROJECT}
          projection={projectionOf([DRAFT_REQ, CONFIRMED_REQ, RELEASED_REQ, CLOSED_REQ], [ACTIVE_TASK])}
          sessions={[]}
          loading={false}
          error={null}
          intakeResult={null}
          onClearIntakeResult={() => {}}
          onReload={() => {}}
          onStartIntake={async () => ({ ok: true, message: 'ok' })}
          onStartSession={async (prompt, preset) => {
            started.push({ prompt, ...(preset === undefined ? {} : { preset }) })
            return { ok: true, message: 'ok', sessionId: `session-${String(started.length)}` }
          }}
          onOpenSession={() => {}}
          onOpenTasks={() => {}}
        />,
      )
    })

    // 顶栏既有与新增入口并存
    expect(element('requirement-reload')).not.toBeNull()
    expect(element('intake-open')).not.toBeNull()
    expect(element('requirement-new-open')).not.toBeNull()
    expect(element('change-triage-open')).not.toBeNull()

    // 打开弹窗走 S 级通道 → 发起 maniu-intake 会话并出现微调浮卡，amendCount 增加后转完成卡
    await press('change-triage-open')
    await selectTarget('REQ-02')
    await typeDescription('报销表单加个发票号字段')
    await press('change-triage-confirm')

    expect(started).toHaveLength(1)
    expect(started[0]?.preset).toBe('maniu-intake')
    expect(started[0]?.prompt).toContain('requirement_amend')
    expect(started[0]?.prompt).toContain('escalateTo')
    expect(started[0]?.prompt).toContain('T-01')
    expect(element('change-triage-modal')).toBeNull()
    expect(element('requirement-op-running')?.textContent).toContain('S 级轻量微调')

    // 投影 amendCount 从 2 变为 3 后，S 级后台浮卡自动收口为完成卡
    act(() => {
      root.render(
        <RequirementsPage
          project={PROJECT}
          projection={projectionOf([DRAFT_REQ, { ...CONFIRMED_REQ, amendCount: 3 }, RELEASED_REQ, CLOSED_REQ], [ACTIVE_TASK])}
          sessions={[]}
          loading={false}
          error={null}
          intakeResult={null}
          onClearIntakeResult={() => {}}
          onReload={() => {}}
          onStartIntake={async () => ({ ok: true, message: 'ok' })}
          onStartSession={async (prompt, preset) => {
            started.push({ prompt, ...(preset === undefined ? {} : { preset }) })
            return { ok: true, message: 'ok', sessionId: `session-${String(started.length)}` }
          }}
          onOpenSession={() => {}}
          onOpenTasks={() => {}}
        />,
      )
    })
    expect(element('requirement-op-success')?.textContent).toContain('REQ-02')

    // 打开草稿 REQ-01 并通过统一入口发起 draft 变更，直接切入原地草稿修改流
    await act(async () => {
      const row = document.querySelector('[data-testid="requirement-row"][data-requirement-id="REQ-01"]') as HTMLElement
      row.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    // draft 详情页不显示「提变更 / 加功能」按钮（只对 confirmed / released 显示）
    expect(element('requirement-detail-change-triage')).toBeNull()

    await press('change-triage-open')
    await selectTarget('REQ-01')
    await typeDescription('把报销说明改成含税金额')
    await press('change-triage-confirm')
    expect(started).toHaveLength(2)
    expect(started[1]?.preset).toBe('maniu-requirement-editor')
    expect(started[1]?.prompt).toContain('requirement_patch_propose')
    expect(element('requirement-modify-pane')).not.toBeNull()
  })

  it('RequirementDetail 在 confirmed/released 显示入口与微调计数标签，closed 不显示且关闭按钮仍在末位', async () => {
    const openTriage = vi.fn()
    const renderRow = async (row: RequirementDocRow): Promise<void> => {
      await act(async () => {
        root.render(
          <RequirementDetail
            row={row}
            project={PROJECT}
            projection={projectionOf([row])}
            sessions={[]}
            onClose={() => {}}
            onOpenTask={() => {}}
            onOpenReader={() => {}}
            onReload={() => {}}
            onSplit={async () => ({ ok: true, message: 'ok' })}
            onReview={async () => ({ ok: true, message: 'ok' })}
            onRevise={async () => ({ ok: true, message: 'ok' })}
            onModifyRequest={() => {}}
            onCreateBased={async () => ({ ok: true, message: 'ok' })}
            onOpenTasks={() => {}}
            onChangeTriage={openTriage}
          />,
        )
        await new Promise(resolve => setTimeout(resolve, 0))
      })
    }

    await renderRow(CONFIRMED_REQ)
    expect(element('requirement-amend-count')?.textContent).toContain('2')
    expect(element('requirement-detail-change-triage')).not.toBeNull()
    expect(element('requirement-close')?.closest('[data-testid="requirement-actions"]')).not.toBeNull()
    expect(element('requirement-actions')?.lastElementChild?.getAttribute('data-testid')).toBe('requirement-close')
    await press('requirement-detail-change-triage')
    expect(openTriage).toHaveBeenCalledTimes(1)

    await renderRow(RELEASED_REQ)
    expect(element('requirement-amend-count')).toBeNull()
    expect(element('requirement-detail-change-triage')).not.toBeNull()

    await renderRow(CLOSED_REQ)
    expect(element('requirement-detail-change-triage')).toBeNull()
  })

  it('M 级与 L 级路由分别触发增量修订与独立里程碑提示词并创建对应后台浮卡', async () => {
    const started: { prompt: string; preset?: string }[] = []
    act(() => {
      root.render(
        <RequirementsPage
          project={PROJECT}
          projection={projectionOf([CONFIRMED_REQ], [ACTIVE_TASK])}
          sessions={[]}
          loading={false}
          error={null}
          intakeResult={null}
          onClearIntakeResult={() => {}}
          onReload={() => {}}
          onStartIntake={async () => ({ ok: true, message: 'ok' })}
          onStartSession={async (prompt, preset) => {
            started.push({ prompt, ...(preset === undefined ? {} : { preset }) })
            return { ok: true, message: 'ok', sessionId: `session-${String(started.length)}` }
          }}
          onOpenSession={() => {}}
          onOpenTasks={() => {}}
        />,
      )
    })

    // M 级通道
    await press('change-triage-open')
    await selectTarget('REQ-02')
    await typeDescription('修改报销退款冲减计费规则')
    await press('change-triage-confirm')
    expect(started[0]?.preset).toBe('maniu-intake')
    expect(started[0]?.prompt).toContain('M 级增量修订')
    expect(started[0]?.prompt).toContain('只围绕本次差异章节')
    expect(started[0]?.prompt).toContain('不要推翻或改动已完成的老任务')

    // L 级通道
    await press('change-triage-open')
    await selectTarget('REQ-02')
    await typeDescription('我想加入 Windows 桌面版')
    await press('change-triage-confirm')
    expect(started[1]?.preset).toBe('maniu-intake')
    expect(started[1]?.prompt).toContain('L 级独立里程碑立项')
    expect(started[1]?.prompt).toContain('REQ-03')
    expect(started[1]?.prompt).toContain('不会打断、修改或阻塞当前正在进行的需求与在途开发任务')
  })

  it('送审锁定草稿：弹窗禁用草稿修改与确认按钮并提示原因，切到 L 级后才可另立新需求', async () => {
    const lockedDraft: RequirementDocRow = {
      ...DRAFT_REQ,
      reviews: [{ round: 1, at: '2026-11-20T10:00:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', decision: 'pending' }],
    }
    const confirmed: ChangeTriageConfirmPayload[] = []
    act(() => {
      root.render(
        <ChangeTriageModal
          isOpen
          requirements={[lockedDraft, CONFIRMED_REQ]}
          tasks={[]}
          tracks={[]}
          projectKind="web"
          initialTargetId="REQ-01"
          onClose={() => {}}
          onConfirm={async (payload) => {
            confirmed.push(payload)
            return { ok: true, message: 'ok' }
          }}
        />,
      )
    })

    await typeDescription('修改报销表单标题')
    expect(element('change-triage-level-draft')).toBeNull()
    expect((element('change-triage-confirm') as HTMLButtonElement).disabled).toBe(true)
    expect(element('change-triage-blocked')?.textContent).toContain('已送审锁定')

    await press('change-triage-override-toggle')
    expect((element('change-triage-level-draft') as HTMLButtonElement).disabled).toBe(true)
    expect((element('change-triage-level-S') as HTMLButtonElement).disabled).toBe(true)
    expect((element('change-triage-level-M') as HTMLButtonElement).disabled).toBe(true)
    expect((element('change-triage-level-L') as HTMLButtonElement).disabled).toBe(false)

    await press('change-triage-level-L')
    expect(element('change-triage-blocked')).toBeNull()
    expect((element('change-triage-confirm') as HTMLButtonElement).disabled).toBe(false)
    await press('change-triage-confirm')
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]?.level).toBe('L')
    expect(confirmed[0]?.actionKind).toBe('milestone')
  })
})
