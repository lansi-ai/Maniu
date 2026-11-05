/**
 * LCoder 的 Cordis 插件入口。
 *
 * 形态对齐上游最小插件（如 `@deepseek-ai/dsh-persona`）：
 * 具名导出 `name` / `inject` / `apply`，Cordis 的 loader 按包名加载后取这三样。
 *
 * 本插件做两件事：**把十二个工具注册进注册表**，**把签署契约与任务认领注册成人机命令**。
 * 工具面的收放（restrict 掩码）需要 Agent 作用域，由 surface 在会话侧接管，
 * 不在这里做——否则会变成全局限制，把每个 Agent 都罩住（DSH 会直接抛错）。
 */
import { join, resolve } from 'node:path'

import { createContractSignCommand } from './commands/contract-sign.js'
import { createTaskBindCommand } from './commands/task-bind.js'
import { createEditTools, spawnRunner } from './tools/edit-tools.js'
import { createProjectTools } from './tools/project-tools.js'
import { createSpecTools } from './tools/spec-tools.js'
import { createTaskTools } from './tools/task-tools.js'
import { allowedTools, checkSurface, parseRole } from './kernel/surface.js'
import { hasSpecRoot, resolveRoot, sessionSpecRoot } from './kernel/spec-root.js'
import type { RootInput, SpecRootContext } from './kernel/spec-root.js'
import { listTasks, pickTaskForSession } from './kernel/task-store.js'
import type { TaskState } from './schema/spec.js'

export const name = 'lcoder'

/** 依赖工具注册表与人机命令面；两者缺一样本插件都不该激活。 */
export const inject = ['tools', 'commands']

export interface LcoderConfig {
  /**
   * 没有会话 cwd 时使用的 `.spec` 目录（其下是 `tasks/`、`spec/`）。
   * 有会话时规格根固定为 `session.header.cwd/.spec`，本字段不参与。
   * 部署可用 cordis patch 的 `!!js` 读环境变量，例如
   * `root: !!js process.env.LCODER_SPEC_ROOT || undefined`。
   */
  root?: string
  /** 是否在加载时打印工具面自检。默认 true。 */
  selfCheck?: boolean
  /**
   * 装载时按哪个任务的状态决定工具面。
   * 不给则取 `.spec/tasks/` 下第一个任务；一个任务都没有就退回立项面
   * （`file_read`、`project_draft`、`spec_query`、`spec_draft`、`task_read`、`task_draft`）。
   * 会话经 `/task_bind` 认领了某条任务时，该会话以认领的那条为准，本字段不参与。
   */
  taskId?: string
  /**
   * 本插件实例所属角色，取值 `intake` / `architect` / `dev` / `review`。
   * 角色是工具面的天花板：与任务状态允许的清单求交，只减不加。
   * 不给则不设天花板，保持只有状态一维的行为。每个角色 preset 各挂一行本插件，
   * 所以这一项由装配层的 preset 写死，不由会话运行时决定。
   */
  role?: string
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
  register(definition: unknown, options?: { when?: (context: SpecRootContext) => boolean }): () => void
}

interface PluginContext {
  tools: ToolRegistry
  /**
   * 人机命令面（`@deepseek-ai/dsh-commands`）。命令不经过模型回合：
   * 人点一次，宿主做一件事，`command/run` 与 `command/done` 进会话日志。
   * 签署契约必须走这里——注册成工具就等于模型能给自己签字。
   */
  commands: CommandRegistry
  effect?(callback: () => () => void, label?: string): void
}

/** 注册人机命令所需的最小面；形状与 dsh-commands 的 `register` 一致。 */
interface CommandRegistry {
  /** 注册一条命令；返回解除注册的句柄。同名重复注册由命令面抛错。 */
  register(definition: unknown): () => void
}

