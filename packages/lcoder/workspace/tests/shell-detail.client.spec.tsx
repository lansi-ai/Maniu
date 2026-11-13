// @vitest-environment jsdom
/**
 * 任务详情弹窗的渲染事实：不让人选角色、契约提示只在有契约时出现、不再显示启动咒语、
 * 会话动作随任务阶段换文案、调度思考过程移出详情但入队位置与日志失败仍看得见。
 *
 * 外壳拿的是投影面与三个选择器钩子；这里用内存投影替掉真远程，
 * 角色名册与模型可用性是直接注入的窄接口。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the `agentPreset` Session projection value into this program.
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Shell } from '../src/client/shell/Shell.tsx'
import type { ShellProps } from '../src/client/shell/Shell.tsx'
import type { ShellMessage } from '../src/client/shell/shell-data.ts'
import type { CloudFace } from '../src/client/cloud/face.ts'
import type { CloudState } from '@lcoder/kernel/src/cloud/types.ts'
import type { ModelSettingsFace, ModelSettingsSnapshot } from '../src/client/shell/model-settings.ts'
import { zh, en } from '../src/client/locales.ts'
import {
  CONTRACTS_DIR, DELIVERABLES_DIR, PROPOSALS_DIR, REQUIREMENTS_DIR, ROLES_FILE, SCHEDULING_DIR, TASKS_DIR,
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
  /** `.spec/requirements/` 下的完整需求文档；按文件名作方案编号。 */
  readonly requirements?: Readonly<Record<string, string>>
  /** `.spec/proposals/` 下的方案文件。 */
  readonly proposals?: Readonly<Record<string, string>>
  /** `.spec/roles.yaml` 的正文；缺省按文件不存在处理。 */
  readonly roles?: string
  /** `.spec/deliverables/` 下的交付索引。 */
  readonly deliverables?: Readonly<Record<string, string>>
  /** 仓库根下的文档正文（如 README.md、docs/architecture.md）；预览走这一支。 */
  readonly docs?: Readonly<Record<string, string>>
}

/** 目录缺失的远程失败；`isMissing` 按 code 认这种。 */
function missing(path: string) {
  return { ok: false as const, error: new RemoteError('workspace-file/not-found', `ENOENT: ${path} does not exist`, { path }) }
}

function fakeFiles(spec: SpecFiles): ProjectionFilesRemote {
  const dirs: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    [TASKS_DIR]: spec.tasks ?? {},
    [CONTRACTS_DIR]: spec.contracts ?? {},
    [PROPOSALS_DIR]: spec.proposals ?? {},
    [REQUIREMENTS_DIR]: spec.requirements ?? {},
    [SCHEDULING_DIR]: {},
    [DELIVERABLES_DIR]: spec.deliverables ?? {},
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
      const doc = spec.docs?.[path]
      if (doc !== undefined) {
        return {
          ok: true,
          value: { absolutePath: `${REPO}/${path}`, version: 'v1', offset: 1, text: doc, lines: doc.split('\n').length, eof: true },
        }
      }
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
  /** 签署与推进替身；方案讨论确认用。 */
  readonly signContract?: ShellProps['signContract']
  readonly advanceContract?: ShellProps['advanceContract']
  /** 按 `.spec` 相对路径给出的附件字节；缺的路径按读不到处理。 */
  readonly attachments?: Readonly<Record<string, Uint8Array>>
  /** 界面词典；缺省中文，英文用例显式传入。 */
  readonly t?: ShellProps['t']
  /** 云端面替身；缺省已登录。 */
  readonly cloud?: CloudFace
  /** 首条会话投影里的模型路由；用来模拟旧版本遗留的匿名会话。 */
  readonly provider?: string
  /** 首条会话投影里的 agentPreset；讨论历史重启后按它找候选。 */
  readonly preset?: string
  /** 按会话号给出的 agentPreset；多会话扫描讨论历史时用。 */
  readonly presets?: Readonly<Record<string, string>>
  /** 工作区列表；缺省给一条会话所在的工作区。 */
  readonly workspaces?: WorkspaceSnapshot['items']
  /** 会话消息读取；需求卡片的立项问答走这一支。 */
  readonly readMessages?: ShellProps['readMessages']
  /** 异步读取会话消息；讨论历史重启后的候选走这一支。 */
  readonly readSessionMessages?: ShellProps['readSessionMessages']
  readonly subscribeSession?: ShellProps['subscribeSession']
  readonly holdSession?: ShellProps['holdSession']
  /** 向会话发送提示；需求拆分走这一支。 */
  readonly sendPrompt?: ShellProps['sendPrompt']
  /** 新建会话；缺省给固定会话号 s-9；需求拆分按角色 preset 建两条会话。 */
  readonly createSession?: ShellProps['createSession']
  /** 模型设置面替身；缺省不注入，新建会话交给宿主默认模型。 */
  readonly modelSettings?: ShellProps['modelSettings']
  /** 任务认领命令替身；缺省不注入，任务对话只走复用分支。 */
  readonly bindTask?: ShellProps['bindTask']
  /** 需求人机命令替身：确认、发布、关闭。 */
  readonly approveRequirement?: ShellProps['approveRequirement']
  readonly releaseRequirement?: ShellProps['releaseRequirement']
  readonly closeRequirement?: ShellProps['closeRequirement']
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
    usage: vi.fn(),
    selectRoute: async () => ({ ok: true, value: { provider: 'lcoder-cloud', model: 'deepseek-flash' } }),
  }
}

/** 模型设置面替身：只记录 load 与 setDefault，其余写入面不在新建会话里触发。 */
function fakeModelSettings(defaultSelection?: { provider: string; model: string }) {
  const load = vi.fn(async (): Promise<ModelSettingsSnapshot> => ({
    status: 'ready',
    error: null,
    credentialError: null,
    writable: true,
    rows: [],
    protocols: [],
    ...(defaultSelection === undefined ? {} : { defaultSelection }),
  }))
  const setDefault = vi.fn(async () => undefined)
  const face: ModelSettingsFace = {
    load,
    setDefault,
    saveKey: vi.fn().mockResolvedValue(undefined),
    removeKey: vi.fn().mockResolvedValue(undefined),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    createProvider: vi.fn().mockResolvedValue(undefined),
    removeProvider: vi.fn().mockResolvedValue(undefined),
    discover: vi.fn().mockResolvedValue({ kind: 'found', models: [] }),
  }
  return { face, setDefault }
}

