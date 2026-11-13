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

import { BUILTIN_ROLES, ROLE_ID_PATTERN } from './roles.js'
import { BUILTIN_TRACK_IDS, TRACK_ID_PATTERN } from './tracks.js'

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

/** 任务领域：页面、接口、数据、其他。 */
export const TaskCategory = z.enum(['page', 'api', 'data', 'other'])
export type TaskCategory = z.infer<typeof TaskCategory>

/** 变更类型：缺陷、新功能、改进、样式。 */
export const TaskChangeType = z.enum(['bug', 'feature', 'improvement', 'style'])
export type TaskChangeType = z.infer<typeof TaskChangeType>

/** 任务描述上限：够写清背景与验收，又不至于把任务文件撑成文档。 */
const TASK_DESCRIPTION_MAX = 4000
/** 一条任务的图片附件上限。 */
const TASK_ATTACHMENT_LIMIT = 8
/** 附件允许的图片扩展名；比较时忽略大小写。 */
const IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif']

/**
 * 附件路径：相对 `.spec` 根目录，例如 `attachments/T-01/shot.png`。
 *
 * 绝对路径与 `..` 上跳会被拒，写盘侧再按规格根复核一次，两处都守；
 * 只校形状，不要求文件已经存在——缺图由界面显示占位。
 */
const AttachmentPath = z.string().superRefine((value, ctx) => {
  const path = value.trim()
  if (path === '') {
    ctx.addIssue({ code: 'custom', message: '附件路径不能为空' })
    return
  }
  if (/^(?:[A-Za-z]:|[\\/])/.test(path)) {
    ctx.addIssue({ code: 'custom', message: `附件路径必须是相对 .spec 根目录的相对路径，不能是绝对路径：${value}` })
    return
  }
  const segments = path.split(/[\\/]/)
  if (segments.includes('..')) {
    ctx.addIssue({ code: 'custom', message: `附件路径不能包含 ..，不能跳出 .spec 根目录：${value}` })
    return
  }
  const extension = /\.([A-Za-z0-9]+)$/.exec(segments[segments.length - 1] ?? '')?.[1]
  if (extension === undefined || !IMAGE_EXTENSIONS.includes(extension.toLowerCase())) {
    ctx.addIssue({ code: 'custom', message: `附件只允许 png、jpg、jpeg、webp、gif 图片：${value}` })
  }
})

