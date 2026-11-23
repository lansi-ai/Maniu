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
import { BUILTIN_ROLES } from '../schema/roles.js'
import type { BuiltinRoleId } from '../schema/roles.js'

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
  drafting: ['file_read', 'file_list', 'project_draft', 'spec_query', 'spec_draft', 'spec_bind', 'task_read', 'task_draft', 'contract_draft', 'proposal_draft', 'requirement_draft', 'requirement_revise', 'requirement_propose', 'requirement_patch_propose', 'requirement_amend', 'requirement_review_draft', 'requirement_split_plan', 'prototype_draft', 'prototype_patch', 'prototype_stage', 'git_status', 'git_diff', 'role_draft'],
  contracted: [
    'file_read',
    'file_list',
    'project_draft',
    'spec_query',
    'spec_draft',
    'spec_bind',
    'task_read',
    'task_draft',
    'proposal_draft',
    'requirement_draft',
    'requirement_revise',
    'requirement_propose',
    'requirement_patch_propose',
    'requirement_amend',
    'requirement_review_draft',
    'requirement_split_plan',
    'git_status',
    'git_diff',
    'git_commit',
    'contract_draft',
    'file_edit',
    'cmd_run',
    'evidence_attach',
    'deliverable_draft',
    'prototype_draft',
    'prototype_patch',
    'prototype_stage',
    'role_draft',
  ],
  implementing: [
    'file_read',
    'file_list',
    'project_draft',
    'spec_query',
    'spec_draft',
    'spec_bind',
    'task_read',
    'task_draft',
    'proposal_draft',
    'requirement_draft',
    'requirement_revise',
    'requirement_propose',
    'requirement_patch_propose',
    'requirement_amend',
    'requirement_review_draft',
    'requirement_split_plan',
    'git_status',
    'git_diff',
    'git_commit',
    'contract_draft',
    'file_edit',
    'cmd_run',
    'evidence_attach',
    'deliverable_draft',
    'prototype_draft',
    'prototype_patch',
    'prototype_stage',
    'role_draft',
  ],
  verifying: [
    'file_read',
    'file_list',
    'project_draft',
    'spec_query',
    'spec_draft',
    'spec_bind',
    'task_read',
    'task_draft',
    'proposal_draft',
    'requirement_draft',
    'requirement_revise',
    'requirement_propose',
    'requirement_patch_propose',
    'requirement_amend',
    'requirement_review_draft',
    'requirement_split_plan',
    'git_status',
    'git_diff',
    'git_commit',
    'contract_draft',
    'file_edit',
    'cmd_run',
    'evidence_attach',
    'deliverable_draft',
    'prototype_draft',
    'prototype_patch',
    'prototype_stage',
    'task_close',
    'role_draft',
  ],
  // 终态只读：能复核，不能动手。
  closed: ['file_read', 'file_list', 'spec_query', 'task_read', 'git_status', 'git_diff'],
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
 * 掩码只覆盖 `@maniu/kernel` 自己注册的工具。桌面 profile 的 web-app bundle 在
 * 宿主机面禁用了 `tool-fs` / `tool-fs-search` / `tool-bash` / `tool-pwsh`，改由每个
 * preset 自己挂；LCoder 的 preset 只挂本包，所以角色面必须自带列目录能力
 * （`file_list`），不能指望上游的 `glob`（T-32）。
 */
export const UNSCOPEED_SURFACE: readonly string[] = [
  'file_read',
  'file_list',
  'project_draft',
  'spec_query',
  'spec_draft',
  'task_read',
  'task_draft',
  'proposal_draft',
  'requirement_draft',
  'requirement_revise',
  'requirement_propose',
  'requirement_patch_propose',
  'requirement_amend',
  'requirement_review_draft',
  'requirement_split_plan',
  'prototype_draft',
  'prototype_patch',
  'prototype_stage',
  'git_status',
  'git_diff',
]

// ── 角色天花板 ─────────────────────────────────────────────

/**
 * 一个会话所属的角色；一个角色就是一个 Agent preset，装配层用 `role` 配置本插件。
 * 名字集合与岗位 `inherits` 共用 `schema/roles.ts` 那一份。
 */
export type RoleId = BuiltinRoleId

/** 全部角色，`Config.role` 的取值域。 */
export const ROLES: readonly RoleId[] = BUILTIN_ROLES

/**
 * 每个角色最多能拿到哪些工具。
 *
 * 与 `SURFACE` 求交后才进模型视野，所以这张表只会让能力变少，不会越过状态：
 * `contract_sign` 不在任何一行里，它是人机命令（见文件头那条注意）。
 * `dev` 这一行必须等于 `allToolNames()` 去掉只对特定角色开放的 `role_draft`、`requirement_draft`、
 * `requirement_revise`、`requirement_propose`、`requirement_patch_propose`、`requirement_amend`、`requirement_review_draft`
 * `requirement_split_plan`、`prototype_draft`、`prototype_patch` 与 `prototype_stage`，否则新增工具会静默地对实施角色隐身，`surface.spec.ts` 用一条断言钉住这个等式。
 */
