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

    // 详情：同一个岗位显示在元信息里（卡片上那一条仍在，所以至少两处）。
    await openTask('起草中的任务')
    expect(screen.getAllByText('Vue 工程师').length).toBeGreaterThanOrEqual(2)
  })

  it('分配成功后已打开的详情立即显示岗位，不用关掉重开', async () => {
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
    expect(screen.getByText(zh['shell.jobRole']).parentElement?.textContent).toContain(zh['shell.roleUnassigned'])

    fireEvent.click(screen.getByRole('button', { name: '.NET 工程师' }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.assignRoleAction'] }))

    await waitFor(() => {
      expect(assignTask).toHaveBeenCalledWith(expect.any(String), 'T-01', 'dotnet-engineer')
    })
    // 弹窗始终开着：详情元信息自己刷新成新岗位，回执也还在。
    await waitFor(() => {
      expect(screen.getByText(zh['shell.jobRole']).parentElement?.textContent).toContain('.NET 工程师')
    })
    expect(screen.getByText('已分配给 dotnet-engineer')).toBeTruthy()
  })

  it('分配被拒时不改显示：详情仍是未分配', async () => {
    const assignTask = vi.fn(async () => ({ ok: false, text: '岗位不存在' }))

    renderShell({
      spec: {
        tasks: { 'T-01.yaml': TASK_T01 },
        roles: 'roles:\n  - id: dotnet-engineer\n    name: .NET 工程师\n    inherits: dev\n',
      },
      assignTask,
    })

    await openTask('起草中的任务')
    fireEvent.click(screen.getByRole('button', { name: '.NET 工程师' }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.assignRoleAction'] }))

    await waitFor(() => { expect(screen.getByText('岗位不存在')).toBeTruthy() })
    expect(screen.getByText(zh['shell.jobRole']).parentElement?.textContent).toContain(zh['shell.roleUnassigned'])
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

describe('任务详情的分配芯片内联建议', () => {
  it('推荐徽标只出现在推荐芯片上，芯片下方一行给理由与置信度，岗位名不再列两遍', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_VUE }, roles: ROLES_VUE } })
    await openTask('修复 vue 页面组件')

    const vueChip = screen.getByRole('button', { name: /^Vue 工程师/ })
    const dotnetChip = screen.getByRole('button', { name: '.NET 工程师' })
    expect(within(vueChip).getByText(zh['shell.roleHintBadge'])).toBeTruthy()
    expect(within(dotnetChip).queryByText(zh['shell.roleHintBadge'])).toBeNull()
    expect(screen.getAllByText(zh['shell.roleHintBadge']).length).toBe(1)

    // 岗位名只在芯片上出现：没有单独的候选清单重复列一遍。
    expect(screen.getAllByText('Vue 工程师').length).toBe(1)
    const mentions = screen.getAllByRole('button')
      .filter(button => button.textContent?.includes('Vue 工程师'))
    expect(mentions.length).toBe(1)

    expect(screen.getByText(
      '强特征「vue」命中标题 (+5)；弱语义「页面」命中标题 (+3)；置信度 100% · 分配仍由人执行 /task_assign',
    )).toBeTruthy()
  })

  it('英文界面按 code 渲染理由、置信度与人工提示', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_VUE }, roles: ROLES_VUE }, t: enT })
    await openTask('修复 vue 页面组件', enT)

    expect(await screen.findByText(en['shell.roleHintBadge'])).toBeTruthy()
    expect(screen.getByText(
      'Strong signal "vue" matched the title (+5); Weak signal "页面" matched the title (+3) · Confidence 100% · A human still runs /task_assign',
    )).toBeTruthy()
  })

  it('点采用建议只改详情里的岗位选择，不调分配命令也不写回执', async () => {
    const assignTask = vi.fn(async () => ({ ok: true, text: '已分配' }))
    renderShell({
      spec: { tasks: { 'T-01.yaml': TASK_VUE }, roles: ROLES_VUE },
      assignTask,
    })
    await openTask('修复 vue 页面组件')

    const vueChip = screen.getByRole('button', { name: /^Vue 工程师/ })
    expect(vueChip.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: zh['shell.roleHintAdopt'] }))

    expect(vueChip.getAttribute('aria-pressed')).toBe('true')
    expect(assignTask).not.toHaveBeenCalled()
    expect(screen.queryByText('已分配')).toBeNull()
  })

  it('不可逆任务写「需人工挑选」并带原因，不标芯片也不给采用按钮', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_VUE_IRREVERSIBLE }, roles: ROLES_VUE } })
    await openTask('修复 vue 页面组件')

    expect(await screen.findByText('本地规则没有把握，请人工挑选（任务含不可逆动作）')).toBeTruthy()
    expect(screen.queryByText(zh['shell.roleHintBadge'])).toBeNull()
    expect(screen.queryByRole('button', { name: zh['shell.roleHintAdopt'] })).toBeNull()
    expect(screen.getAllByRole('button').filter(button => button.textContent === 'Vue 工程师').length).toBe(1)
  })

  it('两个候选同样命中时算需人工挑选', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_VUE }, roles: ROLES_VUE_TIE } })
    await openTask('修复 vue 页面组件')

    expect(await screen.findByText('本地规则没有把握，请人工挑选（最高候选置信度不足）')).toBeTruthy()
    expect(screen.queryByText(zh['shell.roleHintBadge'])).toBeNull()
    expect(screen.queryByRole('button', { name: zh['shell.roleHintAdopt'] })).toBeNull()
  })

  it('没有任何信号命中时写兜底提示，不标芯片也不列岗位清单', async () => {
    renderShell({ spec: { tasks: { 'T-03.yaml': TASK_PLAIN }, roles: ROLES_VUE } })
    await openTask('整理佣金规则')

    expect(await screen.findByText('没有名册岗位命中，建议人工确认')).toBeTruthy()
    expect(screen.queryByText(zh['shell.roleHintBadge'])).toBeNull()
    expect(screen.queryByRole('button', { name: zh['shell.roleHintAdopt'] })).toBeNull()
    // 名册芯片各出现一次，兜底态不另列候选。
    expect(screen.getAllByRole('button').filter(button => button.textContent === '.NET 工程师').length).toBe(1)
    expect(screen.getAllByRole('button').filter(button => button.textContent === 'Vue 工程师').length).toBe(1)
  })
})
