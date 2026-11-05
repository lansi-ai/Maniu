/**
 * 工具面装配：把「任务状态」翻译成「模型能看见哪些工具」。
 *
 * 机制已核实（见 docs/subsystems/tools.md）：
 *   `agent.ctx.tools.restrict({ allow })` 返回的就是**解除限制的 disposer**。
 *   本模块不直接依赖 Cordis，只依赖那个函数的形状，边界处适配一次。
 *
 * 三个刻意的选择：
 *   1. **用 allow 而不是 deny。** 新增工具默认不可见（fail-closed）。
 *      漏配的后果是"用不了"，不是"越权能用"。
 *   2. **同状态重复 apply 直接返回。** 换掩码会让前缀缓存从首个变化的 schema
 *      token 起失效，没有状态变化的空切换纯属花钱。
 *   3. **掩码表先写在代码里。** MVP-0 不引配置层——配置错了没人拦得住，
 *      而这张表只有五条状态掩码加一张空看板掩码，改它的频率远低于改代码。
 */
import type { TaskState } from '../schema/spec.js'

/**
 * 每个状态下模型可见的工具。
 *
 * 只增不减是刻意的：contracted 含 drafting 的全部，verifying 含 implementing 的全部。
 * 放开容易，收回难——状态往回退时（验收不过、契约重签）能力自然收回。
 *
 * **注意 `contract_sign` 不在这里，也永远不该在。**
 * 模型能调用的工具就等于模型能给自己签字，S1（未签契约不能改代码）当场失效。
 * 签署是人机命令（`ctx.commands`，不经过模型回合），见 docs/cookbook/adding-a-tool.md。
 */
export const SURFACE: Readonly<Record<TaskState, readonly string[]>> = {
  drafting: ['file_read', 'project_draft', 'spec_query', 'spec_draft', 'spec_bind', 'task_read', 'task_draft', 'contract_draft'],
  contracted: [
    'file_read',
    'project_draft',
    'spec_query',
    'spec_draft',
    'spec_bind',
    'task_read',
    'task_draft',
    'contract_draft',
    'file_edit',
    'cmd_run',
    'evidence_attach',
  ],
  implementing: [
    'file_read',
    'project_draft',
    'spec_query',
    'spec_draft',
    'spec_bind',
    'task_read',
    'task_draft',
    'contract_draft',
    'file_edit',
    'cmd_run',
    'evidence_attach',
  ],
  verifying: [
    'file_read',
    'project_draft',
    'spec_query',
    'spec_draft',
    'spec_bind',
    'task_read',
    'task_draft',
    'contract_draft',
    'file_edit',
    'cmd_run',
    'evidence_attach',
    'task_close',
  ],
  // 终态只读：能复核，不能动手。
  closed: ['file_read', 'spec_query', 'task_read'],
}

/**
 * 空看板掩码：会话工作区里取不到任务状态时（`.spec` 不存在或 `tasks/` 为空）
 * 模型可见的工具。
 *
 * 这一档回答的是「一个只有产品文档、甚至连文档都没有的仓库该怎么立项」：
 * 读代码、读规格、读已有任务，把问清的项目信息登记成 `project.yaml`，把业务口径
 * 登记成 draft 规格条目，再把调研结论落成一个新的起草态任务。`file_edit`、
 * `cmd_run` 不在这里，`spec_bind` 与 `contract_draft` 也不在——任务还没立，
 * 绑落点和起草契约都太早。
 *
 * `project_draft` 与 `spec_draft` 是这条引导链的落盘口：没有它们，引导问到的
 * 答案只能停在对话里，重启即丢，而 UI 侧没有写盘通道（`.spec` 只有 kernel 能写）。
 *
 * 掩码只覆盖 `@lcoder/kernel` 自己注册的工具；上游 bundle 全局注册的
 * `read`/`edit`/`write`/`glob`/`grep`/`bash`/`pwsh` 由 `when` 管不到，
 * 收口它们需要 Agent 作用域的 `restrict`（见 `SurfaceSwitcher`）。
 */
export const UNSCOPEED_SURFACE: readonly string[] = [
  'file_read',
  'project_draft',
  'spec_query',
  'spec_draft',
  'task_read',
  'task_draft',
]

/**
 * 某个状态（或空看板）允许的工具名。
 * @param state - 当前任务状态；没有任务时传 null。
 * @returns 模型可见的工具名清单。
 */
export function allowedTools(state: TaskState | null): readonly string[] {
  return state === null ? UNSCOPEED_SURFACE : SURFACE[state]
}

/** 所有掩码里出现过的工具名，去重。 */
export function allToolNames(): string[] {
  return [...new Set([...Object.values(SURFACE).flat(), ...UNSCOPEED_SURFACE])].sort()
}

// ── 边界：DSH 的 restrict 形状 ─────────────────────────────

/**
 * 只依赖形状，不依赖包。真实的 `agent.ctx.tools` 结构上满足它。
 * 注意 DSH 侧会在**非 Agent 作用域**调用时抛错——那是正确行为，不要 try 掉。
 */
export interface ToolGate {
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
}

export class SurfaceSwitcher {
  private lift: (() => void) | null = null
  private applied: TaskState | null = null
  private disposed = false

  constructor(private readonly gate: ToolGate) {}

  /** 切到某个状态的工具面。同状态重复调用是空操作。 */
  apply(state: TaskState): void {
    if (this.disposed) throw new Error('SurfaceSwitcher 已销毁，不能再切状态')
    if (this.applied === state) return

    this.lift?.()
    this.lift = this.gate.restrict({ allow: SURFACE[state] })
    this.applied = state
  }

  get current(): TaskState | null {
    return this.applied
  }

  dispose(): void {
    this.lift?.()
    this.lift = null
    this.disposed = true
  }
}

// ── 自检：掩码表 vs 实际注册表 ─────────────────────────────

export interface SurfaceCheck {
  /** 掩码里写了，但没有任何插件注册 → 这个状态下会缺工具 */
  missing: string[]
  /** 注册了，但任何状态都看不到 → 永远调不到，几乎总是配错 */
  orphan: string[]
}

/**
 * 拿掩码表对实际注册的工具名做一次比对。
 * 这类检查适合放进启动自检：它不需要模型判断，只是两份清单求差集。
 */
export function checkSurface(registered: readonly string[]): SurfaceCheck {
  const known = new Set(registered)
  const declared = new Set(allToolNames())

  return {
    missing: [...declared].filter(n => !known.has(n)).sort(),
    orphan: [...known].filter(n => !declared.has(n)).sort(),
  }
}