/** 组装外壳 props：真实词典、内存投影、可直接断言的窄接口替身。 */
function renderShell(scenario: ShellScenario) {
  const rows = scenario.sessions ?? [sessionRow('s-1', REPO, false)]
  /** 需要时就先放一条会话投影：旧版本匿名会话按 provider 识别。 */
  const initialProjections: Record<SessionId, SessionListState['projectionsBySession'][SessionId]> = {}
  if (scenario.provider !== undefined && rows[0] !== undefined) {
    const selection = { provider: scenario.provider, model: 'deepseek-flash' }
    initialProjections[rows[0].id] = {
      values: { modelSelection: { lastUsed: selection, next: selection } },
      state: 'ready',
      error: null,
    }
  }
  for (const row of rows) {
    const preset = scenario.presets?.[String(row.id)] ?? (row === rows[0] ? scenario.preset : undefined)
    if (preset === undefined) continue
    const current = initialProjections[row.id]
    initialProjections[row.id] = {
      values: { ...current?.values, agentPreset: preset },
      state: 'ready',
      error: null,
    }
  }
  const sessionList: SessionListState = {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready',
    projectionsBySession: initialProjections,
  }
  const status: SessionStatusSnapshot = new Map(rows.map(row => [row.id, {
    running: scenario.running?.has(String(row.id)) ?? false,
    pendingInteraction: undefined,
    completionUnread: false,
  }]))
  const workspaces: WorkspaceSnapshot = {
    items: scenario.workspaces ?? [{
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
    cloud: scenario.cloud ?? signedInCloud(),
    files: fakeFiles(scenario.spec),
    readAttachment: async (_sessionId, path) => {
      const bytes = scenario.attachments?.[path]
      return bytes === undefined
        ? missing(path)
        : { ok: true, value: bytes }
    },
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
    createSession: scenario.createSession ?? (async () => SessionId('s-9')),
    ...(scenario.modelSettings === undefined ? {} : { modelSettings: scenario.modelSettings }),
    ...(scenario.bindTask === undefined ? {} : { bindTask: scenario.bindTask }),
    signContract: scenario.signContract ?? (async () => ({ ok: true, text: '已签署' })),
    advanceContract: scenario.advanceContract ?? (async () => ({ ok: true, text: '已进入已签约' })),
    assignTask: scenario.assignTask ?? vi.fn(async () => ({ ok: true, text: '已分配' })),
    logSchedule,
    ...(scenario.readMessages === undefined ? {} : { readMessages: scenario.readMessages }),
    ...(scenario.readSessionMessages === undefined ? {} : { readSessionMessages: scenario.readSessionMessages }),
    ...(scenario.subscribeSession === undefined ? {} : { subscribeSession: scenario.subscribeSession }),
    ...(scenario.holdSession === undefined ? {} : { holdSession: scenario.holdSession }),
    ...(scenario.sendPrompt === undefined ? {} : { sendPrompt: scenario.sendPrompt }),
    approveRequirement: scenario.approveRequirement ?? (async () => ({ ok: true, text: '已确认' })),
    releaseRequirement: scenario.releaseRequirement ?? (async () => ({ ok: true, text: '已发布' })),
    closeRequirement: scenario.closeRequirement ?? (async () => ({ ok: true, text: '已关闭' })),
  }
  const view = render(<Shell {...props} />)
  return { ...view, props, logSchedule }
}

/** 等任务卡出现在看板上，再点开它的详情。 */
async function openTask(title: string): Promise<HTMLElement> {
  const card = await screen.findByText(title)
  fireEvent.click(card)
  return screen.findByRole('dialog')
}

/** 切到需求页并打开一条需求的详情抽屉。 */
async function openRequirement(id: string): Promise<HTMLElement> {
  await waitFor(() => { expect(document.querySelector('[data-nav="requirements"]')).not.toBeNull() })
  fireEvent.click(document.querySelector('[data-nav="requirements"]') as HTMLElement)
  const row = await screen.findByText(id, { selector: 'td' })
  fireEvent.click(row)
  return screen.findByRole('dialog', { name: new RegExp(id) })
}

const TASK_T01 = 'id: T-01\ntitle: 起草中的任务\nstate: drafting\ngrade: B\n\ntrack: h5\n'
const TASK_T02 = 'id: T-02\ntitle: 与 T-01 同方案的任务\nstate: drafting\ngrade: B\nproposal: P-01\n\ntrack: h5\n'
const CONTRACT_T01 = 'id: T-01\nchange:\n  - 加登录限流\nacceptance:\n  - 五次失败锁定十分钟\n'

/** 命中 vue 信号的任务：标题里的强特征与弱语义都算分。 */
const TASK_VUE = 'id: T-01\ntitle: 修复 vue 页面组件\nstate: drafting\ngrade: B\n\ntrack: h5\n'
/** 同样的标题，但声明了不可逆动作：建议层恒转人工。 */
const TASK_VUE_IRREVERSIBLE = `${TASK_VUE}scope:\n  irreversible: [settlement_formula]\n`
/** 没有任何信号命中的任务：建议层回内置 dev 兜底。 */
const TASK_PLAIN = 'id: T-03\ntitle: 整理佣金规则\nstate: drafting\ngrade: B\n\ntrack: h5\n'
/** 五项元信息都有值的任务：用来断言紧凑列表没有漏字段。 */
const TASK_META = 'id: T-01\ntitle: 元信息齐全的任务\nstate: drafting\ngrade: B\nrules:\n  - R-1\nevidence_required:\n  - E-1\n\ntrack: h5\n'

/** 一张能过 base64 的最小 PNG 头；渲染端不真的解码图片。 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

/** 两张附件：一张有字节，一张缺失。 */
const TASK_ATTACHED = 'id: T-01\ntitle: 带图的任务\nstate: drafting\ngrade: B\nattachments:\n  - attachments/T-01/shot.png\n  - attachments/T-01/gone.png\n\ntrack: h5\n'

/** 五条任务覆盖五个阶段：显示名与会话动作文案各一条。 */
const STAGE_CASES = [
  { id: 'T-01', state: 'drafting', title: '需求确认里的任务', label: 'shell.drafting', action: 'shell.confirmRequirement' },
  { id: 'T-02', state: 'contracted', title: '待开发里的任务', label: 'shell.contracted', action: 'shell.startDevelopment' },
  { id: 'T-03', state: 'implementing', title: '开发中的任务', label: 'shell.implementing', action: 'shell.submitAcceptance' },
  { id: 'T-04', state: 'verifying', title: '验收中的任务', label: 'shell.verifying', action: 'shell.completeAcceptance' },
  { id: 'T-05', state: 'closed', title: '已完成的任务', label: 'shell.closed', action: 'shell.viewRecord' },
] as const

/** 五态任务的 `.spec/tasks` 文件表。 */
function stageTasks(): Readonly<Record<string, string>> {
  return Object.fromEntries(STAGE_CASES.map(item => [
    `${item.id}.yaml`,
    `id: ${item.id}\ntitle: ${item.title}\nstate: ${item.state}\ngrade: B\n${item.state === 'drafting' ? 'track: h5\n' : ''}`,
  ]))
}

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
          'T-03.yaml': 'id: T-03\ntitle: 还没分配的任务\nstate: drafting\ngrade: C\ntrack: h5\n',
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
    expect(head?.textContent).toContain('T-01 · 元信息齐全的任务')
    expect(head?.textContent).not.toContain(REPO)
    expect(head?.textContent).not.toContain('.spec')
  })

  it('标题下显示任务描述并保留换行；没有描述时给出空态', async () => {
    const described = `${TASK_T01}description: |\n  第一行说明\n  第二行说明\n`
    renderShell({ spec: { tasks: { 'T-01.yaml': described } } })
    const detail = await openTask('起草中的任务')

    const text = within(detail).getByText(content => content.includes('第一行说明') && content.includes('第二行说明'))
    expect(text.textContent).toBe('第一行说明\n第二行说明')

    cleanup()
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_META } } })
    const plain = await openTask('元信息齐全的任务')
    expect(within(plain).getByText(zh['shell.noDescription'])).toBeTruthy()
  })

  it('标题区显示领域与变更类型两枚标签；缺省不显示', async () => {
    const classified = `${TASK_T01}category: api\nchange_type: bug\n`
    renderShell({ spec: { tasks: { 'T-01.yaml': classified } } })
    const detail = await openTask('起草中的任务')

    expect(within(detail).getByText(zh['shell.categoryApi'])).toBeTruthy()
    expect(within(detail).getByText(zh['shell.changeBug'])).toBeTruthy()

    cleanup()
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_T01 } } })
    const plain = await openTask('起草中的任务')
    expect(within(plain).queryByText(zh['shell.categoryApi'])).toBeNull()
    expect(within(plain).queryByText(zh['shell.changeBug'])).toBeNull()
    expect(within(plain).queryByText(zh['shell.category'])).toBeNull()
    expect(within(plain).queryByText(zh['shell.changeType'])).toBeNull()
  })

  it('元信息默认只留岗位与难度，其余三项收进「更多」并各带白话解释', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_META } } })
    await openTask('元信息齐全的任务')

    const detail = screen.getByRole('dialog', { name: 'T-01 元信息齐全的任务' })
    const strip = within(detail).getByText(zh['shell.difficulty']).closest('dl')
    expect(strip).not.toBeNull()
    expect(strip?.textContent).toContain(zh['shell.jobRole'])
    expect(strip?.textContent).toContain(zh['shell.difficultyMedium'])
    expect(strip?.textContent).not.toContain(zh['shell.rules'])
    expect(strip?.textContent).not.toContain(zh['shell.evidence'])
    expect(strip?.textContent).not.toContain(zh['shell.surface'])

    const more = within(detail).getByText(zh['shell.more']).closest('details')
    expect(more?.open).toBe(false)
    expect(within(more as HTMLElement).getByText(zh['shell.rules'])).toBeTruthy()
    expect(within(more as HTMLElement).getByText(zh['shell.rulesHint'])).toBeTruthy()
    expect(within(more as HTMLElement).getByText('R-1')).toBeTruthy()
    expect(within(more as HTMLElement).getByText(zh['shell.evidence'])).toBeTruthy()
    expect(within(more as HTMLElement).getByText(zh['shell.evidenceHint'])).toBeTruthy()
    expect(within(more as HTMLElement).getByText('E-1')).toBeTruthy()
    expect(within(more as HTMLElement).getByText(zh['shell.surface'])).toBeTruthy()
    expect(within(more as HTMLElement).getByText(zh['shell.surfaceHint'])).toBeTruthy()
    expect(within(more as HTMLElement).getByText('读 / 契约')).toBeTruthy()

    fireEvent.click(within(detail).getByText(zh['shell.more']))
    expect(more?.open).toBe(true)

    // 旧的分配区整块不在：没有分配按钮、没有采用建议、没有硬约束小字。
    expect(within(detail).queryByRole('button', { name: '分配' })).toBeNull()
    expect(within(detail).queryByText('采用建议')).toBeNull()
    expect(within(detail).queryByText('分配是调度硬约束，由人写入')).toBeNull()
  })

  it('附件区画出缩略图，缺失文件只占位；点击放大是只读弹窗', async () => {
    renderShell({
      spec: { tasks: { 'T-01.yaml': TASK_ATTACHED } },
      attachments: { 'attachments/T-01/shot.png': PNG_BYTES },
    })
    const detail = await openTask('带图的任务')

    const thumb = await within(detail).findByAltText('shot.png')
    expect(thumb.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(within(detail).getByText('gone.png')).toBeTruthy()
    expect(within(detail).getByText(zh['shell.attachmentMissing'])).toBeTruthy()

    const openName = `${zh['shell.attachmentOpen']} shot.png`
    fireEvent.click(within(detail).getByRole('button', { name: openName }))
    const zoom = await screen.findByRole('dialog', { name: openName })
    expect(within(zoom).getByRole('img', { name: 'shot.png' }).getAttribute('src')).toMatch(/^data:image\/png;base64,/)

    fireEvent.click(within(zoom).getByRole('button', { name: zh['shell.attachmentClose'] }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: openName })).toBeNull() })
  })

  it('没有附件时不出现附件区', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_T01 } } })
    const detail = await openTask('起草中的任务')
    expect(within(detail).queryByText(zh['shell.taskAttachments'])).toBeNull()
  })

  it('英文界面给出描述、分类标签、难度、更多与附件区', async () => {
    const task = 'id: T-01\ntitle: Attached task\nstate: drafting\ngrade: B\ntrack: h5\n'
      + 'description: |\n  First line\n  Second line\ncategory: api\nchange_type: bug\n'
      + 'attachments:\n  - attachments/T-01/shot.png\n'
    renderShell({
      spec: { tasks: { 'T-01.yaml': task } },
      attachments: { 'attachments/T-01/shot.png': PNG_BYTES },
      t: enT,
    })
    const detail = await openTask('Attached task')

    const text = within(detail).getByText(content => content.includes('First line') && content.includes('Second line'))
    expect(text.textContent).toBe('First line\nSecond line')
    expect(within(detail).getByText(en['shell.categoryApi'])).toBeTruthy()
    expect(within(detail).getByText(en['shell.changeBug'])).toBeTruthy()
    expect(within(detail).getByText(en['shell.difficulty'])).toBeTruthy()
    expect(within(detail).getByText(en['shell.difficultyMedium'])).toBeTruthy()
    expect(within(detail).getByText(en['shell.more'])).toBeTruthy()
    expect(within(detail).getByText(en['shell.taskAttachments'])).toBeTruthy()
    expect(await within(detail).findByAltText('shot.png')).toBeTruthy()

    fireEvent.click(within(detail).getByText(en['shell.more']))
    for (const hint of [en['shell.rulesHint'], en['shell.evidenceHint'], en['shell.surfaceHint']]) {
      expect(within(detail).getByText(hint)).toBeTruthy()
    }
    expect(within(detail).getByText(en['shell.surfaceReadContract'])).toBeTruthy()
    expect(within(detail).queryByText('读 / 契约')).toBeNull()
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
          // drafting 且带方案回指会换成需求卡片；这条要验普通详情的调度留档，所以用 implementing。
          'T-02.yaml': 'id: T-02\ntitle: 与 T-01 同方案的任务\nstate: implementing\ngrade: B\nproposal: P-01\n',
        },
      },
      sessions: [sessionRow('s-1', REPO, true)],
      running: new Set(['s-1']),
    })

    await openTask('与 T-01 同方案的任务')
    fireEvent.click(screen.getAllByRole('button', { name: zh['shell.submitAcceptance'] })[0]!)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    // 重新点开详情：判定已留档，日志失败也记在这一条上。
    fireEvent.click(screen.getAllByText('与 T-01 同方案的任务')[0]!)
    await screen.findByRole('dialog')

    expect(screen.queryByText('调度思考过程')).toBeNull()
    expect(screen.queryByText('候选会话')).toBeNull()
    for (const detail of container.querySelectorAll('details')) {
      expect(detail.textContent).not.toContain('调度思考过程')
      expect(detail.textContent).not.toContain('候选会话')
    }

    expect(screen.getByText(zh['shell.queuedIn']).parentElement?.textContent).toContain('第 1 位')
    expect(screen.getByText('调度日志没写成：evidence 目录不可写')).toBeTruthy()
  })
})

