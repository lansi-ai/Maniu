/**
 * LCoder 的 Cordis 插件入口。
 *
 * 形态对齐上游最小插件（如 `@deepseek-ai/dsh-persona`）：
 * 具名导出 `name` / `inject` / `apply`，Cordis 的 loader 按包名加载后取这三样。
 *
 * 本插件只做一件事：**把六个工具注册进注册表**。
 * 工具面的收放（restrict 掩码）需要 Agent 作用域，由 surface 在会话侧接管，
 * 不在这里做——否则会变成全局限制，把每个 Agent 都罩住（DSH 会直接抛错）。
 */
import { join } from 'node:path'

import { createEditTools, spawnRunner } from './tools/edit-tools.js'
import { createSpecTools } from './tools/spec-tools.js'
import { createTaskTools } from './tools/task-tools.js'
import { SURFACE, checkSurface } from './kernel/surface.js'
import { listTasks } from './kernel/task-store.js'
import type { TaskState } from './schema/spec.js'

export const name = 'lcoder'

/** 依赖工具注册表；没有 tools 服务时本插件不会被激活。 */
export const inject = ['tools']

export interface LcoderConfig {
  /** `.spec` 目录本身（其下是 `tasks/`、`spec/`）。默认取进程工作目录下的 `.spec`。 */
  root?: string
  /** 是否在加载时打印工具面自检。默认 true。 */
  selfCheck?: boolean
  /**
   * 装载时按哪个任务的状态决定工具面。
   * 不给则取 `.spec/tasks/` 下第一个任务；一个任务都没有就全量放开。
   */
  taskId?: string
}

interface ToolRegistry {
  /**
   * 注册工具。`when` 在**每个 model step 求值一次**——返回 false 时该工具
   * 从 executor 描述、PTC 绑定和执行中一并消失。
   *
   * 为什么不用 `restrict`：实测它只对**全局注册**的工具生效，报错原文是
   * `names unknown global tools`，而 README 也写明 `masks intersect,
   * scoped registrations stay visible`。我们在 preset 作用域注册，属于 scoped，
   * restrict 盖不住。`when` 没有这个限制。
   */
  register(definition: unknown, options?: { when?: () => boolean }): () => void
}

interface PluginContext {
  tools: ToolRegistry
  effect?(callback: () => () => void, label?: string): void
}

export function apply(ctx: PluginContext, config: LcoderConfig = {}): void {
  // 默认落在进程工作目录的 `.spec` 下，而不是工作目录本身：规格库是一个
  // 隐藏目录，`tasks/` 与 `spec/` 都在它里面（与 spec-store / task-store 一致）。
  const root = config.root ?? join(process.cwd(), '.spec')
  const tools = [
    ...createSpecTools(root),
    ...createTaskTools(root),
    ...createEditTools(root, { run: spawnRunner }),
  ]

  const taskId = config.taskId
  /** 每次求值时都重读磁盘：契约签了、任务转移了，工具面立刻跟着变。 */
  const currentState = (): TaskState | null => {
    try {
      const tasks = listTasks(root)
      const task = taskId ? tasks.find(t => t.id === taskId) : tasks[0]
      return task?.state ?? null
    } catch {
      return null
    }
  }

  for (const tool of tools) {
    const mount = () =>
      ctx.tools.register(tool, {
        when: () => {
          const state = currentState()
          // 没有任务就没有契约可用；此时保守放开，让检查器去拦，
          // 而不是静默禁用一切——禁用会让"为什么什么都干不了"无从排查。
          if (state === null) return true
          return SURFACE[state].includes(tool.name)
        },
      })
    if (ctx.effect) ctx.effect(mount, `lcoder.tool(${tool.name})`)
    else mount()
  }

  if (config.selfCheck ?? true) {
    const check = checkSurface(tools.map(t => t.name))
    if (check.missing.length > 0) {
      console.error(`[lcoder] 掩码声明了但未注册的工具：${check.missing.join(', ')}`)
    }
    if (check.orphan.length > 0) {
      console.error(`[lcoder] 已注册但任何状态都看不到的工具：${check.orphan.join(', ')}`)
    }
    console.error(`[lcoder] 已在 ${join(root)} 注册 ${tools.length} 个工具`)
  }

}
