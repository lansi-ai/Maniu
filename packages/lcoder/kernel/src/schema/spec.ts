/**
 * `.spec/` 的形状唯一来源。
 *
 * 一条边界必须说清：
 *   本文件只保证「形状对」——字段存在、类型正确、枚举合法、必填非空。
 *   「语义是否合规」不是 schema 的职责，由 checkers 承担。
 *   例：`status: confirmed` 但 `found_at` 为空，schema 放行，P1 判失败。
 *   这条分工如果被打破，检查器就会被塞进 schema，最后没人能单独演进规则。
 */
import { z } from 'zod'

/** 评审纪律里稳定不变的编号形态：R-02 / T-014 / W-01 / Q-03。 */
const Id = z.string().regex(/^[A-Z]+-\d{2,}$/, '形如 R-02 / T-014 的稳定编号')

const IsoDateTime = z
  .string()
  .refine(s => !Number.isNaN(Date.parse(s)), '需要可解析的 ISO 8601 时间')

// ── 1. 规格条目 ─────────────────────────────────────────────

export const RuleKind = z.enum([
  'rule',
  'formula',
  'invariant',
  'enum',
  'state_machine',
  'api',
])
export type RuleKind = z.infer<typeof RuleKind>

export const RuleStatus = z.enum(['draft', 'confirmed', 'deprecated'])
export type RuleStatus = z.infer<typeof RuleStatus>

/** 落点：这条规格被哪一处代码实现。symbol 可省（如配置文件、SQL）。 */
export const FoundAt = z.object({
  file: z.string().min(1),
  symbol: z.string().min(1).optional(),
})
export type FoundAt = z.infer<typeof FoundAt>

/** 验收引用：不在这里内联测试用例，只指向既有用例或脚本。 */
export const Acceptance = z.object({
  kind: z.enum(['test', 'script', 'manual']),
  ref: z.string().min(1),
})

export const RuleEntry = z.object({
  id: Id,
  module: z.string().min(1),
  kind: RuleKind,
  /** 规格正文。公式类写成可读算式，不写成散文。 */
  text: z.string().min(1),
  /** 出处。没有出处的条目不可确认——这是人敢确认它的前提。 */
  source: z.object({
    doc: z.string().min(1),
    quote: z.string().min(1).optional(),
  }),
  status: RuleStatus,
  found_at: z.array(FoundAt).default([]),
  acceptance: z.array(Acceptance).default([]),
  /** 关联的未决项编号；非空即阻断关联代码进 diff（P2）。 */
  blocks: z.array(Id).default([]),
})
export type RuleEntry = z.infer<typeof RuleEntry>

export const RulesFile = z.object({
  rules: z.array(RuleEntry),
})

// ── 2. 状态机 ───────────────────────────────────────────────

export const Transition = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  trigger: z.string().min(1).optional(),
})

/** 守卫：对某条目标状态的额外限制，P5′ 用来判「表外迁移」。 */
export const Guard = z.object({
  to: z.string().min(1),
  only_from: z.array(z.string().min(1)).min(1),
  note: z.string().optional(),
})

export const StateMachine = z.object({
  id: z.string().min(1),
  module: z.string().min(1).optional(),
  statuses: z.array(z.string().min(1)).min(1),
  transitions: z.array(Transition),
  guards: z.array(Guard).default([]),
})
export type StateMachine = z.infer<typeof StateMachine>

// ── 3. 任务 ─────────────────────────────────────────────────

export const TaskGrade = z.enum(['A', 'B', 'C'])
/** 五态：起草 → 已签约 → 实施 → 验证 → 收口。closed 是终态。 */
export const TaskState = z.enum([
  'drafting',
  'contracted',
  'implementing',
  'verifying',
  'closed',
])
export type TaskState = z.infer<typeof TaskState>

export const Task = z.object({
  id: Id,
  title: z.string().min(1),
  grade: TaskGrade,
  state: TaskState,
  /** 本任务触及的规格条目。 */
  rules: z.array(Id).default([]),
  scope: z
    .object({
      /** 不可逆对象（接口 / 数据结构 / 权限 / 金额），触及即需人签署（P3）。 */
      irreversible: z.array(z.string().min(1)).default([]),
      allowed_paths: z.array(z.string().min(1)).default([]),
    })
    .default({ irreversible: [], allowed_paths: [] }),
  /** 收口必备的证据项（对应 env.commands 的 id）。缺一不得收口（P4）。 */
  evidence_required: z.array(z.string().min(1)).default([]),
  opened_at: IsoDateTime,
  closed_at: IsoDateTime.nullable().default(null),
})
export type Task = z.infer<typeof Task>

// ── 4. 契约 ─────────────────────────────────────────────────

export const Signature = z.object({
  by: z.enum(['human', 'agent']),
  at: IsoDateTime,
  hash: z.string().min(1),
})

export const Contract = z.object({
  id: Id,
  change: z.array(z.string().min(1)).min(1),
  not_change: z.array(z.string().min(1)).default([]),
  acceptance: z.array(z.string().min(1)).min(1),
  affected_tests: z.array(z.string().min(1)).default([]),
  fail_if: z.array(z.string().min(1)).default([]),
  /** 未签署为 null。签署后内容不可变，变更需重签并换 hash。 */
  sig: Signature.nullable().default(null),
})
export type Contract = z.infer<typeof Contract>

// ── 5. 环境档案 ─────────────────────────────────────────────

/** 三级执行权。默认给最保守的一档：需要确认。 */
export const ExecPolicy = z.enum(['human', 'ai-confirm', 'ai-auto'])
export type ExecPolicy = z.infer<typeof ExecPolicy>

export const Command = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  cmd: z.string().min(1),
  cwd: z.string().default('.'),
  timeout: z.number().int().positive().default(300),
  exec: ExecPolicy.default('ai-confirm'),
  /** 超过该天数未验证则标黄（命令会腐坏）。 */
  verify_days: z.number().int().positive().default(30),
  last_ok: IsoDateTime.optional(),
  precheck: z.array(z.string().min(1)).default([]),
  dry_run: z.enum(['none', 'required']).default('none'),
  /** 为 true 时其值写 .spec/local.yaml（不提交），仓库只留结构。 */
  sensitive: z.boolean().default(false),
})
export type Command = z.infer<typeof Command>

export const Credential = z.object({
  name: z.string().min(1),
  source: z.enum(['env', 'wincred', 'file']),
})

export const Env = z.object({
  repo: z.object({
    url: z.string().min(1),
    branch: z.string().min(1),
    push_mode: z.enum(['direct', 'branch']),
  }),
  commands: z.array(Command),
  credentials: z.array(Credential).default([]),
})
export type Env = z.infer<typeof Env>

// ── 目录布局 ↔ schema 的绑定 ────────────────────────────────

/**
 * `.spec/` 的路径约定，与 TECH-DESIGN §3 一致。
 * 校验器（S-02）按这张表决定「这个文件该用哪个 schema 解」。
 */
export const SpecLayout = [
  { glob: 'spec/rules.yaml', schema: RulesFile, many: false },
  { glob: 'spec/states/*.yaml', schema: StateMachine, many: true },
  { glob: 'tasks/*.yaml', schema: Task, many: true },
  { glob: 'contracts/*.contract.yaml', schema: Contract, many: true },
  { glob: 'env.yaml', schema: Env, many: false },
] as const
