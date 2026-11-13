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
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** 工作台发消息与看消息时持有会话引用；释放即结束本地订阅。 */
    lcoderShell: unknown
  }
}
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CloudResult } from '@lcoder/kernel/src/cloud/types.ts'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller/types'
import cloudRemote from './cloud/remote.generated.ts'
import { createCloudFace, unavailableCloudFace } from './cloud/face.ts'
import type { CloudFace, CloudModelPort, CloudRemoteNamespace, CloudRemotePort } from './cloud/face.ts'
import { CLOUD_USER_ROUTE } from './cloud/routes.ts'
import { ChatPromptError } from './shell/chat-composer.ts'
import type { ChatUploadResult } from './shell/chat-composer.ts'
import { WORKSPACE_ID, workspaceDefinition } from './definition.ts'
import { withOpenDeadline } from './open-failure.ts'
import { noticeFromSnapshot, statusFromCatalog, statusOfFailure } from './model-status.ts'
import type { ModelStatus, ShellSessionNotice } from './model-status.ts'
import { en, zh } from './locales.ts'
import { loadWorkspaceProjection, PAGE_LINES, SPEC_DIR } from './projection.ts'
import { expertsFromRoster, personaPromptOf } from './experts.ts'
import type { ExpertPrompt, ExpertRow } from './experts.ts'
import type { AgentRole } from './singleton.ts'
import { messagesFromEntries } from './shell/shell-data.ts'
import type { ShellContextPressure, ShellMessage, ShellRole, ShellSignResult } from './shell/shell-data.ts'
import { DEFAULT_CHAT_SIZE, Shell } from './shell/Shell.tsx'
import type { TaskAttachmentReader } from './shell/TaskAttachments.tsx'
import { createModelSettingsFace } from './shell/model-settings.ts'
import type { ModelSettingsFace, ModelSettingsRemote } from './shell/model-settings.ts'
import { WorkspaceBody } from './WorkspaceBody.tsx'
import type { ProjectionFilesRemote } from './projection.ts'
import type { WorkspaceInject } from './WorkspaceBody.tsx'

export { WORKSPACE_ID, WORKSPACE_KIND } from './definition.ts'
export { WorkspaceOpenTimeoutError, describeOpenFailure, isOpenTimeout } from './open-failure.ts'
export type { LcoderWorkspaceKey } from './locales.ts'
export type { ShellProps } from './shell/Shell.tsx'
export type { WorkspaceBodyProps, WorkspaceInject } from './WorkspaceBody.tsx'
export type {
  ContractRow, ProjectionFilesRemote, RequirementDocRow, RequirementOptionRow, RuleRow, TaskRow,
  WorkspaceProjection,
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
  /**
   * 普通档对话窗尺寸（像素，正整数）。最大化档始终占满应用，不读这里。
   * 只在 client 条目收到该配置时生效。
   */
  chatWindow?: { readonly width?: number; readonly height?: number }
}

/** 没有配置时的等待上限（毫秒）。 */
const DEFAULT_OPEN_TIMEOUT_MS = 15_000

/** 异步读一条会话历史的上限（毫秒）；重启后打开会话可能比本窗口内慢。 */
const SESSION_HISTORY_TIMEOUT_MS = 10_000

/**
 * 解析普通档对话窗尺寸；缺省用内置值，给了非法值就启动即失败。
 * @param config - 插件配置。
 * @returns 可直接交给外壳的像素尺寸。
 */
function chatSizeOf(config: Config): { readonly width: number; readonly height: number } {
  const width = config.chatWindow?.width ?? DEFAULT_CHAT_SIZE.width
  const height = config.chatWindow?.height ?? DEFAULT_CHAT_SIZE.height
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('@lcoder/workspace: chatWindow width/height must be positive numbers')
  }
  return { width, height }
}

/** 远程失败 `details.reason`；宿主没给或不是字符串时返回空串。 */
function reasonOf(details: unknown): string {
  if (typeof details !== 'object' || details === null) return ''
  const reason = (details as Record<string, unknown>)['reason']
  return typeof reason === 'string' ? reason : ''
}

/** 非负有限数字；投影里的计数缺省或形状不对时返回 undefined。 */
function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** 本包的文案命名空间。 */
const NS = 'lcoderWorkspace'