describe('需求详情的动作、拆分与讨论历史', () => {
  const REQUIREMENT_DOC = '# 项目需求概要 V1\n\n## 第一版功能清单\n- 记一笔\n- 翻记录\n\n## 暂不开发\n- 云同步\n'
  const REQ_CONFIRMED = 'id: REQ-01\ntitle: 随手记账\nstate: confirmed\nopened_at: 2026-11-12T09:00:00.000Z\n'
  const REQ_DRAFT = 'id: REQ-01\ntitle: 随手记账\nstate: draft\nopened_at: 2026-11-12T09:00:00.000Z\n'

  it('确认需求派 requirement_approve，回执原样留在抽屉里', async () => {
    const approveRequirement = vi.fn(async () => ({ ok: true, text: '已确认 REQ-01' }))
    renderShell({
      spec: { requirements: { 'REQ-01.yaml': REQ_DRAFT, 'REQ-01.md': REQUIREMENT_DOC } },
      approveRequirement,
    })
    const drawer = await openRequirement('REQ-01')

    fireEvent.click(within(drawer).getByRole('button', { name: zh['shell.confirmRequirement'] }))
    await waitFor(() => { expect(approveRequirement).toHaveBeenCalledWith(SessionId('s-1'), 'REQ-01') })
    expect(await within(drawer).findByText('已确认 REQ-01')).toBeTruthy()
  })

  it('命令失败时原文就地显示，不伪造成功', async () => {
    const closeRequirement = vi.fn(async () => ({ ok: false, text: 'REQ-01 已上线，是终态' }))
    renderShell({
      spec: { requirements: { 'REQ-01.yaml': REQ_CONFIRMED, 'REQ-01.md': REQUIREMENT_DOC } },
      closeRequirement,
    })
    const drawer = await openRequirement('REQ-01')

    fireEvent.click(within(drawer).getByRole('button', { name: zh['shell.requirementClose'] }))
    expect(await within(drawer).findByText('REQ-01 已上线，是终态')).toBeTruthy()
  })

  it('已确认给拆分、发布与关闭；已上线不再给动作', async () => {
    renderShell({ spec: { requirements: { 'REQ-01.yaml': REQ_CONFIRMED, 'REQ-01.md': REQUIREMENT_DOC } } })
    let drawer = await openRequirement('REQ-01')
    for (const key of ['shell.splitTasks', 'shell.requirementRelease', 'shell.requirementClose'] as const) {
      expect(within(drawer).getByRole('button', { name: zh[key] })).toBeTruthy()
    }
    fireEvent.click(drawer.querySelector('[data-requirement-drawer-close]') as HTMLElement)

    cleanup()
    renderShell({
      spec: {
        requirements: {
          'REQ-01.yaml': 'id: REQ-01\ntitle: 随手记账\nstate: released\nopened_at: 2026-11-12T09:00:00.000Z\n',
          'REQ-01.md': REQUIREMENT_DOC,
        },
      },
    })
    drawer = await openRequirement('REQ-01')
    for (const key of ['shell.splitTasks', 'shell.requirementRelease', 'shell.requirementClose', 'shell.confirmRequirement'] as const) {
      expect(within(drawer).queryByRole('button', { name: zh[key] })).toBeNull()
    }
  })

  it('拆分先建项目经理会话，并把 REQ 编号写成任务回指', async () => {
    const sent: { sessionId: SessionId; content: string }[] = []
    const sendPrompt: NonNullable<ShellProps['sendPrompt']> = async (sessionId, content) => {
      sent.push({ sessionId, content: typeof content === 'string' ? content : '' })
    }
    const createSession = vi.fn(async () => SessionId('s-9'))
    renderShell({
      spec: { requirements: { 'REQ-01.yaml': REQ_CONFIRMED, 'REQ-01.md': REQUIREMENT_DOC } },
      sendPrompt,
      createSession,
    })
    const drawer = await openRequirement('REQ-01')

    fireEvent.click(within(drawer).getByRole('button', { name: zh['shell.splitTasks'] }))
    await waitFor(() => { expect(createSession).toHaveBeenCalledTimes(1) })
    expect(createSession).toHaveBeenCalledWith(REPO, 'lcoder-pm')
    await waitFor(() => { expect(sent).toHaveLength(1) })
    expect(String(sent[0]?.sessionId)).toBe('s-9')
    expect(sent[0]?.content).toContain('《项目需求概要》正文（.spec/requirements/REQ-01.md）')
    expect(sent[0]?.content).toContain('- 记一笔\n- 翻记录')
    expect(sent[0]?.content).toContain('requirement: REQ-01')
    expect(sent[0]?.content).toContain('不要写 proposal')
    expect(await within(drawer).findByText(zh['shell.splitPmRunning'])).toBeTruthy()
    expect(document.querySelector<HTMLButtonElement>('[data-requirement-split]')?.disabled).toBe(true)
  })

  it('没有正文时不给拆分入口，也不开任何会话', async () => {
    const createSession = vi.fn(async () => SessionId('s-9'))
    renderShell({
      spec: { requirements: { 'REQ-01.yaml': REQ_CONFIRMED } },
      createSession,
      sendPrompt: async () => {},
    })
    const drawer = await openRequirement('REQ-01')

    expect(within(drawer).getByText(zh['shell.requirementDocumentMissing'])).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: zh['shell.splitTasks'] })).toBeNull()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('项目经理拆出的任务只标轨，不再建研发经理会话或逐条分配', async () => {
    const spec: { requirements: Record<string, string>; tasks: Record<string, string> } = {
      requirements: { 'REQ-01.yaml': REQ_CONFIRMED, 'REQ-01.md': REQUIREMENT_DOC },
      tasks: {},
    }
    const messages = new Map<string, readonly ShellMessage[]>()
    let next = 9
    const createSession: NonNullable<ShellProps['createSession']> = vi.fn(async (_path: string) => {
      const id = SessionId(`s-${next}`)
      next += 1
      return id
    })
    const sendPrompt: NonNullable<ShellProps['sendPrompt']> = async (sessionId, content) => {
      void content
      if (String(sessionId) === 's-9') {
        messages.set(String(sessionId), [{ role: 'assistant', text: '已拆出 T-02。' }])
        spec.tasks['T-02.yaml'] = 'id: T-02\ntitle: 记一笔\nstate: drafting\ngrade: B\nrequirement: REQ-01\ntrack: h5\n'
      }
    }
    const assignTask: NonNullable<ShellProps['assignTask']> = vi.fn(async () => ({ ok: true, text: '已分配' }))
    renderShell({
      spec,
      createSession,
      sendPrompt,
      assignTask,
      readMessages: id => messages.get(String(id)) ?? [],
      holdSession: () => () => {},
    })
    const drawer = await openRequirement('REQ-01')

    fireEvent.click(within(drawer).getByRole('button', { name: zh['shell.splitTasks'] }))
    expect(await within(drawer).findByText(t('shell.splitResult', { tasks: '1' }))).toBeTruthy()
    expect(assignTask).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createSession).toHaveBeenNthCalledWith(1, REPO, 'lcoder-pm')
    expect(await within(drawer).findByText(t('shell.splitTracks', { tracks: 'H5 前端 1' }))).toBeTruthy()

    fireEvent.click(drawer.querySelector('[data-requirement-drawer-close]') as HTMLElement)
    const reopened = await openRequirement('REQ-01')
    expect(await within(reopened).findByText(t('shell.splitResult', { tasks: '1' }))).toBeTruthy()
    // 已有回指任务时进度进入「已拆分」，拆放入口不再出现，重复拆不可能发生。
    expect(within(reopened).queryByRole('button', { name: zh['shell.splitTasks'] })).toBeNull()
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('重启后讨论历史走异步端口：ready 后读到的消息按角色展示', async () => {
    const messages: readonly ShellMessage[] = [
      {
        role: 'user',
        text: '方案讨论：需求 REQ-01 已按轨拆分。\n参会身份：项目经理（pm）',
      },
      { role: 'assistant', text: '按三条任务拆分，基础框架排第一。' },
    ]
    const readSessionMessages: NonNullable<ShellProps['readSessionMessages']> = vi.fn(async (sessionId) => {
      await Promise.resolve()
      return sessionId === SessionId('s-1') ? messages : null
    })
    renderShell({
      spec: { requirements: { 'REQ-01.yaml': REQ_CONFIRMED, 'REQ-01.md': REQUIREMENT_DOC } },
      preset: 'lcoder-pm',
      readSessionMessages,
    })
    const drawer = await openRequirement('REQ-01')

    fireEvent.click(within(drawer).getByRole('button', { name: zh['shell.discussionHistory'] }))
    expect(await screen.findByText('按三条任务拆分，基础框架排第一。')).toBeTruthy()
    expect(readSessionMessages).toHaveBeenCalledWith(SessionId('s-1'))
    expect(document.querySelector('[data-discussion-history-group="pm"]')).not.toBeNull()
  })

  it('重启扫描只认参会身份标记：立项与拆分会话提到需求也不进历史', async () => {
    const messages: Readonly<Record<string, readonly ShellMessage[]>> = {
      's-intake': [
        { role: 'user', text: '立项：按 .spec/requirements/REQ-01.md 落需求。' },
        { role: 'assistant', text: '需求已立项。' },
      ],
      's-split': [
        { role: 'user', text: '拆分完成：REQ-01 已拆出 T-02。' },
        { role: 'assistant', text: '拆分完成汇报。' },
      ],
      's-meet': [
        { role: 'user', text: '方案讨论：需求 REQ-01 已按轨拆分。\n参会身份：架构师（architect）' },
        { role: 'assistant', text: '契约要点如下。' },
      ],
    }
    const readSessionMessages: NonNullable<ShellProps['readSessionMessages']> =
      async sessionId => messages[String(sessionId)] ?? null
    renderShell({
      spec: { requirements: { 'REQ-01.yaml': REQ_CONFIRMED, 'REQ-01.md': REQUIREMENT_DOC } },
      sessions: [
        sessionRow('s-intake', REPO, false),
        sessionRow('s-split', REPO, false),
        sessionRow('s-meet', REPO, false),
      ],
      presets: { 's-intake': 'lcoder', 's-split': 'lcoder-pm', 's-meet': 'lcoder-architect' },
      readSessionMessages,
    })
    const drawer = await openRequirement('REQ-01')

    fireEvent.click(within(drawer).getByRole('button', { name: zh['shell.discussionHistory'] }))
    expect(await screen.findByText('契约要点如下。')).toBeTruthy()
    expect(document.querySelector('[data-discussion-history-group="architect"]')).not.toBeNull()
    expect(document.querySelector('[data-discussion-history-group="track"]')).toBeNull()
    expect(document.querySelector('[data-discussion-history-group="pm"]')).toBeNull()
  })

  it('看板刷新投影不关掉已打开的讨论历史，读取结果照常落位', async () => {
    const messages: readonly ShellMessage[] = [
      {
        role: 'user',
        text: '方案讨论：需求 REQ-01 已按轨拆分。\n参会身份：项目经理（pm）',
      },
      { role: 'assistant', text: '按三条任务拆分，基础框架排第一。' },
    ]
    let releaseHistory: ((value: readonly ShellMessage[] | null) => void) | undefined
    const readSessionMessages: NonNullable<ShellProps['readSessionMessages']> = () =>
      new Promise<readonly ShellMessage[] | null>((resolve) => { releaseHistory = resolve })
    const requirements: Record<string, string> = { 'REQ-01.yaml': REQ_CONFIRMED, 'REQ-01.md': REQUIREMENT_DOC }
    renderShell({ spec: { requirements }, preset: 'lcoder-pm', readSessionMessages })
    const drawer = await openRequirement('REQ-01')

    fireEvent.click(within(drawer).getByRole('button', { name: zh['shell.discussionHistory'] }))
    expect(screen.getByText(zh['shell.historyLoading'])).toBeTruthy()
    expect(document.querySelector('[data-discussion-history]')).not.toBeNull()

    // 模拟十秒一次的看板重读：同一条需求被换成新快照，标题变了才算重读真的落地。
    requirements['REQ-01.yaml'] = REQ_CONFIRMED.replace('title: 随手记账', 'title: 随手记账（刷新后）')
    fireEvent.focus(window)
    expect(await screen.findByRole('dialog', { name: /REQ-01 随手记账（刷新后）/ })).toBeTruthy()
    expect(document.querySelector('[data-discussion-history]')).not.toBeNull()
    expect(screen.getByText(zh['shell.historyLoading'])).toBeTruthy()

    await act(async () => { releaseHistory?.(messages) })
    expect(await screen.findByText('按三条任务拆分，基础框架排第一。')).toBeTruthy()
    expect(document.querySelector('[data-discussion-history-group="pm"]')).not.toBeNull()
  })

  it('换到另一条需求时收起讨论历史', async () => {
    const readSessionMessages: NonNullable<ShellProps['readSessionMessages']> = async () => [
      { role: 'user', text: '方案讨论：需求 REQ-01 已按轨拆分。\n参会身份：项目经理（pm）' },
      { role: 'assistant', text: '按三条任务拆分，基础框架排第一。' },
    ]
    renderShell({
      spec: {
        requirements: {
          'REQ-01.yaml': REQ_CONFIRMED,
          'REQ-01.md': REQUIREMENT_DOC,
          'REQ-02.yaml': 'id: REQ-02\ntitle: 会员积分\nstate: confirmed\nopened_at: 2026-11-12T10:00:00.000Z\n',
          'REQ-02.md': '# 会员积分\n\n## 第一版功能清单\n- 积分累计\n',
        },
      },
      preset: 'lcoder-pm',
      readSessionMessages,
    })
    const drawer = await openRequirement('REQ-01')

    fireEvent.click(within(drawer).getByRole('button', { name: zh['shell.discussionHistory'] }))
    expect(await screen.findByText('按三条任务拆分，基础框架排第一。')).toBeTruthy()

    fireEvent.click(screen.getByText('REQ-02', { selector: 'td' }))
    expect(await screen.findByRole('dialog', { name: /REQ-02 会员积分/ })).toBeTruthy()
    expect(document.querySelector('[data-discussion-history]')).toBeNull()
  })

  it('候选会话读不出来时提示读取失败，而不是定位不到', async () => {
    renderShell({
      spec: { requirements: { 'REQ-01.yaml': REQ_CONFIRMED, 'REQ-01.md': REQUIREMENT_DOC } },
      preset: 'lcoder-pm',
      readSessionMessages: async () => null,
    })
    const drawer = await openRequirement('REQ-01')

    fireEvent.click(within(drawer).getByRole('button', { name: zh['shell.discussionHistory'] }))
    expect(await screen.findByText(zh['shell.historyUnavailable'])).toBeTruthy()
    expect(screen.queryByText(t('shell.historyNotFound', { requirement: 'REQ-01' }))).toBeNull()
  })
})

