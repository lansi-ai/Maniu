/**
 * LCoder 三栏工作台的 client 入口。
 *
 * 现状：**只是骨架**。这一步只验证「我们的 client 插件能被加载」，
 * 还没有注册任何页签——页签要接 `slots` / `store` / `locale` 三套东西，
 * 一次性写进去容易写歪，所以分两步：
 *
 *   第一步（本文件）：证明插件能被 client 组合加载。
 *   第二步：注册侧栏页签 + 三栏布局（左任务 / 中规格对照 / 右对话）。
 *
 * 挂载方式见 README：client 组合是 patch 文件，我们用自己的 patch 层叠加，
 * **不需要改任何上游文件**。
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = '@lcoder/workspace'

/** 等第二步接页签时再声明 `slots` 等依赖；现在不声明，避免加载期报缺依赖。 */
export const inject: string[] = []

export function apply(_ctx: Context): void {
  // 第二步在这里注册侧栏页签。
}