export const Task = z.object({
  id: Id,
  title: z.string().min(1),
  /** 需求描述：具体要做什么、为什么；允许换行，最多 4000 个字符。缺省为空串。 */
  description: z
    .string()
    .max(TASK_DESCRIPTION_MAX, `任务描述最多 ${String(TASK_DESCRIPTION_MAX)} 个字符`)
    .default(''),
  /** 领域分类；缺省表示还没分。 */
  category: TaskCategory.optional(),
  /** 变更类型；缺省表示还没分。 */
  change_type: TaskChangeType.optional(),
  /** 图片附件：相对 `.spec` 根目录的路径，最多 8 张；缺省为空数组。 */
  attachments: z
    .array(AttachmentPath)
    .max(TASK_ATTACHMENT_LIMIT, `附件最多 ${String(TASK_ATTACHMENT_LIMIT)} 张`)
    .default([]),
  grade: TaskGrade,
  state: TaskState,
  /** 本任务触及的规格条目。 */
  rules: z.array(Id).default([]),
  /**
   * 这条任务出自哪个方案（`.spec/proposals/P-01.yaml`）。
   *
   * 缺省表示不是拆出来的（人直接立的、或立项引导落的）。编号必须存在，
   * 由 `task_draft` 在写盘前查；读侧遇到失效编号按「未知方案」显示，不报故障。
   */
  proposal: Id.optional(),
  /**
   * 前置任务：这些任务收口之前，本条不许开始。
   *
   * 由人机起草时声明（`task_draft` 写），调度侧据此把任务按住而不是拒绝开始。
   * 写盘前校验存在、禁自依赖、禁环；读侧遇到失效编号按「未知任务」显示，不报故障。
   */
  depends_on: z.array(Id).default([]),
  scope: z
    .object({
      /** 不可逆对象（接口 / 数据结构 / 权限 / 金额），触及即需人签署（P3）。 */
      irreversible: z.array(z.string().min(1)).default([]),
      allowed_paths: z.array(z.string().min(1)).default([]),
    })
    .default({ irreversible: [], allowed_paths: [] }),
  /** 收口必备的证据项（对应 env.commands 的 id）。缺一不得收口（P4）。 */
  evidence_required: z.array(z.string().min(1)).default([]),
  /**
   * 认领这条任务的会话号（宿主 home 里的运行时标识）。
   *
   * 只有人机命令 `/task_bind` 写它，模型不写：这条关系决定该会话按哪个任务的状态装工具面，
   * 让 agent 自己认领等于自己挑工具面。缺省表示这条任务还没被任何会话认领。
   * 会话号换机器或删会话后失效，失效按未认领处理，不报故障。
   */
  session: z.string().min(1).optional(),
  /**
   * 这条任务归属的轨：内置轨 id，或 `.spec/project.yaml` 里项目追加的轨 id。
   *
   * 拆分只标轨，不分配岗位：轨决定方案讨论邀请哪条交付面的技术岗位，
   * 实施阶段的具体岗位仍由人机命令 `/task_assign` 写进 `role`。
   * 这里只校形态；「这条轨存不存在」由 `task_draft` 在写盘前查。
   */
  track: z.string().regex(TRACK_ID_PATTERN, '轨 id 要小写字母开头，只含小写字母、数字、下划线或连字符').optional(),
  /**
   * 这条任务分配的岗位：`roles.yaml` 里的岗位 id，或一个内置角色 id。
   *
   * 只有人机命令 `/task_assign` 写它，模型不写：分配是调度硬约束，模型能自己认岗
   * 就等于自己挑工具面。读侧遇到名册与内置角色都不认识的 id 时按「未知岗位」显示，
   * 不报故障——与会话号失效同一口径。缺省表示还没分配。
   */
  role: z.string().min(1).optional(),
  opened_at: IsoDateTime,
  closed_at: IsoDateTime.nullable().default(null),
}).strict()
export type Task = z.infer<typeof Task>

// ── 4. 契约 ─────────────────────────────────────────────────

/** AI 自签的授权依据：哪份策略、哪个版本、什么时候判定。 */
export const SignatureAuthorization = z.object({
  /** 策略文件的规格根相对路径（`automation.yaml`）。 */
  policy: z.string().min(1),
  /** 判定时策略文件的内容哈希；缺省策略没有哈希，不得自签，故这里必填。 */
  hash: z.string().min(1),
  at: IsoDateTime,
})
export type SignatureAuthorization = z.infer<typeof SignatureAuthorization>

/**
 * 契约签名。
 *
 * `by: agent` 只在三补偿闸同时成立时有效（策略签署为 auto、任务无可逆项、契约有评审复核证据），
 * 所以它必须带上 `actor`（具体 preset）与 `authorization`（策略授权依据）；
 * 缺一样就不是一次可审计的自签，schema 直接判非法。
 */