describe('左侧菜单与任务页的归属需求', () => {
  const REQ_ROW = 'id: REQ-01\ntitle: 随手记账\nstate: confirmed\nopened_at: 2026-11-12T09:00:00.000Z\n'
  const REQ_DOC = '# 项目需求概要 V1\n\n## 第一版功能清单\n- 记一笔\n'

  it('旧需求本体任务从任务页隐藏，其余卡片显示所属需求编号', async () => {
    const { container } = renderShell({
      spec: {
        tasks: {
          'T-01.yaml': 'id: T-01\ntitle: 需求本体任务\nstate: drafting\ngrade: B\nproposal: P-01\n',
          'T-02.yaml': 'id: T-02\ntitle: 拆出来的任务\nstate: drafting\ngrade: B\nrequirement: REQ-01\ntrack: h5\n',
          'T-03.yaml': 'id: T-03\ntitle: 旧方案任务\nstate: drafting\ngrade: B\nproposal: P-09\ntrack: h5\n',
        },
      },
    })

    expect(await screen.findByText('拆出来的任务')).toBeTruthy()
    expect(screen.queryByText('需求本体任务')).toBeNull()
    expect(screen.getByText('旧方案任务')).toBeTruthy()
    expect(container.querySelector('[data-task-requirement="REQ-01"]')).not.toBeNull()
    // 旧数据只有 proposal：仍把方案编号挂回卡片，不丢线索。
    expect(container.querySelector('[data-task-requirement="P-09"]')).not.toBeNull()
  })

  it('详情里的所属需求跳到需求页并打开同一条需求', async () => {
    renderShell({
      spec: {
        tasks: { 'T-02.yaml': 'id: T-02\ntitle: 拆出来的任务\nstate: drafting\ngrade: B\nrequirement: REQ-01\ntrack: h5\n' },
        requirements: { 'REQ-01.yaml': REQ_ROW, 'REQ-01.md': REQ_DOC },
      },
    })
    const detail = await openTask('拆出来的任务')
    fireEvent.click(within(detail).getByText('REQ-01'))

    expect(await screen.findByRole('dialog', { name: /REQ-01 随手记账/ })).toBeTruthy()
    expect(document.querySelector('[data-lcoder-requirements]')).not.toBeNull()
  })

  it('需求页记住表格/看板视图，切到任务再切回来仍是看板', async () => {
    const { container } = renderShell({
      spec: { requirements: { 'REQ-01.yaml': REQ_ROW, 'REQ-01.md': REQ_DOC } },
    })
    await waitFor(() => { expect(document.querySelector('[data-nav="requirements"]')).not.toBeNull() })
    fireEvent.click(document.querySelector('[data-nav="requirements"]') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: zh['shell.requirementViewBoard'] }))
    expect(container.querySelector('[data-requirement-board]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-nav="tasks"]') as HTMLElement)
    expect(container.querySelector('[data-requirement-board]')).toBeNull()
    fireEvent.click(document.querySelector('[data-nav="requirements"]') as HTMLElement)
    expect(container.querySelector('[data-requirement-board]')).not.toBeNull()
  })
})

