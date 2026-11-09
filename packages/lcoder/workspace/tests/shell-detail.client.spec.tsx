// @vitest-environment jsdom
/**
 * 任务详情弹窗的渲染事实：不让人选角色、契约提示只在有契约时出现、
 * 调度思考过程移出详情但入队位置与日志失败仍看得见。
 *
 * 外壳拿的是投影面与三个选择器钩子；这里用内存投影替掉真远程，
 * 角色名册与模型可用性是直接注入的窄接口。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Shell } from '../src/client/shell/Shell.tsx'
import type { ShellProps } from '../src/client/shell/Shell.tsx'
import type { CloudFace } from '../src/client/cloud/face.ts'
import { zh, en } from '../src/client/locales.ts'
import {
  CONTRACTS_DIR, PROPOSALS_DIR, ROLES_FILE, SCHEDULING_DIR, TASKS_DIR,
} from '../src/client/projection.ts'
import type { ProjectionFilesRemote } from '../src/client/projection.ts'

afterEach(cleanup)

const REPO = 'E:/Projects/demo'
const t = makeTranslate(zh)
const enT = makeTranslate(en)

/** 一份内存里的 `.spec`：只给任务与契约，其余目录按缺失处理。 */
interface SpecFiles {
  readonly tasks?: Readonly<Record<string, string>>
  readonly contracts?: Readonly<Record<string, string>>
  /** `.spec/roles.yaml` 的正文；缺省按文件不存在处理。 */
  readonly roles?: string
}

/** 目录缺失的远程失败；`isMissing` 按 code 认这种。 */
function missing(path: string) {
  return { ok: false as const, error: new RemoteError('workspace-file/not-found', `ENOENT: ${path} does not exist`, { path }) }
}

function fakeFiles(spec: SpecFiles): ProjectionFilesRemote {
  const dirs: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    [TASKS_DIR]: spec.tasks ?? {},
    [CONTRACTS_DIR]: spec.contracts ?? {},
    [PROPOSALS_DIR]: {},
    [SCHEDULING_DIR]: {},
  }
  return {
    list: async (_sessionId, path) => {
      const files = dirs[path]
      if (files === undefined) return missing(path)
      return {
        ok: true,
        value: {
          path,
          entries: Object.keys(files).map(name => ({ name, type: 'file' as const })),
          truncated: false,
        },
      }
    },
    readPage: async (_sessionId, path) => {
      if (path === ROLES_FILE) {
        return spec.roles === undefined
          ? missing(path)
          : {
            ok: true,
            value: { absolutePath: `${REPO}/${path}`, version: 'v1', offset: 1, text: spec.roles, lines: spec.roles.split('\n').length, eof: true },
          }
      }
      const slash = path.lastIndexOf('/')
      const dir = path.slice(0, slash)
      const name = path.slice(slash + 1)
      const text = dirs[dir]?.[name]
      if (text === undefined) return missing(path)
      return {
        ok: true,
        value: { absolutePath: `${REPO}/${path}`, version: 'v1', offset: 1, text, lines: text.split('\n').length, eof: true },
      }
    },
  }
}

/** 一条会话行；`cwd` 与会话号之外只给卡片要的字段。 */
function sessionRow(id: string, cwd: string, running: boolean): SessionSummary {
  return {
    id: SessionId(id),
    displayTitle: id,
    cwd,
    running,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
  }
}

interface ShellScenario {
  readonly spec: SpecFiles
  readonly sessions?: readonly SessionSummary[]
  readonly running?: ReadonlySet<string>
  /** 分配命令替身；缺省给一个成功回执，不写投影。 */
  readonly assignTask?: ShellProps['assignTask']
  /** 界面词典；缺省中文，英文用例显式传入。 */
  readonly t?: ShellProps['t']
}

/** 已登录的云端替身：门禁放行，详情用例只关心渲染事实；门禁本身有 cloud-login 专测。 */
function signedInCloud(): CloudFace {
  return {
    available: true,
    state: async () => ({
      ok: true,
      value: {
        signedIn: true, needsLogin: false,
        user: { id: 'u1', displayName: null, phoneMasked: '+861****0000', status: 'active' },
        quota: null, estimate: null, guest: null, guestExpired: false, lastError: null,
      },
    }),
    sendSms: vi.fn(),
    register: vi.fn(),
    loginSms: vi.fn(),
    loginPassword: vi.fn(),
    refresh: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
    claimGuest: vi.fn(),
    usage: vi.fn(),
    selectRoute: async () => ({ ok: true, value: { provider: 'lcoder-cloud', model: 'deepseek-flash' } }),
  }
}