export const Signature = z
  .object({
    by: z.enum(['human', 'agent']),
    at: IsoDateTime,
    hash: z.string().min(1),
    /** 自签者的具体 preset；人签时缺省。 */
    actor: z.string().min(1).optional(),
    authorization: SignatureAuthorization.optional(),
  })
  .superRefine((sig, ctx) => {
    if (sig.by !== 'agent') return
    if (sig.actor === undefined) {
      ctx.addIssue({ code: 'custom', path: ['actor'], message: 'AI 自签必须写明 actor（具体 preset）' })
    }
    if (sig.authorization === undefined) {
      ctx.addIssue({ code: 'custom', path: ['authorization'], message: 'AI 自签必须写明授权依据（策略路径、哈希与判定时刻）' })
    }
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

// ── 5. 自动化策略 ───────────────────────────────────────────

/** 一个动作是自动执行还是等人触发。 */
export const AutomationMode = z.enum(['auto', 'manual'])
export type AutomationMode = z.infer<typeof AutomationMode>

/** 策略能开关的动作。外部不可逆动作（push、部署、环境变更）不在其中，永不进配置。 */
export const AutomationActionName = z.enum([
  'draft',
  'contract',
  'sign',
  'implement',
  'verify',
  'close',
  'commit',
])
export type AutomationActionName = z.infer<typeof AutomationActionName>

const MANUAL_ACTIONS: Readonly<Record<AutomationActionName, AutomationMode>> = {
  draft: 'manual',
  contract: 'manual',
  sign: 'manual',
  implement: 'manual',
  verify: 'manual',
  close: 'manual',
  commit: 'manual',
}

/**
 * 按动作的开关。`strict` 不是排版偏好：`push`、`deploy` 这类键落到这里必须判非法，
 * 否则配置文件本身就成了绕过「外部动作只由人做」的入口。
 */
const AutomationActions = z
  .object({
    draft: AutomationMode.default('manual'),
    contract: AutomationMode.default('manual'),
    sign: AutomationMode.default('manual'),
    implement: AutomationMode.default('manual'),
    verify: AutomationMode.default('manual'),
    close: AutomationMode.default('manual'),
    commit: AutomationMode.default('manual'),
  })
  .strict()

/** 停止条件。缺一项表示这一项不设限。 */
export const AutomationLimits = z
  .object({
    token_budget: z.number().int().positive().optional(),
    max_minutes: z.number().int().positive().optional(),
    max_consecutive_failures: z.number().int().min(0).optional(),
    max_parallel: z.number().int().positive().optional(),
  })
  .strict()
export type AutomationLimits = z.infer<typeof AutomationLimits>

/**
 * `.spec/automation.yaml`：每项目一份，按动作声明哪些能自动、何时停、管哪些任务。
 *
 * 缺失即全手动；这条默认值由加载器给，不靠 schema 的空对象兜底，
 * 因为「没有文件」与「文件里什么都没写」在审计上不是一回事。
 */
export const AutomationPolicy = z
  .object({
    actions: AutomationActions.default(MANUAL_ACTIONS),
    limits: AutomationLimits.default({}),
    /** 只对列出的任务生效；空数组表示全部任务。 */
    tasks: z.array(Id).default([]),
  })
  .strict()
export type AutomationPolicy = z.infer<typeof AutomationPolicy>

// ── 6. 方案 ─────────────────────────────────────────────────

/**
 * 方案的决定态。
 *
 * `draft` 由模型起草；`approved` 与 `rejected` 是人的结论，只有人机命令 `/proposal_approve`
 * 写它——模型能出方案，不能给自己拍板，与 `contract_sign` 同一档口径。
 */
export const ProposalDecision = z.enum(['draft', 'approved', 'rejected'])
export type ProposalDecision = z.infer<typeof ProposalDecision>

/** 一个候选方案：叫什么、怎么做、代价是什么。三样都必填，只写「建议做」的方案没有比较价值。 */
export const ProposalOption = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  cost: z.string().min(1),
})
export type ProposalOption = z.infer<typeof ProposalOption>

/** `.spec/proposals/P-01.yaml`：一次需求探讨的落盘物，拆出去的任务用 `Task.proposal` 回指它。 */
export const Proposal = z.object({
  id: Id,
  title: z.string().min(1),
  /** 要办成的事与现状缺口，一句话说清；方案的评判基准。 */
  problem: z.string().min(1),
  options: z.array(ProposalOption).min(1),
  /** 推荐哪一个，以及为什么。 */
  recommendation: z.string().min(1),
  decision: ProposalDecision.default('draft'),
  /** 人的结论时刻；`draft` 为 null。 */
  decided_at: IsoDateTime.nullable().default(null),
  opened_at: IsoDateTime,
})
export type Proposal = z.infer<typeof Proposal>

// ── 6.5 常驻会话登记 ────────────────────────────────────────

/**
 * `.spec/agents.yaml`：每个仓库一份的常驻单例会话号。
 *
 * 与 `Task.session` 同一口径——宿主 home 里的运行时标识。会话被删、换机器或
 * 编号对不上时按未绑定处理，由界面重新找一条同 preset 的会话或新建后写回。
 * 这里只登记两个调度角色的会话，不承担角色名册或权限配置；岗位名册在 `roles.yaml`。
 */
