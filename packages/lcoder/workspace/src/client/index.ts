/**
 * 工作台的浏览器侧入口。
 *
 * 三件事，按页签类型的两段式注册来：
 *   1. 类型进 `ctx.sidebarRightTabs`（`definition.ts`）
 *   2. 词典进 `ctx.locale`
 *   3. 正文进键控槽 `sidebar.right.pane.tab`，键是类型自己的 `id`，
 *      并把文件投影面随槽注入（`projection.ts`）
 *
 * 数据面走**文件投影**：读上游现成的 `workspaceFiles` 命名空间，不建自己的
 * Remote。还没到需要 store 的时候——三栏共享的选中项等要跨栏交互了再加。
 *
 * 依赖四样：槽位运行时、词典、页签注册表、远程面。少一样就不激活，
 * 而不是带着半个注册表跑起来。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WORKSPACE_ID, workspaceDefinition } from './definition.ts'
import { withOpenDeadline } from './open-failure.ts'
import { noticeFromSnapshot, statusFromCatalog, statusOfFailure } from './model-status.ts'
import type { ModelStatus, ShellSessionNotice } from './model-status.ts'
import { en, zh } from './locales.ts'
import { loadWorkspaceProjection, PAGE_LINES } from './projection.ts'
import { messagesFromEntries } from './shell/shell-data.ts'
import type { ShellMessage, ShellRole, ShellSignResult } from './shell/shell-data.ts'
import { Shell } from './shell/Shell.tsx'
import { WorkspaceBody } from './WorkspaceBody.tsx'
import type { ProjectionFilesRemote } from './projection.ts'
import type { WorkspaceInject } from './WorkspaceBody.tsx'

export { WORKSPACE_ID, WORKSPACE_KIND } from './definition.ts'
export { WorkspaceOpenTimeoutError, describeOpenFailure, isOpenTimeout } from './open-failure.ts'
export type { LcoderWorkspaceKey } from './locales.ts'
export type { ShellProps } from './shell/Shell.tsx'
export type { WorkspaceBodyProps, WorkspaceInject } from './WorkspaceBody.tsx'
export type {
  ContractRow, ProjectionFilesRemote, RuleRow, TaskRow, WorkspaceProjection,
} from './projection.ts'
export type { ModelStatus, ShellSessionNotice } from './model-status.ts'

/** 插件配置：默认占用 main 的 `lcoder-home`，渲染 LCoder 整壳。 */
export interface Config {
  /** 默认 true；显式 false 时回退为原来的右栏工作台页签。 */
  shell?: boolean
  /**
   * 「打开仓库」每一步等待的上限（毫秒），默认 15000。
   * 到点只让外壳脱身并报「超时」，底层调用仍在挂——上游队列没有取消语义。
   */
  openTimeoutMs?: number
}

/** 没有配置时的等待上限（毫秒）。 */
const DEFAULT_OPEN_TIMEOUT_MS = 15_000

/** 本包的文案命名空间。 */
const NS = 'lcoderWorkspace'

/** LCoder 角色的 id 前缀；装配层的角色 preset 都按它命名。 */
const LCODER_ROLE_PREFIX = 'lcoder'

/** 插件名，与包名一致，loader 据此在诊断里说话。 */
export const name = '@lcoder/workspace'

/** 浏览器侧必需的服务：槽位运行时、词典、页签注册表、远程文件面、命令面、角色名册、会话面、布局与工作区。 */
export const inject = [
  'slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles', 'remote.commands', 'remote.session',
  'remote.agentPresets', 'layout', 'workspaces', 'sessions',
]

/**
 * 把上游的 `workspaceFiles` 窄化成本包的文件面。
 * 适配层只做参数搬运：真正的读取策略（读哪些路径、单页多大）都在 projection 里。
 */
function projectionFiles(ctx: ClientContext): ProjectionFilesRemote {
  return {
    list: (id: SessionId, path: string, signal: AbortSignal) =>
      ctx.remote.workspaceFiles.list(id, path, signal),
    readPage: (id: SessionId, path: string, signal: AbortSignal) =>
      ctx.remote.workspaceFiles.read(id, path, { offset: 1, limit: PAGE_LINES }, signal),
  }
}