/** 组装外壳 props：真实词典、内存投影、可直接断言的窄接口替身。 */
function renderShell(scenario: ShellScenario) {
  const rows = scenario.sessions ?? [sessionRow('s-1', REPO, false)]
  const sessionList: SessionListState = {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready',
    projectionsBySession: {},
  }
  const status: SessionStatusSnapshot = new Map(rows.map(row => [row.id, {
    running: scenario.running?.has(String(row.id)) ?? false,
    pendingInteraction: undefined,
    completionUnread: false,
  }]))
  const workspaces: WorkspaceSnapshot = {
    items: [{
      workspaceId: WorkspaceId('w-1'),
      path: REPO,
      title: 'demo',
      sessionIds: rows.map(row => row.id),
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  const logSchedule = vi.fn(async () => ({ ok: false, text: 'evidence 目录不可写' }))
  const props: ShellProps = {
    t: scenario.t ?? t,
    cloud: signedInCloud(),
    files: fakeFiles(scenario.spec),
    usePanelInfo: <S,>(selector: (state: PanelInfo) => S): S => selector({ activePanelId: null }),
    useWorkspaces: <S,>(selector: (state: WorkspaceSnapshot) => S): S => selector(workspaces),
    useWorkspaceAccess: () => true,
    useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessionList),
    useSessionStatus: <S,>(selector: (state: SessionStatusSnapshot) => S): S => selector(status),
    // 外壳不调用这几支全局钩子；给可调用的空替身只为满足槽位 props。
    useRemoteAccess: vi.fn(),
    useSessionRetainInfo: vi.fn(),
    useSessionAccess: vi.fn(),
    useContextMenu: vi.fn(),
    useResource: vi.fn(),
    listRoles: async () => [{ id: 'lcoder-review', name: '评审' }],
    checkModels: async () => ({ state: 'ready' }),
    createSession: async () => SessionId('s-9'),
    signContract: async () => ({ ok: true, text: '已签署' }),
    assignTask: scenario.assignTask ?? vi.fn(async () => ({ ok: true, text: '已分配' })),
    logSchedule,
  }
  const view = render(<Shell {...props} />)
  return { ...view, props, logSchedule }
}

/** 等任务卡出现在看板上，再点开它的详情。 */
async function openTask(title: string, translate: ShellProps['t'] = t): Promise<void> {
  const card = await screen.findByText(title)
  fireEvent.click(card)
  await screen.findByText(translate('shell.startPrompt'))
}

const TASK_T01 = 'id: T-01\ntitle: 起草中的任务\nstate: drafting\ngrade: B\n'
const TASK_T02 = 'id: T-02\ntitle: 与 T-01 同方案的任务\nstate: drafting\ngrade: B\nproposal: P-01\n'
const CONTRACT_T01 = 'id: T-01\nchange:\n  - 加登录限流\nacceptance:\n  - 五次失败锁定十分钟\n'

/** 命中 vue 信号的任务：标题里的强特征与弱语义都算分。 */
const TASK_VUE = 'id: T-01\ntitle: 修复 vue 页面组件\nstate: drafting\ngrade: B\n'
/** 同样的标题，但声明了不可逆动作：建议层恒转人工。 */
const TASK_VUE_IRREVERSIBLE = `${TASK_VUE}scope:\n  irreversible: [settlement_formula]\n`
/** 没有任何信号命中的任务：建议层回内置 dev 兜底。 */
const TASK_PLAIN = 'id: T-03\ntitle: 整理佣金规则\nstate: drafting\ngrade: B\n'
/** 五项元信息都有值的任务：用来断言紧凑列表没有漏字段。 */
const TASK_META = 'id: T-01\ntitle: 元信息齐全的任务\nstate: drafting\ngrade: B\nrules:\n  - R-1\nevidence_required:\n  - E-1\n'

/** 两个实施岗位：Vue 有标题信号，.NET 没有；名册第一条决定默认选择。 */
const ROLES_VUE = `roles:
  - id: dotnet-engineer
    name: .NET 工程师
    inherits: dev
    signals:
      strong: [c#, dotnet]
      medium: []
      preferredPaths: []
  - id: vue-engineer
    name: Vue 工程师
    inherits: dev
    signals:
      strong: [vue]
      medium: [页面]
      preferredPaths: [src/views/]
`

/** 两个同样命中标题的岗位：最高候选分占比低于阈值，本地规则转人工。 */
const ROLES_VUE_TIE = `roles:
  - id: vue-a
    name: Vue 甲
    inherits: dev
    signals:
      strong: [vue]
      medium: []
      preferredPaths: []
  - id: vue-b
    name: Vue 乙
    inherits: dev
    signals:
      strong: [vue]
      medium: []
      preferredPaths: []
`

describe('任务详情', () => {
  it('详情里没有角色行，「＋ 新会话」弹窗仍有角色可选', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_T01 } } })
    await openTask('起草中的任务')

    expect(screen.queryByText(zh['shell.role'])).toBeNull()
    expect(screen.queryByText(zh['shell.roleHint'])).toBeNull()

    fireEvent.click(screen.getByTitle(zh['shell.newSession']))
    expect(await screen.findByText('评审')).toBeTruthy()
    expect(screen.getByText(zh['shell.role'])).toBeTruthy()
  })

  it('任务卡与详情显示已分配岗位；未知 id 与未分配照实画出来', async () => {
    renderShell({
      spec: {
        tasks: {
          'T-01.yaml': `${TASK_T01}role: vue-engineer\n`,
          'T-02.yaml': `${TASK_T02}role: ghost-role\n`,
          'T-03.yaml': 'id: T-03\ntitle: 还没分配的任务\nstate: drafting\ngrade: C\n',
        },
        roles: 'roles:\n  - id: vue-engineer\n    name: Vue 工程师\n    inherits: dev\n',
      },
    })

    // 卡片：名册里认识的显示名、名册与内置角色都不认识的显示未知岗位、缺字段显示未分配。
    expect(await screen.findByText(`${zh['shell.jobRole']} Vue 工程师`)).toBeTruthy()
    expect(screen.getByText(`${zh['shell.jobRole']} ${zh['shell.roleUnknown']}`)).toBeTruthy()
    expect(screen.getByText(`${zh['shell.jobRole']} ${zh['shell.roleUnassigned']}`)).toBeTruthy()

    // 详情：同一个岗位显示在元信息里；问号按钮带可访问名称，不改岗位文本节点。
    await openTask('起草中的任务')
    const detail = screen.getByRole('dialog', { name: 'T-01 起草中的任务' })
    expect(within(detail).getByText(zh['shell.jobRole']).parentElement?.textContent).toContain('Vue 工程师')
  })

  it('岗位弹窗确认后才分配：调用 assignTask 并显示回执，详情立即刷新', async () => {
    const tasks: Record<string, string> = { 'T-01.yaml': TASK_T01 }
    const assignTask = vi.fn(async (_sessionId: SessionId, taskId: string, roleId: string) => {
      // 模拟命令落盘：下一次重读投影能看到 role，与真实 `/task_assign` 同形。
      tasks[`${taskId}.yaml`] = `${tasks[`${taskId}.yaml`] ?? ''}role: ${roleId}\n`
      return { ok: true, text: `已分配给 ${roleId}` }
    })

    renderShell({
      spec: {
        tasks,
        roles: 'roles:\n  - id: dotnet-engineer\n    name: .NET 工程师\n    inherits: dev\n',
      },
      assignTask,
    })

    await openTask('起草中的任务')
    const detail = screen.getByRole('dialog', { name: 'T-01 起草中的任务' })
    expect(within(detail).getByText(zh['shell.jobRole']).parentElement?.textContent).toContain(zh['shell.roleUnassigned'])

    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.roleDialogTitle'] }))
    const roleDialog = screen.getByRole('dialog', { name: zh['shell.roleDialogTitle'] })
    fireEvent.click(within(roleDialog).getByRole('button', { name: '.NET 工程师' }))
    fireEvent.click(within(roleDialog).getByRole('button', { name: zh['shell.roleDialogConfirm'] }))

    await waitFor(() => {
      expect(assignTask).toHaveBeenCalledWith(expect.any(String), 'T-01', 'dotnet-engineer')
    })
    await waitFor(() => {
      expect(within(roleDialog).getByText('已分配给 dotnet-engineer')).toBeTruthy()
    })
    // 弹窗始终开着：详情元信息自己刷新成新岗位，回执也还在。
    await waitFor(() => {
      expect(within(detail).getByText(zh['shell.jobRole']).parentElement?.textContent).toContain('.NET 工程师')
    })
  })

  it('分配被拒时回执留在弹窗，详情仍是未分配', async () => {
    const assignTask = vi.fn(async () => ({ ok: false, text: '岗位不存在' }))

    renderShell({
      spec: {
        tasks: { 'T-01.yaml': TASK_T01 },
        roles: 'roles:\n  - id: dotnet-engineer\n    name: .NET 工程师\n    inherits: dev\n',
      },
      assignTask,
    })

    await openTask('起草中的任务')
    const detail = screen.getByRole('dialog', { name: 'T-01 起草中的任务' })
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.roleDialogTitle'] }))
    const roleDialog = screen.getByRole('dialog', { name: zh['shell.roleDialogTitle'] })
    fireEvent.click(within(roleDialog).getByRole('button', { name: '.NET 工程师' }))
    fireEvent.click(within(roleDialog).getByRole('button', { name: zh['shell.roleDialogConfirm'] }))

    await waitFor(() => { expect(within(roleDialog).getByText('岗位不存在')).toBeTruthy() })
    expect(within(detail).getByText(zh['shell.jobRole']).parentElement?.textContent).toContain(zh['shell.roleUnassigned'])
  })

  it('标题下不再显示项目、仓库路径与规格根', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_META } } })
    await openTask('元信息齐全的任务')

    const detail = screen.getByRole('dialog', { name: 'T-01 元信息齐全的任务' })
    // 只看标题块：启动咒语里本来就会提到规格根与项目路径。
    const head = detail.querySelector('h3')?.parentElement
    expect(head?.textContent).toBe('T-01 · 元信息齐全的任务')
  })

  it('元信息五项都在，改成无卡片的紧凑列表', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_META } } })
    await openTask('元信息齐全的任务')

    const detail = screen.getByRole('dialog', { name: 'T-01 元信息齐全的任务' })
    for (const label of [zh['shell.grade'], zh['shell.jobRole'], zh['shell.rules'], zh['shell.evidence'], zh['shell.surface']]) {
      expect(within(detail).getByText(label).tagName).toBe('DT')
    }
    expect(within(detail).getAllByRole('term').length).toBe(5)
    expect(within(detail).getAllByRole('definition').length).toBe(5)

    const list = within(detail).getByText(zh['shell.grade']).closest('dl')
    expect(list).not.toBeNull()
    expect(list?.textContent).toContain('B')
    expect(list?.textContent).toContain('R-1')
    expect(list?.textContent).toContain('E-1')
    expect(list?.textContent).toContain('读 / 契约')

    // 旧的分配区整块不在：没有分配按钮、没有采用建议、没有硬约束小字。
    expect(within(detail).queryByRole('button', { name: '分配' })).toBeNull()
    expect(within(detail).queryByText('采用建议')).toBeNull()
    expect(within(detail).queryByText('分配是调度硬约束，由人写入')).toBeNull()
  })

  it('问号按钮打开岗位弹窗，打开本身不写盘', async () => {
    const assignTask = vi.fn(async () => ({ ok: true, text: '已分配' }))
    renderShell({
      spec: { tasks: { 'T-01.yaml': TASK_T01 }, roles: ROLES_VUE },
      assignTask,
    })
    await openTask('起草中的任务')

    const detail = screen.getByRole('dialog', { name: 'T-01 起草中的任务' })
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.roleDialogTitle'] }))

    const roleDialog = screen.getByRole('dialog', { name: zh['shell.roleDialogTitle'] })
    expect(within(roleDialog).getByText('当前岗位：未分配')).toBeTruthy()
    expect(within(roleDialog).getByRole('button', { name: '.NET 工程师' })).toBeTruthy()
    expect(within(roleDialog).getByRole('button', { name: /^Vue 工程师/ })).toBeTruthy()
    expect(assignTask).not.toHaveBeenCalled()
  })

  it('没有契约文件时不出现签署暗示，也不提供签署按钮', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_T01 } } })
    await openTask('起草中的任务')

    expect(screen.getByText(zh['shell.contractMissing'])).toBeTruthy()
    expect(screen.queryByText(zh['shell.contractHint'])).toBeNull()
    expect(screen.queryByRole('button', { name: zh['shell.sign'] })).toBeNull()
  })

  it('有契约且未签署时显示签署提示与签署按钮', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_T01 }, contracts: { 'T-01.contract.yaml': CONTRACT_T01 } } })
    await openTask('起草中的任务')

    expect(screen.queryByText(zh['shell.contractMissing'])).toBeNull()
    expect(screen.getByText(zh['shell.contractHint'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['shell.sign'] })).toBeTruthy()
  })

  it('详情不画调度思考过程，但入队位置与日志写入失败仍在', async () => {
    const { container } = renderShell({
      spec: {
        tasks: {
          // T-01 已认给 s-1 且同方案：再开 T-02 会判成入队。
          'T-01.yaml': 'id: T-01\ntitle: 正在跑的任务\nstate: implementing\ngrade: B\nproposal: P-01\nsession: s-1\n',
          'T-02.yaml': TASK_T02,
        },
      },
      sessions: [sessionRow('s-1', REPO, true)],
      running: new Set(['s-1']),
    })

    await openTask('与 T-01 同方案的任务')
    fireEvent.click(screen.getAllByRole('button', { name: zh['shell.startChat'] })[0]!)
    await waitFor(() => { expect(screen.queryByText(zh['shell.startPrompt'])).toBeNull() })

    // 重新点开详情：判定已留档，日志失败也记在这一条上。
    fireEvent.click(screen.getAllByText('与 T-01 同方案的任务')[0]!)
    await screen.findByText(zh['shell.startPrompt'])

    expect(screen.queryByText('调度思考过程')).toBeNull()
    expect(screen.queryByText('候选会话')).toBeNull()
    expect(container.querySelector('details')).toBeNull()

    expect(screen.getByText(zh['shell.queuedIn']).parentElement?.textContent).toContain('第 1 位')
    expect(screen.getByText('调度日志没写成：evidence 目录不可写')).toBeTruthy()
  })
})