describe('任务页的看板与列表切换', () => {
  /** 四条任务：讨论中的、开发中的、旧方案回指的、旧需求本体（应隐藏）。 */
  const LIST_TASKS = {
    'T-00.yaml': 'id: T-00\ntitle: 需求本体任务\nstate: drafting\ngrade: B\nproposal: P-01\n',
    'T-01.yaml': 'id: T-01\ntitle: 讨论中的任务\nstate: drafting\ngrade: A\ntrack: api\nopened_at: 2026-11-11T09:00:00.000Z\n',
    'T-02.yaml': [
      'id: T-02',
      'title: 开发中的任务',
      'state: implementing',
      'grade: B',
      'requirement: REQ-01',
      'track: h5',
      'depends_on:',
      '  - T-01',
      'opened_at: 2026-11-12T09:00:00.000Z',
      '',
    ].join('\n'),
    'T-03.yaml': 'id: T-03\ntitle: 旧方案任务\nstate: contracted\ngrade: C\nproposal: P-09\n',
  }

  /** 等看板画出任务，再切到列表。 */
  async function openTaskList(): Promise<HTMLElement> {
    const view = renderShell({ spec: { tasks: LIST_TASKS } })
    await screen.findByText('开发中的任务')
    fireEvent.click(screen.getByRole('button', { name: zh['shell.taskViewList'] }))
    return view.container
  }

  it('默认看板；切到列表后出现七列表头，再切回看板即收起', async () => {
    const { container } = renderShell({ spec: { tasks: LIST_TASKS } })
    await screen.findByText('开发中的任务')
    expect(container.querySelector('[data-task-list]')).toBeNull()
    expect(screen.getByRole('button', { name: zh['shell.taskViewBoard'] }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: zh['shell.taskViewList'] }))
    expect(container.querySelector('[data-task-list]')).not.toBeNull()
    expect(screen.getByRole('button', { name: zh['shell.taskViewList'] }).getAttribute('aria-pressed')).toBe('true')

    for (const key of ['shell.requirementNo', 'shell.requirementTitle', 'shell.requirementState',
      'shell.requirement', 'shell.track', 'shell.taskDependency', 'shell.requirementUpdatedAt'] as const) {
      expect(screen.getByRole('columnheader', { name: zh[key] })).toBeTruthy()
    }

    fireEvent.click(screen.getByRole('button', { name: zh['shell.taskViewBoard'] }))
    expect(container.querySelector('[data-task-list]')).toBeNull()
  })

  it('行按编号升序，列出状态、需求回退、轨、依赖与更新时间；旧需求本体不出现', async () => {
    const container = await openTaskList()

    const rows = [...container.querySelectorAll('[data-task-row]')].map(row => row.getAttribute('data-task-row'))
    expect(rows).toEqual(['T-01', 'T-02', 'T-03'])
    expect(screen.queryByText('需求本体任务')).toBeNull()

    const discuss = container.querySelector('[data-task-row="T-01"]') as HTMLElement
    // drafting + 已标轨 → 方案讨论；不显示原始状态名。
    expect(discuss.textContent).toContain(zh['shell.discussing'])
    expect(discuss.textContent).not.toContain(zh['shell.drafting'])
    expect(discuss.textContent).toContain('接口')
    expect(discuss.textContent).toContain(zh['shell.taskDependsNone'])
    expect(discuss.textContent).toContain('2026')

    const developing = container.querySelector('[data-task-row="T-02"]') as HTMLElement
    expect(developing.textContent).toContain(zh['shell.implementing'])
    expect(developing.textContent).toContain('REQ-01')
    expect(developing.textContent).toContain('H5 前端')
    expect(developing.textContent).toContain('T-01')

    const legacy = container.querySelector('[data-task-row="T-03"]') as HTMLElement
    expect(legacy.textContent).toContain(zh['shell.contracted'])
    // 旧数据没有 requirement 时回退方案编号；没写轨按通用；没有依赖写「无」。
    expect(legacy.textContent).toContain('P-09')
    expect(legacy.textContent).toContain('通用')
    expect(legacy.textContent).toContain(zh['shell.taskDependsNone'])
    // 没有 opened_at：更新时间显示破折号。
    expect(legacy.textContent).toContain('—')
  })

  it('点整行或用 Enter 打开任务详情', async () => {
    const container = await openTaskList()

    fireEvent.click(container.querySelector('[data-task-row="T-02"]') as HTMLElement)
    const detail = await screen.findByRole('dialog')
    expect(detail.getAttribute('aria-label')).toBe('T-02 开发中的任务')
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.cancel'] }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    fireEvent.keyDown(container.querySelector('[data-task-row="T-03"]') as HTMLElement, { key: 'Enter' })
    const byKey = await screen.findByRole('dialog')
    expect(byKey.getAttribute('aria-label')).toBe('T-03 旧方案任务')
  })

  it('关键字筛选同时作用于列表；没有命中时给空态', async () => {
    const container = await openTaskList()

    fireEvent.click(screen.getByRole('button', { name: zh['shell.filter'] }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '旧方案' } })
    const rows = [...container.querySelectorAll('[data-task-row]')].map(row => row.getAttribute('data-task-row'))
    expect(rows).toEqual(['T-03'])

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的任务' } })
    expect(container.querySelector('[data-task-row]')).toBeNull()
    expect(screen.getByText(zh['shell.filterEmpty'])).toBeTruthy()
  })

  it('英文界面给出切换与表头文案', async () => {
    renderShell({ spec: { tasks: LIST_TASKS }, t: enT })
    await screen.findByText('开发中的任务')
    fireEvent.click(screen.getByRole('button', { name: en['shell.taskViewList'] }))

    for (const key of ['shell.requirementNo', 'shell.requirementTitle', 'shell.requirementState',
      'shell.requirement', 'shell.track', 'shell.taskDependency', 'shell.requirementUpdatedAt'] as const) {
      expect(screen.getByRole('columnheader', { name: en[key] })).toBeTruthy()
    }
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
    await openTask('修复 vue 页面组件')

    const detail = screen.getByRole('dialog', { name: 'T-01 修复 vue 页面组件' })
    fireEvent.click(within(detail).getByRole('button', { name: en['shell.roleDialogTitle'] }))
    const roleDialog = screen.getByRole('dialog', { name: en['shell.roleDialogTitle'] })

    expect(within(roleDialog).getByText('Current role: Unassigned')).toBeTruthy()
    expect(within(roleDialog).getByRole('button', { name: en['shell.roleDialogConfirm'] })).toBeTruthy()
    expect(within(roleDialog).getByText(en['shell.roleHintBadge'])).toBeTruthy()
    expect(within(roleDialog).getByRole('button', { name: /^Vue Engineer|^Vue 工程师/ })).toBeTruthy()
  })
})