export const AgentsRegistry = z
  .object({
    /** 「智能调度」角色唯一的会话。 */
    schedulerSession: z.string().min(1).optional(),
    /** 「流程控制」角色唯一的会话。 */
    flowSession: z.string().min(1).optional(),
  })
  .strict()
export type AgentsRegistry = z.infer<typeof AgentsRegistry>

// ── 6.6 岗位名册 ────────────────────────────────────────────

/** 岗位 id：小写字母开头，只含小写字母、数字、下划线与连字符；不得占用内置角色名。 */
export const JobRoleId = z
  .string()
  .regex(ROLE_ID_PATTERN, '岗位 id 要小写字母开头，只含小写字母、数字、下划线或连字符')
  .refine(id => !(BUILTIN_ROLES as readonly string[]).includes(id), '岗位 id 不能与内置角色同名')

/** 岗位信号的规模上限：每组最多 32 条、每条最多 64 个字符；去重后按原顺序落盘。 */
export const SIGNAL_LIMITS = { perGroup: 32, perTerm: 64 } as const

/**
 * 一组信号词。空白条目与空白词判非法；同一组内忽略大小写去重，保留首次出现的写法。
 * @param label - 出错信息里的字段名。
 * @returns 校验并去重后的字符串数组。
 */
function signalList(label: string) {
  return z
    .array(
      z
        .string({ error: `${label} 必须是字符串数组` })
        .trim()
        .min(1, `${label} 里不能有空字符串`)
        .max(SIGNAL_LIMITS.perTerm, `${label} 单条不能超过 ${String(SIGNAL_LIMITS.perTerm)} 个字符`),
      { error: `${label} 必须是字符串数组` },
    )
    .max(SIGNAL_LIMITS.perGroup, `${label} 最多 ${String(SIGNAL_LIMITS.perGroup)} 条`)
    .transform((terms) => {
      const seen = new Set<string>()
      return terms.filter((term) => {
        const key = term.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    })
    .default([])
}

/**
 * 岗位的可机读能力声明：技术栈强特征词、弱语义词与文件落点偏好。
 *
 * 三组都是字符串数组，允许为空；`strong` 命中权重高于 `medium`，`preferredPaths`
 * 按路径前缀与任务允许路径比对。这里只校验形状与上限，不判断词是否真的属于该技术栈。
 */
export const RoleSignals = z
  .object({
    /** 技术栈强特征词，如 `c#`、`vue`、`kotlin`。 */
    strong: signalList('signals.strong'),
    /** 弱语义词，如「页面」「脚本」。 */
    medium: signalList('signals.medium'),
    /** 文件落点偏好，按路径前缀比较，如 `src/Client/`、`app/src/main/`。 */
    preferredPaths: signalList('signals.preferredPaths'),
  })
  .strict()
export type RoleSignals = z.infer<typeof RoleSignals>

/**
 * 一个岗位：轻量定义，天花板继承某个内置角色。
 *
 * `persona` 只是提示词前缀，不改变工具面——能力仍由 `inherits` 指向的角色表决定，
 * 所以新增岗位不可能越过内置角色的权限。`signals` 只供建议层排序，不参与调度硬闸。
 */
export const JobRole = z
  .object({
    id: JobRoleId,
    /** 显示名，如「.NET 工程师」。 */
    name: z.string().min(1),
    /** 继承哪个内置角色；未知名字当场判非法。 */
    inherits: z.enum(BUILTIN_ROLES),
    /** 可选的提示词前缀。 */
    persona: z.string().min(1).optional(),
    /** 可选的可机读信号；缺省表示这个岗位没有声明任何词或落点。 */
    signals: RoleSignals.optional(),
  })
  .strict()
export type JobRole = z.infer<typeof JobRole>

/**
 * `.spec/roles.yaml`：项目自定的岗位名册，由研发经理起草、人机命令分配。
 *
 * 文件缺失视为空名册；名册里 id 不得重复——同一个名字指两个天花板时，
 * 调度硬闸与工具面就没有唯一答案。
 */
export const RolesFile = z
  .object({
    roles: z.array(JobRole).default([]),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>()
    for (const [index, role] of file.roles.entries()) {
      if (seen.has(role.id)) {
        ctx.addIssue({ code: 'custom', path: ['roles', index, 'id'], message: `岗位 id 重复：${role.id}` })
      }
      seen.add(role.id)
    }
  })
export type RolesFile = z.infer<typeof RolesFile>

// ── 7. 环境档案 ─────────────────────────────────────────────

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

/** 项目类型决定外壳是否展示部署环境。 */
export const ProjectKind = z.enum(['web', 'desktop', 'library'])
export type ProjectKind = z.infer<typeof ProjectKind>

/** 一个部署环境；密码只存引用名，实际值由本机 local.yaml 或环境变量解析。 */
export const ProjectEnvironment = z.object({
  server: z.string().min(1).optional(),
  database: z.object({
    host: z.string().min(1),
    port: z.union([z.string().min(1), z.number().int().positive()]).optional(),
    name: z.string().min(1),
    user: z.string().min(1),
    passwordRef: z.string().min(1),
  }).optional(),
  note: z.string().optional(),
})
export type ProjectEnvironment = z.infer<typeof ProjectEnvironment>

/**
 * 项目追加的一条轨。
 *
 * id 形态与内置轨一致；不得与内置轨重名——同一条轨有两个显示名时，
 * 看板与讨论分组就失去了唯一答案。
 */
export const ProjectTrack = z
  .object({
    id: z.string().regex(TRACK_ID_PATTERN, '轨 id 要小写字母开头，只含小写字母、数字、下划线或连字符'),
    /** 显示名，如「支付端」。 */
    name: z.string().min(1),
  })
  .strict()
export type ProjectTrack = z.infer<typeof ProjectTrack>

/** `.spec/project.yaml`：项目交付、文档与部署环境。 */
export const ProjectInfo = z.object({
  kind: ProjectKind,
  repo: z.object({
    url: z.string().min(1),
    branch: z.string().min(1),
  }),
  docs: z.object({
    product: z.string().optional(),
    architecture: z.string().optional(),
    tests: z.string().optional(),
  }).default({}),
  environments: z.record(z.string().min(1), ProjectEnvironment).default({}),
  /** 项目追加的轨；缺省表示只用内置六轨。 */
  tracks: z.array(ProjectTrack).default([]),
}).superRefine((info, ctx) => {
  const seen = new Set<string>()
  for (const [index, track] of info.tracks.entries()) {
    if (BUILTIN_TRACK_IDS.includes(track.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tracks', index, 'id'],
        message: `轨 id ${track.id} 与内置轨重名；内置轨不能被项目覆盖`,
      })
    }
    if (seen.has(track.id)) {
      ctx.addIssue({ code: 'custom', path: ['tracks', index, 'id'], message: `轨 id 重复：${track.id}` })
    }
    seen.add(track.id)
  }
})
export type ProjectInfo = z.infer<typeof ProjectInfo>

// ── 目录布局 ↔ schema 的绑定 ────────────────────────────────

/**
 * `.spec/` 的路径约定，与 TECH-DESIGN §3 一致。
 * 校验器（S-02）按这张表决定「这个文件该用哪个 schema 解」。
 */
export const SpecLayout = [
  { glob: 'spec/rules.yaml', schema: RulesFile, many: false },
  { glob: 'spec/states/*.yaml', schema: StateMachine, many: true },
  { glob: 'tasks/*.yaml', schema: Task, many: true },
  { glob: 'proposals/*.yaml', schema: Proposal, many: true },
  { glob: 'contracts/*.contract.yaml', schema: Contract, many: true },
  { glob: 'automation.yaml', schema: AutomationPolicy, many: false },
  { glob: 'agents.yaml', schema: AgentsRegistry, many: false },
  { glob: 'roles.yaml', schema: RolesFile, many: false },
  { glob: 'env.yaml', schema: Env, many: false },
  { glob: 'project.yaml', schema: ProjectInfo, many: false },
] as const
