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
import { en, zh } from './locales.ts'
import { loadWorkspaceProjection, PAGE_LINES } from './projection.ts'
import { messagesFromEntries } from './shell/shell-data.ts'
import type { ShellMessage } from './shell/shell-data.ts'
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
  ProjectionFilesRemote, RuleRow, TaskRow, WorkspaceProjection,
} from './projection.ts'

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

/** 插件名，与包名一致，loader 据此在诊断里说话。 */
export const name = '@lcoder/workspace'

/** 浏览器侧必需的服务：槽位运行时、词典、页签注册表、远程文件面、布局与工作区。 */
export const inject = [
  'slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles', 'layout', 'workspaces', 'sessions',
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
    const readMessages = (sessionId: SessionId): readonly ShellMessage[] => {
      const binding = ctx.sessions.binding(sessionId)
      return binding === undefined ? [] : messagesFromEntries(binding.eventSource.getSnapshot().entries)
    }
    const subscribeSession = (sessionId: SessionId, listener: () => void): (() => void) => {
      const binding = ctx.sessions.binding(sessionId)
      return binding === undefined ? () => {} : binding.eventSource.subscribe(listener)
    }
    ctx.effect(() => ctx.slots.inject('main', () => {
      const dispose = ctx.slots.register(
        {
          name: 'main',
          key: 'lcoder-home',
          locale: NS,
          inject: () => ({ files, openRepository, sendPrompt, readMessages, subscribeSession }),
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
