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
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WORKSPACE_ID, workspaceDefinition } from './definition.ts'
import { en, zh } from './locales.ts'
import { loadWorkspaceProjection, PAGE_LINES } from './projection.ts'
import { WorkspaceBody } from './WorkspaceBody.tsx'
import type { ProjectionFilesRemote } from './projection.ts'
import type { WorkspaceInject } from './WorkspaceBody.tsx'

export { WORKSPACE_ID, WORKSPACE_KIND } from './definition.ts'
export type { LcoderWorkspaceKey } from './locales.ts'
export type { WorkspaceBodyProps, WorkspaceInject } from './WorkspaceBody.tsx'
export type {
  ProjectionFilesRemote, RuleRow, TaskRow, WorkspaceProjection,
} from './projection.ts'

/** 本包的文案命名空间。 */
const NS = 'lcoderWorkspace'

/** 插件名，与包名一致，loader 据此在诊断里说话。 */
export const name = '@lcoder/workspace'

/** 浏览器侧必需的服务：槽位运行时、词典、页签注册表、远程面。 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote']

/**
 * 把上游的 `workspaceFiles` 窄化成本包的文件面。
 * 适配层只做参数搬运：真正的读取策略（读哪些路径、单页多大）都在 projection 里。
 */
function workspaceInject(ctx: ClientContext): (sessionId: SessionId) => WorkspaceInject {
  return () => {
    const files: ProjectionFilesRemote = {
      list: (id: SessionId, path: string, signal: AbortSignal) =>
        ctx.remote.workspaceFiles.list(id, path, signal),
      readPage: (id: SessionId, path: string, signal: AbortSignal) =>
        ctx.remote.workspaceFiles.read(id, path, { offset: 1, limit: PAGE_LINES }, signal),
    }
    return { projection: (id: SessionId, signal: AbortSignal) => loadWorkspaceProjection(files, id, signal) }
  }
}

/**
 * 插件体：把类型、词典、正文挂上去。
 * @param ctx - 客户端根 context。
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const workspaceFace = workspaceInject(ctx)
  ctx.effect(() => ctx.sidebarRightTabs.register(workspaceDefinition(t)), 'lcoder-workspace: 页签类型')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lcoder-workspace: 词典')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: WORKSPACE_ID, locale: NS, inject: workspaceFace },
    WorkspaceBody,
  )), 'lcoder-workspace: 正文')
}
