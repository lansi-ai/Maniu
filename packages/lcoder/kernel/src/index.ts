/**
 * LCoder 内核的公开出口。
 *
 * 分三层：
 *   schema   —— `.spec` 的形状定义与校验
 *   kernel   —— 规格库、任务状态机、工具面
 *   checkers —— 收口判定的纯函数
 *   tools    —— 模型可调用的工具
 *
 * `plugin` 是对 DSH 的适配层：DSH 以 Cordis 插件加载它，我们只在这里
 * 依赖上游（`@deepseek-ai/dsh-tools`），业务代码不直接 import 上游内部路径。
 */
export * from './schema/spec.js'
export * from './schema/validate.js'

export * from './kernel/spec-store.js'
export * from './kernel/project-store.js'
export * from './kernel/spec-root.js'
export * from './kernel/task-store.js'
export * from './kernel/surface.js'

export * from './checkers/index.js'

export * from './tools/project-tools.js'
export * from './tools/spec-tools.js'
export * from './tools/edit-tools.js'
export * from './tools/task-tools.js'

export { apply, inject, name } from './plugin.js'
export type { LcoderConfig } from './plugin.js'