/** LCoder 角色的 id 前缀；装配层的角色 preset 都按它命名。 */
const LCODER_ROLE_PREFIX = 'lcoder'

/** 插件名，与包名一致，loader 据此在诊断里说话。 */
export const name = '@lcoder/workspace'

/** 浏览器侧必需的服务：槽位运行时、词典、页签注册表、远程文件面、命令面、角色名册、会话面、布局与工作区。 */
export const inject = [
  'slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles', 'remote.commands', 'remote.session',
  'remote.llm', 'remote.settings', 'remote.credentials', 'remote.agentPresets', 'remote.fileUploads', 'layout', 'workspaces', 'sessions',
]

/**
 * 把上游的 `workspaceFiles` 窄化成本包的文件面。
 * 适配层只做参数搬运：真正的读取策略（读哪些路径、单页多大）都在 projection 里。
 */
function projectionFiles(ctx: ClientContext): ProjectionFilesRemote {
  return {
    list: (id: SessionId, path: string, signal: AbortSignal) =>
      ctx.remote.workspaceFiles.list(id, path, signal),
    readPage: (id: SessionId, path: string, signal: AbortSignal, offset = 1) =>
      ctx.remote.workspaceFiles.read(id, path, { offset, limit: PAGE_LINES }, signal),
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
 * 读一个命名空间声明的协议枚举；设置 schema 服务缺席时为空。
 * @param ctx - 客户端根 context。
 * @param view - 该命名空间的设置视图。
 * @returns 协议标识，按 schema 顺序。
 */
function protocolChoices(ctx: ClientContext, view: SettingsNamespaceView): readonly string[] {
  const service = ctx.get('settingsSchema')
  if (service === undefined) return []
  const node = service.nodeAtPath(service.rehydrate(view.schema), ['providers', '\u0000probe', 'api'])
  const list = node as { type?: string; list?: readonly { value?: unknown }[] } | undefined
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/**
 * 把 ctx.remote 收成设置页的窄面；页面因此不拿 ctx。
 * @param ctx - 客户端根 context。
 * @returns 设置页的读取与写入面。
 */
function modelSettingsFace(ctx: ClientContext): ModelSettingsFace {
  const remote: ModelSettingsRemote = {
    listProviders: () => ctx.remote.llm.listProviders(),
    listConfigurableProviders: () => ctx.remote.llm.listConfigurableProviders(),
    describeSettings: () => ctx.remote.settings.describe(),
    describeCredentials: refs => ctx.remote.credentials.describe([...refs]),
    setCredential: (ref, value) => ctx.remote.credentials.set(ref, value),
    unsetCredential: ref => ctx.remote.credentials.unset(ref),
    mutateSettings: (ns, ops, revision) => ctx.remote.settings.mutate(ns, ops, revision),
    discoverModels: (ns, request) => ctx.remote.llm.discoverModels(ns, request),
    modelCatalog: () => ctx.remote.session.modelCatalog(),
    selectModel: request => ctx.remote.session.selectModel(request),
  }
  return createModelSettingsFace(remote, { protocols: view => protocolChoices(ctx, view) })
}

/** 把 Remote 的 `RemoteResult` 与业务 `CloudResult` 折成界面要的一份结果。 */
function unwrapCloud<T>(answer: RemoteResult<CloudResult<T>>): CloudResult<T> {
  return answer.ok
    ? answer.value
    : { ok: false, error: { code: answer.error.code, message: answer.error.message } }
}

/**
 * 把 `ctx.remote` 收成云端数据面。
 * @param ctx - 客户端根 context。
 * @returns 界面可调用的方法集合。
 */
function cloudPort(ctx: ClientContext): CloudRemotePort & CloudModelPort {
  // 命名空间是 `$mount` 刚装上的，晚于本插件的 inject 求值；按可选服务读取，
  // 不把它写进 inject，否则启动会等一个由 apply 自己创建的服务。
  const cloud = ctx.get('remote.lcoderCloud') as CloudRemoteNamespace | undefined
  if (cloud === undefined) throw new Error('cloud namespace is not mounted')
  return {
    state: async () => unwrapCloud(await cloud.state()),
    sendSms: async input => unwrapCloud(await cloud.sendSms(input)),
    register: async input => unwrapCloud(await cloud.register(input)),
    loginSms: async input => unwrapCloud(await cloud.loginSms(input)),
    loginPassword: async input => unwrapCloud(await cloud.loginPassword(input)),
    refresh: async () => unwrapCloud(await cloud.refresh()),
    me: async () => unwrapCloud(await cloud.me()),
    logout: async () => unwrapCloud(await cloud.logout()),
    usage: async query => unwrapCloud(await cloud.usage(query)),
    selectModel: request => ctx.remote.session.selectModel(request),
  }
}

/**
 * 挂载云端 Remote 贡献；宿主没装配或测试替身缺 `$mount` 时交给占位面。
 * @param ctx - 客户端根 context。
 * @returns 云端数据面。
 */
async function mountCloud(ctx: ClientContext): Promise<CloudFace> {
  if (typeof ctx.remote.$mount !== 'function') {
    return unavailableCloudFace(new Error('cloud remote mount is unavailable'))
  }
  try {
    await ctx.remote.$mount(cloudRemote)
    return createCloudFace(cloudPort(ctx))
  } catch (error: unknown) {
    return unavailableCloudFace(error)
  }
}

/**
 * 插件体：把类型、词典、正文挂上去。
 * @param ctx - 客户端根 context。
 * @param config - 插件配置；`shell: true` 时注册整壳主面板。
 */
export async function apply(ctx: ClientContext, config: Config = {}): Promise<void> {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lcoder-workspace: 词典')
  const cloud = await mountCloud(ctx)

  // 客户端半的 loader 行不一定会收到宿主行 config；整壳是产品默认，
  // 只有显式 shell: false 才回退旧页签。
  if (config.shell !== false) {
    const files = projectionFiles(ctx)
    /**
     * 按 `.spec` 相对路径读图片附件：复用上游 `workspaceFiles.readBytes`，
     * 与图片预览同一探测面，不建新协议也不从渲染端旁路读盘。
     */
    const readAttachment: TaskAttachmentReader = async (sessionId, path, signal) => {
      const result = await ctx.remote.workspaceFiles.readBytes(
        sessionId, `${SPEC_DIR}/${path.replaceAll('\\', '/')}`, {}, signal,
      )
      return result.ok ? { ok: true, value: result.value.data } : result
    }
    const chatSize = chatSizeOf(config)
    const openTimeoutMs = config.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS
    const openRepository = async (path: string): Promise<{ workspaceId: string; sessionId: SessionId }> => {
      const workspace = await withOpenDeadline('workspace/create', ctx.workspaces.create({ path }), openTimeoutMs)
      const sessionId = await withOpenDeadline(
        'session/create', ctx.sessions.create({ workspaceId: workspace.workspaceId }), openTimeoutMs,
      )
      return { workspaceId: String(workspace.workspaceId), sessionId }
    }
    const sendPrompt = async (
      sessionId: SessionId,
      content: string | readonly PromptContentPart[],
    ): Promise<void> => {
      const parts: readonly PromptContentPart[] = typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : content
      // `create()` 只交回身份：刚建的会话还不在本地目录里，直接 binding 会拿到 undefined。
      // 先 retain 并等首次 open 落定，再发；释放随 using 的结算。
      const result = await ctx.sessions.using(sessionId, { source: 'lcoderShell' }, async (reference) => {
        await reference.ready
        return reference.binding.session.prompt([...parts], 'queue')
      })
      if (!result.ok) throw new ChatPromptError(result.error.code, result.error.message, reasonOf(result.error.details))
    }
    /**
     * 上传一支文件并拿回执；base64 由浏览器侧读文件时生成。
     * 失败保留宿主原话，界面据此显示而不谎报成功。
     */
    const uploadAttachment = async (
      sessionId: SessionId,
      data: string,
      name: string,
    ): Promise<ChatUploadResult> => {
      const result = await ctx.remote.fileUploads.upload(sessionId, { data, name })
      return result.ok
        ? { ok: true, receiptId: result.value.receiptId }
        : { ok: false, code: result.error.code, message: result.error.message }
    }
    /**
     * 浮层打开期间持有会话引用：订阅与读消息都借 binding，没人 retain 的会话读不到。
     * @param sessionId - 要持有的会话。
     * @returns 释放函数；重复调用安全。
     */
    const holdSession = (sessionId: SessionId): (() => void) => {
      const reference = ctx.sessions.retain(sessionId, { source: 'lcoderShell' })
      let released = false
      return () => {
        if (released) return
        released = true
        reference.release()
      }
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
    /**
     * 把任务分配给岗位。分配是调度硬约束，所以同样只由人在命令面发起；
     * 岗位 id 来自 `.spec/roles.yaml` 的投影，模型侧没有分配入口。
     */
    const assignTask = (sessionId: SessionId, taskId: string, roleId: string): Promise<ShellSignResult> =>
      runHumanCommand(sessionId, `/task_assign ${taskId} ${roleId}`)
    /**
     * 调度判定由浏览器算出，落盘仍归 kernel：这条命令把判定追加到任务证据目录，
     * 命令本身也进会话日志，事后能对上「哪条会话、什么时候、为什么这么排」。
     */
    const logSchedule = (sessionId: SessionId, taskId: string, json: string): Promise<ShellSignResult> =>
      runHumanCommand(sessionId, `/task_schedule ${taskId} ${json}`)
    /**
     * 流程判定由 kernel 求值，界面只画结果。传空数组表示全部任务；
     * 模板里不拼未经验证的用户输入——任务编号来自 `.spec` 的投影。
     */
    const readFlowStatus = (sessionId: SessionId, taskIds: readonly string[]): Promise<ShellSignResult> => {
      const args = taskIds.join(',')
      return runHumanCommand(sessionId, args === '' ? '/flow_status' : `/flow_status ${args}`)
    }
    /** 开工的每一次结果都追加到任务证据目录；失败也记，重试时能对上同一条台账。 */
    const logFlow = (sessionId: SessionId, taskId: string, json: string): Promise<ShellSignResult> =>
      runHumanCommand(sessionId, `/flow_log ${taskId} ${json}`)
    /** 常驻会话号写回 `.spec/agents.yaml`；写盘只走 kernel。 */
    const bindAgentSession = (
      sessionId: SessionId,
      role: AgentRole,
      agentSession: SessionId,
    ): Promise<ShellSignResult> =>
      runHumanCommand(sessionId, `/agent_bind ${role} ${String(agentSession)}`)
    /**
     * 把标题写成角色名。`rename` 是用户标题，会压住自动标题；每次打开都调一次，
     * 上游若仍用自动标题覆盖，下一次打开又会校正回来。
     */
    const renameSession = async (sessionId: SessionId, title: string): Promise<ShellSignResult> => {
      const result = await ctx.sessions.using(sessionId, { source: 'lcoderShell' }, async (reference) => {
        await reference.ready
        return reference.binding.session.rename(title)
      })
      return result.ok
        ? { ok: true, text: result.value.title }
        : { ok: false, text: `${result.error.code}: ${result.error.message}` }
    }
    /**
     * 当前会话的上下文占用与容量；来自宿主 `contextPressure` 投影。
     * 字段可能缺一半（还没发过请求、适配器没报容量），缺的部分不出现在返回值里。
     */
    const readContextPressure = (sessionId: SessionId): ShellContextPressure | null => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) return null
      const value: unknown = binding.session.projections.faceOf('contextPressure').getSnapshot()
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
      const record = value as Record<string, unknown>
      const pressureTokens = countOf(record.pressureTokens)
      const projectedTokens = countOf(record.projectedTokens)
      const contextWindow = countOf(record.contextWindow)
      if (pressureTokens === undefined && projectedTokens === undefined && contextWindow === undefined) return null
      return {
        ...(pressureTokens === undefined ? {} : { pressureTokens }),
        ...(projectedTokens === undefined ? {} : { projectedTokens }),
        ...(contextWindow === undefined ? {} : { contextWindow }),
      }
    }
    /** 人确认契约已签，把任务从起草推到已签约；只推这一条边，更往后的仍人手写 YAML。 */
    const advanceContract = (sessionId: SessionId, taskId: string): Promise<ShellSignResult> =>
      runHumanCommand(sessionId, `/task_contract ${taskId}`)
    /** 人拍板采纳某个方案；出方案是模型的工具，批准只在这条命令面上。 */
    const approveProposal = (sessionId: SessionId, proposalId: string): Promise<ShellSignResult> =>
      runHumanCommand(sessionId, `/proposal_approve ${proposalId}`)
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
     * 专家名册：宿主真实注册的全部 preset，按装配声明的 order 排。
     * 这里不筛 `lcoder` 前缀——用户问的是内置了多少个专家，筛掉上游那几个会让数字说谎。
     */
    const listExperts = async (): Promise<readonly ExpertRow[]> => {
      const roster = await ctx.remote.agentPresets.list()
      return roster.ok ? expertsFromRoster(roster.value.presets) : []
    }
    /** 一位专家的提示词与声明原文；读不到返回 null，由面板就地说明是查询失败还是没声明 persona。 */
    const readExpert = async (id: string): Promise<ExpertPrompt | null> => {
      const result = await ctx.remote.agentPresets.read(id)
      if (!result.ok) return null
      return { id, document: result.value.content, prompt: personaPromptOf(result.value.content) }
    }
    /**
     * 宿主侧还有没有能跑的模型。目录查询本身失败时报 unknown 而不是 empty：
     * 查询故障不能当成「没有凭据」，否则我们会把一次网络问题说成配置缺失。
     */
    const checkModels = async (): Promise<ModelStatus> => {
      const catalog = await ctx.remote.session.modelCatalog()
      if (!catalog.ok) return statusOfFailure(catalog.error.code, catalog.error.message)
      const status = statusFromCatalog(catalog.value)
      if (status.state !== 'empty') return status
      // 云端路由在拿到用户令牌之前不列模型，但它已经注册；
      // 这时不能说「没有可用模型」，否则登录后的入口会被自己挡住。
      const providers = await ctx.remote.llm.listProviders()
      const cloudReady = providers.ok
        && providers.value.some(provider => provider.id === CLOUD_USER_ROUTE)
      return cloudReady ? { state: 'ready' } : status
    }
    /** 目录默认模型；查询失败返回 null，chip 宁可不显示也不编造。 */
    const readDefaultModel = async (): Promise<{ provider: string; model: string } | null> => {
      const catalog = await ctx.remote.session.modelCatalog()
      return catalog.ok ? { provider: catalog.value.default.provider, model: catalog.value.default.model } : null
    }
    /** 模型目录或凭据一变就重查，让补上钥匙之后的装配自己解锁。 */
    const subscribeModels = (listener: () => void): (() => void) => {
      const disposers = [
        ctx.remote.$on('llm/models-updated', listener),
        ctx.remote.$on('llm/adapters-updated', listener),
        // 存密钥发的是 reference-updated；record-updated 只照顾账户记录。
        ctx.remote.$on('credentials/reference-updated', listener),
        ctx.remote.$on('credentials/record-updated', listener),
        // base URL 与手加路线都走 settings 文档；改完同样要重查。
        ctx.remote.$on('settings/document-updated', listener),
      ]
      return () => { for (const dispose of disposers) dispose() }
    }
    const modelSettings = modelSettingsFace(ctx)
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
    /**
     * 异步读取一条会话的消息窗口。
     *
     * 重启后候选会话还不在本地目录里，同步 `readMessages` 拿不到 binding；这里先 retain
     * 并等 `reference.ready`，再读事件窗口，最后释放。超时与打开失败都返回 null，
     * 由外壳按「读取失败」如实提示；超时也会释放引用，不让一条卡住的打开长期占住会话。
     * @param sessionId - 要读取的会话。
     * @returns 消息列表；读不出来时为 null。
     */
    const readSessionMessages = async (sessionId: SessionId): Promise<readonly ShellMessage[] | null> => {
      const reference = ctx.sessions.retain(sessionId, { source: 'lcoderShell' })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(() => { resolve(null) }, SESSION_HISTORY_TIMEOUT_MS)
        })
        const read = reference.ready.then(binding =>
          messagesFromEntries(binding.eventSource.getSnapshot().entries))
        return await Promise.race([read, timeout])
      } catch (error: unknown) {
        // 会话已删除或宿主拒绝打开：这一条按读不出来处理，界面不让它假装是空讨论。
        void error
        return null
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        reference.release()
      }
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
            files, readAttachment, openRepository, sendPrompt, uploadAttachment, signContract, bindTask, assignTask,
            logSchedule, advanceContract, approveProposal,
            createSession, listRoles, listExperts, readExpert,
            readMessages, readSessionMessages, subscribeSession, holdSession, checkModels, subscribeModels,
            readSessionNotice, readSessionFlags, modelSettings, readDefaultModel,
            readFlowStatus, logFlow, bindAgentSession, renameSession, readContextPressure,
            chatSize, cloud,
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
