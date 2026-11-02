/**
 * 工作台的浏览器侧入口。
 *
 * 三件事，按页签类型的两段式注册来：
 *   1. 类型进 `ctx.sidebarRightTabs`（`definition.ts`）
 *   2. 词典进 `ctx.locale`
 *   3. 正文进键控槽 `sidebar.right.pane.tab`，键是类型自己的 `id`
 *
 * 没有 store、没有 command、没有 Factory：这一版正文不持有任何跨栏状态，
 * 也没有自己的快捷键。等宿主侧的 Remote 命名空间建起来，数据面再加，
 * 那时候才需要一个按会话的 store。
 *
 * 依赖只要三样：槽位运行时、词典、页签注册表。少一样就不激活，
 * 而不是带着半个注册表跑起来。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { WORKSPACE_ID, workspaceDefinition } from './definition.ts'
import { en, zh } from './locales.ts'
import { WorkspaceBody } from './WorkspaceBody.tsx'

export { WORKSPACE_ID, WORKSPACE_KIND } from './definition.ts'
export type { LcoderWorkspaceKey } from './locales.ts'
export type { WorkspaceBodyProps } from './WorkspaceBody.tsx'

/** 本包的文案命名空间。 */
const NS = 'lcoderWorkspace'

/** 插件名，与包名一致，loader 据此在诊断里说话。 */
export const name = '@lcoder/workspace'

/** 浏览器侧必需的服务：槽位运行时、词典、页签注册表。 */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * 插件体：把类型、词典、正文挂上去。
 * @param ctx - 客户端根 context。
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(workspaceDefinition(t)), 'lcoder-workspace: 页签类型')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lcoder-workspace: 词典')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: WORKSPACE_ID, locale: NS },
    WorkspaceBody,
  )), 'lcoder-workspace: 正文')
}
