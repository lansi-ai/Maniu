// @vitest-environment jsdom
/**
 * 任务详情弹窗的渲染事实：不让人选角色、契约提示只在有契约时出现、不再显示启动咒语、
 * 会话动作随任务阶段换文案、调度思考过程移出详情但入队位置与日志失败仍看得见。
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
import type { CloudState } from '@lcoder/kernel/src/cloud/types.ts'
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
  /** 按 `.spec` 相对路径给出的附件字节；缺的路径按读不到处理。 */
  readonly attachments?: Readonly<Record<string, Uint8Array>>
  /** 界面词典；缺省中文，英文用例显式传入。 */
  readonly t?: ShellProps['t']
  /** 云端面替身；缺省已登录。 */
  readonly cloud?: CloudFace
  /** 首条会话投影里的模型路由；用来模拟旧版本遗留的匿名会话。 */
  readonly provider?: string
  /** 工作区列表；缺省给一条会话所在的工作区。 */
  readonly workspaces?: WorkspaceSnapshot['items']
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
    createSession: async () => SessionId('s-9'),
    signContract: async () => ({ ok: true, text: '已签署' }),
    assignTask: scenario.assignTask ?? vi.fn(async () => ({ ok: true, text: '已分配' })),
    logSchedule,
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

/** 一张能过 base64 的最小 PNG 头；渲染端不真的解码图片。 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

/** 两张附件：一张有字节，一张缺失。 */
const TASK_ATTACHED = 'id: T-01\ntitle: 带图的任务\nstate: drafting\ngrade: B\nattachments:\n  - attachments/T-01/shot.png\n  - attachments/T-01/gone.png\n'

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
    `id: ${item.id}\ntitle: ${item.title}\nstate: ${item.state}\ngrade: B\n`,
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
    const task = 'id: T-01\ntitle: Attached task\nstate: drafting\ngrade: B\n'
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
          'T-02.yaml': TASK_T02,
        },
      },
      sessions: [sessionRow('s-1', REPO, true)],
      running: new Set(['s-1']),
    })

    await openTask('与 T-01 同方案的任务')
    fireEvent.click(screen.getAllByRole('button', { name: zh['shell.confirmRequirement'] })[0]!)
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

  it('看板列名与任务卡所在列用新阶段名，旧名不再出现', async () => {
    renderShell({ spec: { tasks: stageTasks() } })

    for (const item of STAGE_CASES) {
      expect(await screen.findByText(zh[item.label])).toBeTruthy()
      const card = screen.getByText(item.title).closest('button')
      expect(card?.parentElement?.textContent).toContain(zh[item.label])
    }
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