/** 页签模式注入的投影工厂。 */
function workspaceInject(ctx: ClientContext): (sessionId: SessionId) => WorkspaceInject {
  return () => {
    const files = projectionFiles(ctx)
    return { projection: (id: SessionId, signal: AbortSignal) => loadWorkspaceProjection(files, id, signal) }
  }
}

/**
 * 插件体：把类型、词典、正文挂上去。
 * @param ctx - 客户端根 context。
 * @param config - 插件配置；`shell: true` 时注册整壳主面板。
 */
export function apply(ctx: ClientContext, config: Config = {}): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lcoder-workspace: 词典')

  // 客户端半的 loader 行不一定会收到宿主行 config；整壳是产品默认，
  // 只有显式 shell: false 才回退旧页签。
  if (config.shell !== false) {
    const files = projectionFiles(ctx)
    const openTimeoutMs = config.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS
    const openRepository = async (path: string): Promise<{ workspaceId: string; sessionId: SessionId }> => {
      const workspace = await withOpenDeadline('workspace/create', ctx.workspaces.create({ path }), openTimeoutMs)
      const sessionId = await withOpenDeadline(
        'session/create', ctx.sessions.create({ workspaceId: workspace.workspaceId }), openTimeoutMs,
      )
      return { workspaceId: String(workspace.workspaceId), sessionId }
    }
    const sendPrompt = async (sessionId: SessionId, text: string): Promise<void> => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error('会话尚未就绪，请先打开仓库或新建会话')
      const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) throw new Error(result.error.message)
    }
    /**
     * 把人机命令交给宿主编排：签名与任务认领都由 kernel 写进 `.spec`，浏览器不碰规格库
     * 文件。回执里那句人话由宿主给出，外壳原样显示、不改写。
     */
    const runHumanCommand = async (sessionId: SessionId, line: string): Promise<ShellSignResult> => {
      const result = await ctx.remote.commands.execute(sessionId, line, [])
      if (!result.ok) return { ok: false, text: `${result.error.code}: ${result.error.message}` }
      if (result.value === undefined) return { ok: false, text: t('shell.commandUnavailable') }
      return { ok: result.value.result.kind === 'success', text: result.value.result.text ?? '' }
    }
    const signContract = (sessionId: SessionId, taskId: string): Promise<ShellSignResult> =>
      runHumanCommand(sessionId, `/contract_sign ${taskId}`)
    /**
     * 把任务认给这条会话。认领关系决定该会话按哪个任务的状态装工具面，所以它只能由人
     * 在会话里发起——与签署同一档，模型侧没有这条路。
     */
    const bindTask = (sessionId: SessionId, taskId: string): Promise<ShellSignResult> =>
      runHumanCommand(sessionId, `/task_bind ${taskId}`)
    /** 人确认契约已签，把任务从起草推到已签约；只推这一条边，更往后的仍人手写 YAML。 */
    const advanceContract = (sessionId: SessionId, taskId: string): Promise<ShellSignResult> =>
      runHumanCommand(sessionId, `/task_contract ${taskId}`)
    /**
     * 在同一个仓库里新开会话，并按需指名角色。角色必须在首个回合之前定（之后命令面
     * 抛 `agent-preset/locked`），所以只能在创建这一步给。
     * 工作区按路径复用，所以这一步只增加会话，不会重复登记同一个仓库。
     */
    const createSession = async (path: string, agentPreset?: string): Promise<SessionId> => {
      const workspace = await withOpenDeadline('workspace/create', ctx.workspaces.create({ path }), openTimeoutMs)
      return await withOpenDeadline(
        'session/create',
        ctx.sessions.create({ workspaceId: workspace.workspaceId, ...(agentPreset === undefined ? {} : { agentPreset }) }),
        openTimeoutMs,
      )
    }
    /**
     * 装配层声明的角色名册（Agent preset）。
     *
     * 只交 LCoder 角色的清单：`standard` 这类上游角色没有本包的十个工具，读不到
     * `.spec`，在外壳里选它只会开出一条干不了活的会话。角色 id 的前缀约定由装配层
     * （`lcoder/desktop-profile.patch.yml`）声明，读失败或筛完为空就返回空表，
     * 新会话照宿主 `selectedDefault` 开，外壳不编造角色。
     */
    const listRoles = async (): Promise<readonly ShellRole[]> => {
      const roster = await ctx.remote.agentPresets.list()
      if (!roster.ok) return []
      return roster.value.presets
        .filter(row => row.id.startsWith(LCODER_ROLE_PREFIX))
        .map(row => (row.name === undefined ? { id: row.id } : { id: row.id, name: row.name }))
    }
    /**
     * 宿主侧还有没有能跑的模型。目录查询本身失败时报 unknown 而不是 empty：
     * 查询故障不能当成「没有凭据」，否则我们会把一次网络问题说成配置缺失。
     */
    const checkModels = async (): Promise<ModelStatus> => {
      const catalog = await ctx.remote.session.modelCatalog()
      return catalog.ok
        ? statusFromCatalog(catalog.value)
        : statusOfFailure(catalog.error.code, catalog.error.message)
    }
    /** 模型目录或凭据一变就重查，让补上钥匙之后的装配自己解锁。 */
    const subscribeModels = (listener: () => void): (() => void) => {
      const disposers = [
        ctx.remote.$on('llm/models-updated', listener),
        ctx.remote.$on('llm/adapters-updated', listener),
        ctx.remote.$on('credentials/record-updated', listener),
      ]
      return () => { for (const dispose of disposers) dispose() }
    }
    /** 会话快照里的失败：准入被拒，或这一轮没跑起来。事件流里没有这些东西。 */
    const readSessionNotice = (sessionId: SessionId): ShellSessionNotice | null => {
      const binding = ctx.sessions.binding(sessionId)
      return binding === undefined ? null : noticeFromSnapshot(binding.session.getSnapshot())
    }
    /**
     * 卡片要的两个状态位。
     *
     * 只有本客户端物化过的会话才有快照，读不到就返回 null——卡片因此不会把「不知道」
     * 画成「空闲」或「失败」。失败位沿用浮层那条判据，两处说的是同一件事，只是一个给
     * 状态、一个给细节。
     */
    const readSessionFlags = (sessionId: SessionId): { awaitingFirstTurn: boolean; failed: boolean } | null => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) return null
      const snapshot = binding.session.getSnapshot()
      return { awaitingFirstTurn: snapshot.awaitingFirstTurn, failed: noticeFromSnapshot(snapshot) !== null }
    }
    const readMessages = (sessionId: SessionId): readonly ShellMessage[] => {
      const binding = ctx.sessions.binding(sessionId)
      return binding === undefined ? [] : messagesFromEntries(binding.eventSource.getSnapshot().entries)
    }
    const subscribeSession = (sessionId: SessionId, listener: () => void): (() => void) => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) return () => {}
      // 事件窗口给消息，会话快照给「等首个回合」与失败；卡片和浮层靠同一个通知一起刷新。
      const disposeEvents = binding.eventSource.subscribe(listener)
      const disposeState = binding.session.subscribe(listener)
      return () => { disposeEvents(); disposeState() }
    }
    ctx.effect(() => ctx.slots.inject('main', () => {
      const dispose = ctx.slots.register(
        {
          name: 'main',
          key: 'lcoder-home',
          locale: NS,
          inject: () => ({
            files, openRepository, sendPrompt, signContract, bindTask, advanceContract, createSession, listRoles,
            readMessages, subscribeSession, checkModels, subscribeModels, readSessionNotice, readSessionFlags,
          }),
        },
        Shell,
      )
      // The frame renders `conversation` until a key is selected; choose the
      // LCoder shell once it is registered. `retainMainPanels` keeps it while
      // the entry stays registered.
      ctx.layout.selectPanel('lcoder-home' as MainPanelId)
      // 外壳自带左栏；DSH 侧栏轨道没有 occupant，仍会按默认宽度占位。
      // 折叠这条空轨道，让主面板占满窗口。
      ctx.layout.toggleSidebar()
      return dispose
    }), 'lcoder-workspace: shell main panel')
    return
  }

  const workspaceFace = workspaceInject(ctx)
  ctx.effect(() => ctx.sidebarRightTabs.register(workspaceDefinition(t)), 'lcoder-workspace: 页签类型')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: WORKSPACE_ID, locale: NS, inject: workspaceFace },
    WorkspaceBody,
  )), 'lcoder-workspace: 正文')
}