describe('任务详情的岗位弹窗与建议徽标', () => {
  it('推荐徽标只出现在弹窗的推荐项，详情里不显示建议理由', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_VUE }, roles: ROLES_VUE } })
    await openTask('修复 vue 页面组件')

    const detail = screen.getByRole('dialog', { name: 'T-01 修复 vue 页面组件' })
    expect(within(detail).queryByText(zh['shell.roleHintBadge'])).toBeNull()
    expect(within(detail).queryByText(/置信度/)).toBeNull()
    expect(within(detail).queryByText(/强特征/)).toBeNull()

    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.roleDialogTitle'] }))
    const roleDialog = screen.getByRole('dialog', { name: zh['shell.roleDialogTitle'] })
    const vueChip = within(roleDialog).getByRole('button', { name: /^Vue 工程师/ })
    const dotnetChip = within(roleDialog).getByRole('button', { name: '.NET 工程师' })
    expect(within(vueChip).getByText(zh['shell.roleHintBadge'])).toBeTruthy()
    expect(within(dotnetChip).queryByText(zh['shell.roleHintBadge'])).toBeNull()
    expect(within(roleDialog).getAllByText(zh['shell.roleHintBadge']).length).toBe(1)
  })

  it('取消关闭弹窗不调分配命令', async () => {
    const assignTask = vi.fn(async () => ({ ok: true, text: '已分配' }))
    renderShell({
      spec: { tasks: { 'T-01.yaml': TASK_VUE }, roles: ROLES_VUE },
      assignTask,
    })
    await openTask('修复 vue 页面组件')

    const detail = screen.getByRole('dialog', { name: 'T-01 修复 vue 页面组件' })
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.roleDialogTitle'] }))
    const roleDialog = screen.getByRole('dialog', { name: zh['shell.roleDialogTitle'] })
    fireEvent.click(within(roleDialog).getByRole('button', { name: '.NET 工程师' }))
    fireEvent.click(within(roleDialog).getByRole('button', { name: zh['shell.cancel'] }))

    expect(screen.queryByRole('dialog', { name: zh['shell.roleDialogTitle'] })).toBeNull()
    expect(assignTask).not.toHaveBeenCalled()
  })

  it('点弹窗外关闭也不调分配命令', async () => {
    const assignTask = vi.fn(async () => ({ ok: true, text: '已分配' }))
    renderShell({
      spec: { tasks: { 'T-01.yaml': TASK_VUE }, roles: ROLES_VUE },
      assignTask,
    })
    await openTask('修复 vue 页面组件')

    const detail = screen.getByRole('dialog', { name: 'T-01 修复 vue 页面组件' })
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.roleDialogTitle'] }))
    const roleDialog = screen.getByRole('dialog', { name: zh['shell.roleDialogTitle'] })
    fireEvent.click(within(roleDialog).getByRole('button', { name: '.NET 工程师' }))
    fireEvent.click(roleDialog.parentElement!)

    expect(screen.queryByRole('dialog', { name: zh['shell.roleDialogTitle'] })).toBeNull()
    expect(assignTask).not.toHaveBeenCalled()
  })

  it('兜底态弹窗不带建议徽标', async () => {
    renderShell({ spec: { tasks: { 'T-03.yaml': TASK_PLAIN }, roles: ROLES_VUE } })
    await openTask('整理佣金规则')

    const detail = screen.getByRole('dialog', { name: 'T-03 整理佣金规则' })
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.roleDialogTitle'] }))
    const roleDialog = screen.getByRole('dialog', { name: zh['shell.roleDialogTitle'] })

    expect(within(roleDialog).queryByText(zh['shell.roleHintBadge'])).toBeNull()
    expect(within(roleDialog).getByRole('button', { name: '.NET 工程师' })).toBeTruthy()
    expect(within(roleDialog).getByRole('button', { name: 'Vue 工程师' })).toBeTruthy()
  })

  it('需人工挑选的两态同样不标徽标', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_VUE_IRREVERSIBLE }, roles: ROLES_VUE } })
    await openTask('修复 vue 页面组件')

    const detail = screen.getByRole('dialog', { name: 'T-01 修复 vue 页面组件' })
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.roleDialogTitle'] }))
    const roleDialog = screen.getByRole('dialog', { name: zh['shell.roleDialogTitle'] })
    expect(within(roleDialog).queryByText(zh['shell.roleHintBadge'])).toBeNull()

    cleanup()
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_VUE }, roles: ROLES_VUE_TIE } })
    await openTask('修复 vue 页面组件')
    const tieDetail = screen.getByRole('dialog', { name: 'T-01 修复 vue 页面组件' })
    fireEvent.click(within(tieDetail).getByRole('button', { name: zh['shell.roleDialogTitle'] }))
    const tieDialog = screen.getByRole('dialog', { name: zh['shell.roleDialogTitle'] })
    expect(within(tieDialog).queryByText(zh['shell.roleHintBadge'])).toBeNull()
  })

  it('英文界面给出弹窗标题、当前岗位、确认按钮与徽标', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_VUE }, roles: ROLES_VUE }, t: enT })
    await openTask('修复 vue 页面组件', enT)

    const detail = screen.getByRole('dialog', { name: 'T-01 修复 vue 页面组件' })
    fireEvent.click(within(detail).getByRole('button', { name: en['shell.roleDialogTitle'] }))
    const roleDialog = screen.getByRole('dialog', { name: en['shell.roleDialogTitle'] })

    expect(within(roleDialog).getByText('Current role: Unassigned')).toBeTruthy()
    expect(within(roleDialog).getByRole('button', { name: en['shell.roleDialogConfirm'] })).toBeTruthy()
    expect(within(roleDialog).getByText(en['shell.roleHintBadge'])).toBeTruthy()
    expect(within(roleDialog).getByRole('button', { name: /^Vue Engineer|^Vue 工程师/ })).toBeTruthy()
  })
})
