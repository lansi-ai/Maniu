/**
 * 页签类型的静态面：它是什么，以及引导页给它留的那个入口。
 *
 * 这是一个**页面**类型，不认领任何地址——它靠 `kind` 被打开，不去抢
 * `dsh-resource://` 的资源。`priority` 取 `extension`：我们不是产品自带的类型，
 * 上游的 viewer 不该因为我们的存在而让位，但真出现同类时由使用方决定谁接管。
 *
 * 注册分两步：类型进 `sidebarRightTabs`（本文件），正文进键控槽
 * `sidebar.right.pane.tab`，键就是这里的 `id`（见 `index.ts`）。
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'

/** 本包独占的页签种类，`openTab` 时用它。 */
export const WORKSPACE_KIND = 'lcoder-workspace'

/** 本实现在页签系统里的身份，也是正文注册时用的键。 */
export const WORKSPACE_ID = '@maniu/workspace'

/**
 * 工作台类型的注册定义。
 * @param t - 绑定了命名空间的翻译函数，每次读标签时重新求值。
 * @returns 交给 `sidebarRightTabs.register` 的定义。
 */
export function workspaceDefinition(t: TranslateNS<'lcoderWorkspace'>): SidebarRightTabDefinition {
  return {
    id: WORKSPACE_ID,
    kind: WORKSPACE_KIND,
    priority: 'extension',
    title: () => t('type.label'),
    guide: [{
      id: 'workspace',
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }
}