describe('任务详情的阶段文案', () => {
  it('详情不再显示启动咒语与复制提示词', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_T01 } } })
    const detail = await openTask('起草中的任务')

    expect(within(detail).queryByText(/dev-flow 启动咒语/)).toBeNull()
    expect(within(detail).queryByText('自动填入，可编辑')).toBeNull()
    expect(within(detail).queryByRole('button', { name: '复制提示词' })).toBeNull()
    expect(within(detail).queryByRole('textbox')).toBeNull()
  })

  it('五态下详情标签与头尾两个按钮文案各自正确', async () => {
    renderShell({ spec: { tasks: stageTasks() } })

    for (const item of STAGE_CASES) {
      const detail = await openTask(item.title)
      expect(within(detail).getByText(zh[item.label])).toBeTruthy()
      // 头部与底部是同一句话，两个入口都能看到。
      expect(within(detail).getAllByRole('button', { name: zh[item.action] }).length).toBe(2)

      fireEvent.click(within(detail).getByRole('button', { name: zh['shell.cancel'] }))
      await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    }
  })

  it('看板只有方案讨论、待开发、开发中、验收中、已完成五列', async () => {
    renderShell({ spec: { tasks: stageTasks() } })

    for (const key of ['shell.discussing', 'shell.contracted', 'shell.implementing', 'shell.verifying', 'shell.closed'] as const) {
      expect(await screen.findByText(zh[key])).toBeTruthy()
    }
    // 需求确认列已去掉：需求本体在需求页管理，任务页不再出现这一列。
    expect(screen.queryByText(zh['shell.drafting'])).toBeNull()
    for (const old of ['起草', '已签契约', '实施中', '验证中', '已收口']) {
      expect(screen.queryByText(old)).toBeNull()
    }
  })

  it('英文界面给出阶段名与阶段按钮', async () => {
    renderShell({ spec: { tasks: stageTasks() }, t: enT })

    for (const item of STAGE_CASES) {
      expect(await screen.findByText(en[item.label])).toBeTruthy()
    }

    const detail = await openTask(STAGE_CASES[0].title)
    expect(within(detail).getByText(en['shell.drafting'])).toBeTruthy()
    expect(within(detail).getAllByRole('button', { name: en['shell.confirmRequirement'] }).length).toBe(2)
    expect(within(detail).queryByText(/dev-flow startup prompt/)).toBeNull()
    expect(within(detail).queryByRole('button', { name: 'Copy prompt' })).toBeNull()
  })
})

/** 登录态事实；状态替身复用这两份。 */
const SIGNED_IN_STATE: CloudState = {
  signedIn: true, needsLogin: false,
  user: { id: 'u1', displayName: null, phoneMasked: '+861****0000', status: 'active' },
  quota: null, estimate: null, guest: null, guestExpired: false, lastError: null,
}
const SIGNED_OUT_STATE: CloudState = {
  ...SIGNED_IN_STATE, signedIn: false, needsLogin: true, user: null,
}