export function apply(ctx: PluginContext, config: LcoderConfig = {}): void {
  // 角色在装载时就校验：配错名字要立刻响，不能静默按「无角色」装配出一个能力更大的会话。
  const role = parseRole(config.role)
  // 备案根：没有会话 cwd 时（headless、启动自检）落在进程工作目录的 `.spec` 下，
  // 而不是工作目录本身——规格库是一个隐藏目录，`tasks/` 与 `spec/` 都在它里面。
  const fallbackRoot = config.root ?? join(process.cwd(), '.spec')
  /** 每次调用按当前会话解析；没有会话时退回备案根。 */
  const rootInput: RootInput = context => sessionSpecRoot(context, fallbackRoot)
  // 规格根保存 env/evidence；文件工具必须读仓库根（规格根的上一级）。
  const repoRootInput: RootInput = context => resolve(rootInput(context), '..')
  const tools = [
    ...createProjectTools(rootInput),
    ...createSpecTools(rootInput),
    ...createTaskTools(rootInput),
    ...createEditTools(rootInput, { run: spawnRunner, repoRoot: repoRootInput }),
  ]

  const taskId = config.taskId
  const reportedRoots = new Set<string>()
  /** 每次求值时都重读磁盘：契约签了、任务转移了，工具面立刻跟着变。 */
  const currentState = (context?: SpecRootContext): TaskState | null => {
    try {
      const root = resolveRoot(rootInput, context)
      if (!reportedRoots.has(root)) {
        reportedRoots.add(root)
        console.error(`[lcoder] 规格根：${root}`)
      }
      // 没有规格根 = 这个仓库还没立项，走空看板最小面。
      if (!hasSpecRoot(root)) return null
      const tasks = listTasks(root)
      const task = pickTaskForSession(tasks, context?.agent?.session.header.id, taskId)
      return task?.state ?? null
    } catch (error) {
      // 坏 YAML 或读盘失败都退回空看板最小面：立项工具仍然可用，
      // 具体坏在哪由工具调用给出人话错误，不在这里静默禁用一切。
      console.error(`[lcoder] 读任务状态失败，按空看板工具面处理：${String(error)}`)
      return null
    }
  }

  for (const tool of tools) {
    const mount = () =>
      ctx.tools.register(tool, {
        when: (context) => {
          // 取不到任务状态（没有 `.spec`，或 `tasks/` 是空的）时按空看板最小面收：
          // 立项需要的读与建任务能力留着，改代码与跑命令的能力不放。
          // 角色再收一层：这个 preset 拿不到的工具，任何状态都不会放出来。
          return allowedTools(currentState(context), role).includes(tool.name)
        },
      })
    if (ctx.effect) ctx.effect(mount, `lcoder.tool(${tool.name})`)
    else mount()
  }

  // 两条人机命令按同一个规格根解析：工具与命令读写同一份 `.spec`，否则签完收口读不到。
  const signCommand = createContractSignCommand(rootInput)
  const mountCommand = () => ctx.commands.register(signCommand)
  if (ctx.effect) ctx.effect(mountCommand, `lcoder.command(${signCommand.name})`)
  else mountCommand()

  // 认领关系同样只由人写：模型能调就等于自己挑工具面。
  const bindCommand = createTaskBindCommand(rootInput)
  const mountBind = () => ctx.commands.register(bindCommand)
  if (ctx.effect) ctx.effect(mountBind, `lcoder.command(${bindCommand.name})`)
  else mountBind()

  if (config.selfCheck ?? true) {
    const check = checkSurface(tools.map(t => t.name))
    if (check.missing.length > 0) {
      console.error(`[lcoder] 掩码声明了但未注册的工具：${check.missing.join(', ')}`)
    }
    if (check.orphan.length > 0) {
      console.error(`[lcoder] 已注册但任何状态都看不到的工具：${check.orphan.join(', ')}`)
    }
    console.error(`[lcoder] 已注册 ${tools.length} 个工具与 /${signCommand.name}、/${bindCommand.name} 命令；角色 ${role ?? '未设（只按状态收放）'}，无会话 cwd 时规格根 ${fallbackRoot}，有会话时取 session.header.cwd/.spec`)
  }

}