export const ROLE_TOOLS: Readonly<Record<RoleId, readonly string[]>> = {
  /** 立项/需求分析师：读产品文档、列目录、读规格、读任务，起草需求、按评审报告改稿、出需求变更提案，以及对已确认需求执行 S 级轻量修补。 */
  intake: ['file_read', 'file_list', 'project_draft', 'spec_query', 'spec_draft', 'task_read', 'task_draft', 'requirement_draft', 'requirement_revise', 'requirement_propose', 'requirement_amend'],
  /** 架构/契约：加上给规格条目绑落点和起草契约，仍然动不了代码。 */
  architect: ['file_read', 'file_list', 'spec_query', 'spec_bind', 'task_read', 'task_draft', 'contract_draft', 'deliverable_draft'],
  /** 项目经理：谈需求、出方案、拆任务并出评审报告；不给改稿、不给契约、不给改代码。 */
  pm: ['file_read', 'file_list', 'spec_query', 'spec_draft', 'task_read', 'task_draft', 'proposal_draft', 'requirement_review_draft'],
  /** 实施：除只对特定角色开放的写入口外，状态说了算。 */
  dev: [
    'file_read',
    'file_list',
    'project_draft',
    'spec_query',
    'spec_draft',
    'spec_bind',
    'task_read',
    'task_draft',
    'proposal_draft',
    'git_status',
    'git_diff',
    'git_commit',
    'contract_draft',
    'file_edit',
    'cmd_run',
    'evidence_attach',
    'deliverable_draft',
    'task_close',
  ],
  /** Git：看状态与差异，把指定路径提交到本地仓库；没有编辑能力，也没有 push。 */
  git: ['file_read', 'file_list', 'spec_query', 'task_read', 'git_status', 'git_diff', 'git_commit'],
  /** 运维：写与维护部署脚本、跑登记过的命令、挂证据；收口与提交不归它。 */
  ops: ['file_read', 'file_list', 'spec_query', 'spec_bind', 'task_read', 'task_draft', 'contract_draft', 'file_edit', 'cmd_run', 'evidence_attach', 'deliverable_draft'],
  /** 评审：只读复核，外加挂证据与收口；永远不给改代码与跑命令。 */
  review: ['file_read', 'file_list', 'spec_query', 'task_read', 'evidence_attach', 'task_close'],
  /**
   * 智能调度：只看任务与规格，负责把任务分给合适的会话。
   * 分配判定由 `scheduling.ts` 算出，这一角色没有写盘与执行能力，连任务消息也不发。
   */
  scheduler: ['file_read', 'file_list', 'spec_query', 'task_read'],
  /**
   * 流程控制：只看任务与规格，负责说明下一步、理由与挡住原因。
   * 它不推进状态、不签契约、不收口；那些仍走人机命令或后续执行器。
   */
  flow: ['file_read', 'file_list', 'spec_query', 'task_read'],
  /**
   * 研发经理：需求与任务拆完之后，给每条任务定岗位，并可对需求出评审报告。
   * 它按技术维度拆任务（`task_draft`）、把逐条岗位建议写成拆分计划（`requirement_split_plan`），
   * 并起草岗位名册（`role_draft`）；**分配仍是人机命令** `/task_assign`。
   * 评审用 `requirement_review_draft` 只出报告，不改需求正文与状态；过审由人做。
   * 没有任何改代码或跑命令的能力。
   */
  manager: ['file_read', 'file_list', 'spec_query', 'task_read', 'task_draft', 'role_draft', 'requirement_split_plan', 'requirement_review_draft'],
  /**
   * 草稿修改：只读需求与规格，生成「修改当前草稿」提案，不能写正文、不能改需求本体。
   * 只给 requirement_patch_propose 这一条写入口，宿主执行层据此拒绝直接改稿与其它写入口。
   */
  'requirement-editor': ['file_read', 'file_list', 'spec_query', 'task_read', 'requirement_patch_propose'],
  /**
   * 原型设计师：只读需求与规格，产出单文件 HTML 原型并调用 prototype_draft，
   * 按点选上报调用 prototype_patch 做元素级修改，或用 prototype_stage 暂存多轮打磨。
   * 仅放行读取与原型暂存/落盘；没有 file_edit / cmd_run / 签署 / 过审 / 拆分类能力。
   * `ask_user_question` 由 preset 的 ask-user 工具提供，不在本包掩码里，列出仅作口径。
   */
  prototype: ['file_read', 'file_list', 'spec_query', 'task_read', 'prototype_draft', 'prototype_patch', 'prototype_stage', 'ask_user_question'],
}

/**
 * 校验装配层传来的角色名。
 * @param value - `Config.role` 的原始值；`undefined` 表示不设角色。
 * @returns 角色或 null。
 * @throws 配置了不认识的角色名——配错要当场响，不能静默按无角色装配。
 */
export function parseRole(value: unknown): RoleId | null {
  if (value === undefined) return null
  if (typeof value === 'string' && (ROLES as readonly string[]).includes(value)) return value as RoleId
  throw new TypeError(`[lcoder] 未知角色：${typeof value === 'string' ? value : typeof value}，可用角色 ${ROLES.join(' / ')}`)
}

/**
 * 某个状态（或空看板）在某角色下的工具面。
 *
 * 状态是进度，角色是天花板：两者求交，谁也不会凭空多出对方给不了的能力。
 * `role` 为 null 时不设天花板，保持只有状态一维的旧行为。
 * @param state - 当前任务状态；没有任务时传 null。
 * @param role - 本插件实例所属角色；未配置时传 null。
 * @returns 模型可见的工具名清单。
 */
export function allowedTools(state: TaskState | null, role: RoleId | null = null): readonly string[] {
  const byState = state === null ? UNSCOPEED_SURFACE : SURFACE[state]
  if (role === null) return byState
  const ceiling = new Set(ROLE_TOOLS[role])
  return byState.filter(name => ceiling.has(name))
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