describe('登录门禁（整页）', () => {
  it('未登录时只渲染全屏登录页，工作台不在 DOM 里', async () => {
    const cloud = signedInCloud()
    cloud.state = async () => ({ ok: true, value: SIGNED_OUT_STATE })
    renderShell({ spec: {}, cloud })

    expect(await screen.findByRole('heading', { name: zh['shell.cloudSignIn'], level: 2 })).toBeTruthy()
    expect(screen.queryByText(zh['shell.board'])).toBeNull()
    expect(screen.queryByRole('button', { name: zh['shell.startWork'] })).toBeNull()
    expect(screen.queryByTitle(zh['shell.newSession'])).toBeNull()
    expect(document.querySelector('[class*="modalBackdrop"]')).toBeNull()
  })

  it('登录后渲染工作台', async () => {
    renderShell({ spec: {} })
    expect(await screen.findByText(zh['shell.board'])).toBeTruthy()
    expect(screen.queryByRole('heading', { name: zh['shell.cloudSignIn'], level: 2 })).toBeNull()
  })

  it('读取登录状态时显示加载态', () => {
    const cloud = signedInCloud()
    cloud.state = () => new Promise<never>(() => {})
    renderShell({ spec: {}, cloud })
    expect(screen.getByText(zh['shell.loginChecking'])).toBeTruthy()
    expect(screen.queryByText(zh['shell.board'])).toBeNull()
  })

  it('读不到登录状态时就地报错并可重试，不放行到工作台', async () => {
    const state = vi.fn(async () => ({ ok: false as const, error: { code: 'cloud_unavailable', message: 'not mounted' } }))
    const cloud = signedInCloud()
    cloud.state = state
    renderShell({ spec: {}, cloud })

    expect(await screen.findByText(zh['shell.loginUnavailable'])).toBeTruthy()
    expect(screen.queryByText(zh['shell.board'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.loginRetry'] }))
    await waitFor(() => { expect(state).toHaveBeenCalledTimes(2) })
  })

  it('退出登录后回到全屏登录页', async () => {
    let signed = true
    const cloud = signedInCloud()
    cloud.state = async () => ({ ok: true, value: signed ? SIGNED_IN_STATE : SIGNED_OUT_STATE })
    cloud.logout = vi.fn(async () => { signed = false; return { ok: true as const, value: { ok: true } } })
    renderShell({ spec: {}, cloud })

    expect(await screen.findByText(zh['shell.board'])).toBeTruthy()
    fireEvent.click(screen.getByTitle(zh['shell.cloudAccount']))
    fireEvent.click(await screen.findByRole('button', { name: zh['shell.cloudLogout'] }))
    fireEvent.click(await screen.findByRole('button', { name: zh['shell.cloudConfirmLogout'] }))

    expect(await screen.findByRole('heading', { name: zh['shell.cloudSignIn'], level: 2 })).toBeTruthy()
    expect(screen.queryByText(zh['shell.board'])).toBeNull()
  })
})

describe('旧匿名会话', () => {
  it('打开时切回用户路由一次，不重复切换', async () => {
    const cloud = signedInCloud()
    const selectRoute = vi.fn(async () => ({ ok: true as const, value: { provider: 'lcoder-cloud', model: 'deepseek-flash' } }))
    cloud.selectRoute = selectRoute
    renderShell({ spec: {}, cloud, provider: 'lcoder-cloud-guest' })

    await waitFor(() => { expect(selectRoute).toHaveBeenCalledWith(SessionId('s-1')) })
    expect(selectRoute).toHaveBeenCalledTimes(1)
  })
})

/** 一条新建会话路径：任务对话、常驻角色会话或普通新会话。 */
interface NewSessionPath {
  readonly title: string
  readonly spec: SpecFiles
  /** 这条路径除云端与设置面之外还要注入的 props。 */
  readonly props?: Partial<ShellScenario>
  /** 在外壳渲染之后触发这条路径的新建分支。 */
  readonly enter: () => Promise<void>
}

const NEW_SESSION_PATHS: readonly NewSessionPath[] = [
  {
    title: '任务对话',
    spec: { tasks: { 'T-01.yaml': TASK_T01 } },
    props: {
      bindTask: async () => ({ ok: true, text: '已绑定' }),
      sendPrompt: async () => {},
    },
    enter: async () => {
      const detail = await openTask('起草中的任务')
      const actions = within(detail).getAllByRole('button', { name: zh['shell.confirmRequirement'] })
      fireEvent.click(actions[actions.length - 1] as HTMLElement)
    },
  },
  {
    title: '常驻角色会话',
    spec: {},
    enter: async () => {
      fireEvent.click(await screen.findByTitle(zh['shell.openScheduler']))
    },
  },
  {
    title: '普通新会话',
    spec: {},
    enter: async () => {
      fireEvent.click(await screen.findByTitle(zh['shell.newSession']))
      fireEvent.click(await screen.findByRole('button', { name: zh['shell.newSessionGo'] }))
    },
  },
]

describe('新建会话跟随设置默认模型', () => {
  const OFFICIAL = { provider: 'deepseek-official', model: 'deepseek-chat' } as const

  /** 云端面加上路由调用的记录器，用来断言新建路径不再切云端。 */
  function cloudWithRouteSpy(): { cloud: CloudFace; selectRoute: ReturnType<typeof vi.fn> } {
    const cloud = signedInCloud()
    const selectRoute = vi.fn(async () => ({
      ok: true as const,
      value: { provider: 'lcoder-cloud', model: 'deepseek-flash' },
    }))
    cloud.selectRoute = selectRoute
    return { cloud, selectRoute }
  }

  /** 把微任务与零延迟定时器跑空：负向断言前等新建会话的后续步骤落定。 */
  async function settle(): Promise<void> {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }

  for (const path of NEW_SESSION_PATHS) {
    it(`${path.title}写入官网默认模型，不切云端路由`, async () => {
      const { cloud, selectRoute } = cloudWithRouteSpy()
      const { face, setDefault } = fakeModelSettings({ ...OFFICIAL })
      const createSession = vi.fn(async () => SessionId('s-9'))
      renderShell({ spec: path.spec, cloud, modelSettings: face, createSession, ...path.props })
      await path.enter()

      await waitFor(() => {
        expect(setDefault).toHaveBeenCalledWith(SessionId('s-9'), OFFICIAL.provider, OFFICIAL.model)
      })
      expect(createSession).toHaveBeenCalledTimes(1)
      expect(selectRoute).not.toHaveBeenCalled()
    })

    it(`${path.title}没有默认模型时交给宿主默认，不切云端路由`, async () => {
      const { cloud, selectRoute } = cloudWithRouteSpy()
      const { face, setDefault } = fakeModelSettings()
      const createSession = vi.fn(async () => SessionId('s-9'))
      renderShell({ spec: path.spec, cloud, modelSettings: face, createSession, ...path.props })
      await path.enter()
      await settle()

      expect(createSession).toHaveBeenCalledTimes(1)
      expect(setDefault).not.toHaveBeenCalled()
      expect(selectRoute).not.toHaveBeenCalled()
    })
  }
})

describe('顶栏项目控件与项目信息抽屉', () => {
  const OTHER = 'E:/Projects/other'

  function workspaceItem(id: string, title: string, path: string, sessionIds: readonly SessionId[]) {
    return {
      workspaceId: WorkspaceId(id),
      path,
      title,
      sessionIds,
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    }
  }

  it('顶栏只剩一个项目控件，点开后可在抽屉里切换工作区并关闭', async () => {
    const { container } = renderShell({
      spec: {},
      sessions: [
        sessionRow('s-1', REPO, false),
        sessionRow('s-2', OTHER, false),
        sessionRow('s-3', OTHER, false),
      ],
      workspaces: [
        workspaceItem('w-1', 'demo', REPO, [SessionId('s-1')]),
        workspaceItem('w-2', 'other', OTHER, [SessionId('s-2'), SessionId('s-3')]),
      ],
    })

    const trigger = await screen.findByRole('button', { name: 'demo' })
    const header = container.querySelector('header')
    expect(header).not.toBeNull()
    const topbar = within(header as HTMLElement)
    expect(topbar.queryByTitle(zh['shell.switchProject'])).toBeNull()
    expect(topbar.queryByText(`ⓘ ${zh['shell.projectInfo']}`)).toBeNull()
    expect(trigger.textContent).not.toContain(REPO)

    fireEvent.click(trigger)
    const heading = await screen.findByRole('heading', { name: zh['shell.projectInfo'] })
    const drawer = heading.closest('aside')
    expect(drawer).not.toBeNull()
    const body = within(drawer as HTMLElement)
    expect(body.getByText(zh['shell.projectPickerHint'])).toBeTruthy()
    expect(body.getByPlaceholderText(zh['shell.repoPathHint'])).toBeTruthy()
    expect(body.getByRole('button', { name: zh['shell.openRepo'] })).toBeTruthy()
    expect(body.getByText('✓')).toBeTruthy()
    expect(body.getByText(`1 ${zh['shell.sessions']}`)).toBeTruthy()
    expect(body.getByText(`2 ${zh['shell.sessions']}`)).toBeTruthy()

    fireEvent.click(body.getByText('other'))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: zh['shell.projectInfo'] })).toBeNull()
    })
    expect(within(header as HTMLElement).getByRole('button', { name: 'other' })).toBeTruthy()
  })

  it('抽屉四个小节默认折叠，切换项目只露小节标题与当前项目名', async () => {
    const { container } = renderShell({
      spec: {},
      sessions: [
        sessionRow('s-1', REPO, false),
        sessionRow('s-2', OTHER, false),
      ],
      workspaces: [
        workspaceItem('w-1', 'demo', REPO, [SessionId('s-1')]),
        workspaceItem('w-2', 'other', OTHER, [SessionId('s-2')]),
      ],
    })

    fireEvent.click(await screen.findByRole('button', { name: 'demo' }))
    const heading = await screen.findByRole('heading', { name: zh['shell.projectInfo'] })
    const drawer = heading.closest('aside') as HTMLElement
    const sections = [...drawer.querySelectorAll<HTMLDetailsElement>('details')]
    expect(sections).toHaveLength(4)
    expect(sections.every(section => !section.open)).toBe(true)

    const switchSummary = screen.getByText(zh['shell.switchProject']).closest('summary') as HTMLElement
    expect(switchSummary.textContent).toContain('demo')
    fireEvent.click(switchSummary)
    expect(sections[0]?.open).toBe(true)
    expect(container.ownerDocument.body.textContent).toContain('other')
  })

  it('没有工作区时顶栏显示选择项目，抽屉给出空态与打开仓库', async () => {
    renderShell({ spec: {}, sessions: [], workspaces: [] })
    fireEvent.click(await screen.findByRole('button', { name: zh['shell.chooseProject'] }))

    const heading = await screen.findByRole('heading', { name: zh['shell.projectInfo'] })
    const drawer = heading.closest('aside')
    expect(drawer).not.toBeNull()
    const body = within(drawer as HTMLElement)
    expect(body.getByText(zh['shell.noWorkspace'])).toBeTruthy()
    expect(body.getByPlaceholderText(zh['shell.repoPathHint'])).toBeTruthy()
    expect(body.getByRole('button', { name: zh['shell.openRepo'] })).toBeTruthy()
  })
})

describe('方案讨论列与确认门禁', () => {
  const DISCUSS_TASK = 'id: T-02\ntitle: 记一笔\nstate: drafting\ngrade: B\nproposal: P-01\ntrack: h5\nrole: vue-engineer\n'
  const LIGHT_TASK = 'id: T-03\ntitle: 翻记录\nstate: drafting\ngrade: C\nproposal: P-01\ntrack: h5\nrole: vue-engineer\n'
  const DISCUSS_ROLES = [
    'roles:',
    '  - id: vue-engineer',
    '    name: Vue 工程师',
    '    inherits: dev',
    '  - id: architect',
    '    name: 架构师',
    '    inherits: architect',
    '',
  ].join('\n')
  const UNSIGNED_CONTRACT = [
    'id: T-02',
    'change:',
    '  - 实现记一笔',
    'not_change:',
    '  - 不改需求',
    'acceptance:',
    '  - 保存后在列表可见',
    'fail_if:',
    '  - 金额不合法仍落账',
    '',
  ].join('\n')

  it('已分配岗位的 drafting 任务进方案讨论列，缺契约的标待讨论', async () => {
    renderShell({
      spec: {
        tasks: { 'T-02.yaml': DISCUSS_TASK, 'T-03.yaml': LIGHT_TASK },
        contracts: { 'T-02.contract.yaml': UNSIGNED_CONTRACT },
        roles: DISCUSS_ROLES,
      },
    })
    const discussing = await screen.findByText(zh['shell.discussing'])
    const card = screen.getByText('记一笔').closest('button')
    expect(card?.parentElement?.textContent).toContain(zh['shell.discussing'])
    expect(discussing).toBeTruthy()
    expect(screen.getByText(zh['shell.discussionContractDraftedTag'])).toBeTruthy()
    expect(screen.getByText(zh['shell.discussionWaiting'])).toBeTruthy()
  })

  it('详情列出参与岗位、逐任务契约状态和两个讨论动作', async () => {
    renderShell({
      spec: {
        tasks: { 'T-02.yaml': DISCUSS_TASK },
        contracts: { 'T-02.contract.yaml': UNSIGNED_CONTRACT },
        roles: DISCUSS_ROLES,
      },
    })
    const detail = await openTask('记一笔')
    const section = detail.querySelector('[data-plan-discussion]') as HTMLElement
    expect(section).not.toBeNull()
    expect(section.textContent).toContain('需求分析师')
    expect(section.textContent).toContain('项目经理')
    expect(section.textContent).toContain('研发经理')
    expect(section.textContent).toContain('H5 前端')
    expect(section.textContent).toContain('架构师')
    expect(section.textContent).toContain('T-02 契约已起草，待确认')
    expect(within(section).getByRole('button', { name: zh['shell.discussionConfirm'] })).toBeTruthy()
    expect(within(section).getByRole('button', { name: zh['shell.discussionReconfirm'] })).toBeTruthy()
  })

  it('确认方案逐条签署并推进，签名成功后调用 task_contract', async () => {
    const signContract = vi.fn(async () => ({ ok: true, text: '已签署' }))
    const advanceContract = vi.fn(async () => ({ ok: true, text: '已进入已签约' }))
    renderShell({
      spec: {
        tasks: { 'T-02.yaml': DISCUSS_TASK },
        contracts: { 'T-02.contract.yaml': UNSIGNED_CONTRACT },
        roles: DISCUSS_ROLES,
      },
      signContract,
      advanceContract,
    })
    const detail = await openTask('记一笔')
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.discussionConfirm'] }))
    await waitFor(() => {
      expect(signContract).toHaveBeenCalledWith(SessionId('s-1'), 'T-02')
      expect(advanceContract).toHaveBeenCalledWith(SessionId('s-1'), 'T-02')
    })
  })

  it('需求回指的任务确认方案也走签署与推进', async () => {
    const signContract = vi.fn(async () => ({ ok: true, text: '已签署' }))
    const advanceContract = vi.fn(async () => ({ ok: true, text: '已进入已签约' }))
    renderShell({
      spec: {
        tasks: { 'T-02.yaml': 'id: T-02\ntitle: 记一笔\nstate: drafting\ngrade: B\nrequirement: REQ-01\ntrack: h5\n' },
        contracts: { 'T-02.contract.yaml': UNSIGNED_CONTRACT },
        requirements: { 'REQ-01.md': '# 活动报名\n' },
      },
      signContract,
      advanceContract,
    })
    const detail = await openTask('记一笔')
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.discussionConfirm'] }))
    await waitFor(() => {
      expect(signContract).toHaveBeenCalledWith(SessionId('s-1'), 'T-02')
      expect(advanceContract).toHaveBeenCalledWith(SessionId('s-1'), 'T-02')
    })
  })

  it('签署失败不推进，失败原因留在详情里', async () => {
    const signContract = vi.fn(async () => ({ ok: false, text: '签名被拒' }))
    const advanceContract = vi.fn(async () => ({ ok: true, text: '已进入已签约' }))
    renderShell({
      spec: {
        tasks: { 'T-02.yaml': DISCUSS_TASK },
        contracts: { 'T-02.contract.yaml': UNSIGNED_CONTRACT },
        roles: DISCUSS_ROLES,
      },
      signContract,
      advanceContract,
    })
    const detail = await openTask('记一笔')
    fireEvent.click(within(detail).getByRole('button', { name: zh['shell.discussionConfirm'] }))
    expect(await screen.findByText('T-02 契约签署失败：签名被拒')).toBeTruthy()
    expect(advanceContract).not.toHaveBeenCalled()
  })
})

describe('任务详情的交付物', () => {
  const FOUNDATION_TASK = 'id: T-01\ntitle: 搭建基础框架\nstate: verifying\ngrade: A\n\ntrack: general\n'
  const PLAIN_TASK = 'id: T-02\ntitle: 导出结算记录\nstate: drafting\ngrade: B\n\ntrack: h5\n'
  const DELIVERABLE = [
    'task: T-01',
    'summary: 交付基础框架说明',
    'docs:',
    '  - README.md',
    '  - docs/architecture.md',
    'commands:',
    '  - pnpm typecheck',
  ].join('\n')

  it('展示摘要、文档路径与命令；点文档打开只读预览', async () => {
    const { container } = renderShell({
      spec: {
        tasks: { 'T-01.yaml': FOUNDATION_TASK },
        deliverables: { 'T-01.yaml': DELIVERABLE },
        docs: { 'README.md': '# 项目说明\n这是基础框架。' },
      },
    })
    const dialog = await openTask('搭建基础框架')

    expect(dialog.querySelector('[data-deliverable-summary]')?.textContent).toBe('交付基础框架说明')
    expect(within(dialog).getByText('README.md')).toBeTruthy()
    expect(within(dialog).getByText('docs/architecture.md')).toBeTruthy()
    expect(dialog.querySelector('[data-deliverable-commands]')?.textContent).toContain('pnpm typecheck')
    expect(dialog.querySelector('[data-deliverable-missing]')).toBeNull()

    fireEvent.click(dialog.querySelector('[data-deliverable-doc="README.md"]') as HTMLElement)
    await waitFor(() => {
      expect(document.querySelector('[data-deliverable-preview-body]')?.textContent).toContain('项目说明')
    })
    expect(container).toBeTruthy()
  })

  it('必须交付但缺索引 → 就地提示目标路径与下一步', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': FOUNDATION_TASK } } })
    const dialog = await openTask('搭建基础框架')

    const missing = dialog.querySelector('[data-deliverable-missing]')
    expect(missing?.textContent).toContain('.spec/deliverables/T-01.yaml')
    expect(missing?.textContent).toContain('deliverable_draft')
  })

  it('普通任务没有索引时不画交付物区', async () => {
    renderShell({ spec: { tasks: { 'T-02.yaml': PLAIN_TASK } } })
    const dialog = await openTask('导出结算记录')

    expect(dialog.querySelector('[data-deliverable-section]')).toBeNull()
  })
})
