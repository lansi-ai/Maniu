/** `.spec` 各 YAML 文本 → 展示行；只收文件里写着的事实。 */

import { parse as parseYaml } from 'yaml'

/** 任务行。 */
export interface TaskRow {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category?: string
  readonly changeType?: string
  readonly attachments: readonly string[]
  readonly state: string
  readonly grade: string
  readonly rules: readonly string[]
  readonly evidence: readonly string[]
  readonly session?: string
  readonly proposal?: string
  readonly requirement?: string
  readonly dependsOn: readonly string[]
  readonly role?: string
  readonly track?: string
  readonly paths: readonly string[]
  readonly irreversible: readonly string[]
  readonly openedAt?: string
  readonly deliverable?: DeliverableRow
}

/** 交付索引。 */
export interface DeliverableRow {
  readonly task: string
  readonly summary: string
  readonly docs: readonly string[]
  readonly commands: readonly string[]
  readonly createdAt?: string
  readonly updatedAt?: string
}

/** 岗位信号，只供建议层排序。 */
export interface RoleSignals {
  readonly strong: readonly string[]
  readonly medium: readonly string[]
  readonly preferredPaths: readonly string[]
}

/** 岗位行。 */
export interface JobRoleRow {
  readonly id: string
  readonly name: string
  readonly inherits: string
  readonly persona?: string
  readonly signals?: RoleSignals
}

/** 内置流程节点类型。 */
export type FlowNodeKind = 'intake' | 'review' | 'revise' | 'split'

/** 一个流程节点：按序岗位与节点内自动衔接开关。 */
export interface FlowNodeRow {
  readonly node: FlowNodeKind
  readonly roles: readonly string[]
  readonly auto: boolean
}

/** `.spec/flow.yaml` 的展示数据；文件缺失时整个字段缺省，走预制。 */
export interface FlowConfigRow {
  readonly nodes: readonly FlowNodeRow[]
}

/** 需求里的一条候选做法。 */
export interface RequirementOptionRow {
  readonly name: string
  readonly summary: string
  readonly cost?: string
}

/** 需求正文的一版快照。 */
export interface RequirementVersionRow {
  readonly n: number
  readonly at: string
  readonly note?: string
}

/** 一轮评审报告及其人工处置。 */
export interface RequirementReviewRow {
  readonly round: number
  readonly at: string
  readonly report: string
  /** 落盘报告时读到的正文全文；报告依据的正文基线；旧数据缺省。 */
  readonly baseContent?: string
  readonly sessionId?: string
  /** 产出这轮评审的会话 preset 署名；旧数据缺省。 */
  readonly role?: string
  /** 人工处置；旧数据无此字段时按 pending 看待。 */
  readonly decision?: 'pending' | 'accepted' | 'rejected'
  /** 处置时刻。 */
  readonly decidedAt?: string
  /** 采纳意见后据以改稿的正文版本号。 */
  readonly appliedVersion?: number
  /** 处置备注。 */
  readonly decisionNote?: string
}

/** 拆分计划里的一条岗位建议。 */
export interface RequirementSplitPlanEntryRow {
  readonly task: string
  readonly role: string
  readonly reason?: string
}

/** 研发经理对一次拆分给出的岗位建议；计划文件缺失时整个字段缺省。 */
export interface RequirementSplitPlanRow {
  readonly at: string
  readonly entries: readonly RequirementSplitPlanEntryRow[]
}

/** 原型质量校验结果的项目。 */
export interface PrototypeQualityIssueRow {
  readonly code: string
  readonly message: string
}

/** 原型质量校验结果。 */
export interface PrototypeQualityRow {
  readonly passed: readonly string[]
  readonly failed: readonly PrototypeQualityIssueRow[]
  readonly keywordHitRate: number
  readonly keywords: readonly string[]
  readonly hits: readonly string[]
  readonly misses: readonly string[]
}

/** 需求原型登记：HTML 本体在 .spec/prototypes/<编号>/index.html。 */
export interface RequirementPrototypeRow {
  readonly path: string
  readonly generatedAt: string
  readonly referenceSummary?: string
  readonly references: readonly string[]
  readonly quality?: PrototypeQualityRow
  readonly adoptedAt?: string
}

/** 需求的一次 S 级轻量修补记录。 */
export interface RequirementAmendmentRow {
  readonly at: string
  readonly summary: string
  readonly files?: readonly string[]
  readonly actor?: string
}

/** 需求行（含正文）。 */
export interface RequirementDocRow {
  readonly id: string
  readonly text: string
  readonly title?: string
  readonly state?: 'draft' | 'confirmed' | 'released' | 'closed' | 'unknown'
  readonly options: readonly RequirementOptionRow[]
  readonly recommendation?: string
  readonly openedAt?: string
  readonly confirmedAt?: string
  readonly releasedAt?: string
  readonly closedAt?: string
  readonly versions: readonly RequirementVersionRow[]
  readonly reviews: readonly RequirementReviewRow[]
  readonly approvedAt?: string
  readonly approvedVersion?: number
  /** 拆分岗位建议；没有计划文件时缺省。 */
  readonly splitPlan?: RequirementSplitPlanRow
  /** HTML 原型登记；旧需求缺省。 */
  readonly prototype?: RequirementPrototypeRow
  /** 累计 S 级轻量修补次数；旧需求缺省。 */
  readonly amendCount?: number
  /** S 级轻量修补历史摘要；旧需求缺省。 */
  readonly amendments?: readonly RequirementAmendmentRow[]
}

/** 规则行。 */
export interface RuleRow {
  readonly id: string
  readonly module: string
  readonly kind: string
  readonly status: string
  readonly text: string
}

/** 契约行。 */
export interface ContractRow {
  readonly id: string
  readonly change: readonly string[]
  readonly notChange: readonly string[]
  readonly acceptance: readonly string[]
  readonly failIf: readonly string[]
  readonly signedBy: 'human' | 'agent' | null
  readonly signedAt: string | null
  readonly signedActor?: string
}

/** 方案行。 */
export interface ProposalRow {
  readonly id: string
  readonly title: string
  readonly problem: string
  readonly options: readonly ProposalOptionRow[]
  readonly recommendation: string
  readonly decision: 'draft' | 'approved' | 'rejected' | 'unknown'
  readonly decidedAt: string | null
  /** 需求变更载荷；缺省表示普通方案探讨。 */
  readonly requirementChange?: RequirementChangeRow
}

/** 提案携带的需求变更：new 登记新需求，revise 按版本改稿，patch 原地修改当前草稿。 */
export interface RequirementChangeRow {
  readonly mode: 'new' | 'revise' | 'patch'
  /** revise / patch 的目标需求编号；new 记录依据时才有。 */
  readonly target?: string
  /** 基线版本号；revise 必填，new 记录依据时与 target 成对。 */
  readonly baseVersion?: number
  /** patch 的基线：提案生成时宿主实际读到的草稿正文；不是旧版本快照。 */
  readonly baseContent?: string
  readonly content: string
  readonly analysis: string
}

/** 方案里的一条候选。 */
export interface ProposalOptionRow {
  readonly name: string
  readonly summary: string
  readonly cost: string
}

/** 联调组。 */
export interface SchedulingGroupRow {
  readonly id: string
  readonly sessionId: string
  readonly members: readonly string[]
  readonly createdAt: string
}

/** 自动化动作名。 */
export const AUTOMATION_ACTIONS = ['draft', 'contract', 'sign', 'implement', 'verify', 'close', 'commit'] as const
/** 一个动作名。 */
export type AutomationActionRow = (typeof AUTOMATION_ACTIONS)[number]
/** 一个动作的执行方式。 */
export type AutomationModeRow = 'auto' | 'manual'

/** 停止条件；null 表示不设限。 */
export interface AutomationLimitsRow {
  readonly tokenBudget: number | null
  readonly maxMinutes: number | null
  readonly maxConsecutiveFailures: number | null
  readonly maxParallel: number | null
}

/** `.spec/automation.yaml` 的展示数据。 */
export interface AutomationPolicyRow {
  readonly actions: Readonly<Record<AutomationActionRow, AutomationModeRow>>
  readonly limits: AutomationLimitsRow
  readonly tasks: readonly string[]
}

/** 两条常驻调度会话。 */
export interface AgentsRow {
  readonly schedulerSession?: string
  readonly flowSession?: string
}

/** 项目环境；敏感值只留引用名。 */
export interface ProjectEnvironmentRow {
  readonly id: string
  readonly label: string
  readonly server?: string
  readonly note?: string
  readonly database?: {
    readonly host: string
    readonly port?: string
    readonly name: string
    readonly user: string
    readonly passwordRef: string
  }
}

/** 项目追加的轨。 */
export interface ProjectTrackRow {
  readonly id: string
  readonly name: string
}

/** `.spec/project.yaml` 的展示数据。 */
export interface ProjectInfoRow {
  readonly kind: 'web' | 'desktop' | 'library'
  readonly repoUrl: string
  readonly branch: string
  readonly docs: { readonly product: string; readonly architecture: string; readonly tests: string }
  readonly environments: readonly ProjectEnvironmentRow[]
  readonly tracks: readonly ProjectTrackRow[]
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function parsed(text: string): Record<string, unknown> | undefined {
  try {
    return recordOf(parseYaml(text))
  } catch {
    return undefined
  }
}

/**
 * 任务 YAML → 行。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示任务；读不懂为 undefined。
 */
export function taskTextToRow(fileName: string, text: string): TaskRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const title = asText(fields.title)
  if (title === undefined) return undefined
  const scope = recordOf(fields.scope)
  const category = asText(fields.category)
  const changeType = asText(fields.change_type)
  const session = asText(fields.session)
  const proposal = asText(fields.proposal)
  const requirement = asText(fields.requirement)
  const role = asText(fields.role)
  const track = asText(fields.track)
  const openedAt = asText(fields.opened_at)
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    title,
    description: asText(fields.description) ?? '',
    ...(category === undefined ? {} : { category }),
    ...(changeType === undefined ? {} : { changeType }),
    attachments: stringArray(fields.attachments),
    state: asText(fields.state) ?? 'unknown',
    grade: asText(fields.grade) ?? '-',
    rules: stringArray(fields.rules),
    evidence: stringArray(fields.evidence_required),
    ...(session === undefined ? {} : { session }),
    ...(proposal === undefined ? {} : { proposal }),
    ...(requirement === undefined ? {} : { requirement }),
    ...(role === undefined ? {} : { role }),
    ...(track === undefined ? {} : { track }),
    dependsOn: stringArray(fields.depends_on),
    paths: stringArray(scope?.allowed_paths),
    irreversible: stringArray(scope?.irreversible),
    ...(openedAt === undefined ? {} : { openedAt }),
  }
}

/**
 * 规则库文本 → 行。
 * @param text - `rules.yaml` 正文。
 * @returns 规则行；解析失败为空表。
 */
export function rulesTextToRows(text: string): RuleRow[] {
  const doc = parsed(text)
  const list = doc?.rules
  if (!Array.isArray(list)) return []
  return list.flatMap((entry: unknown) => {
    const fields = recordOf(entry)
    const id = asText(fields?.id)
    const body = asText(fields?.text)
    if (fields === undefined || id === undefined || body === undefined) return []
    return [{
      id,
      module: asText(fields.module) ?? '',
      kind: asText(fields.kind) ?? 'rule',
      status: asText(fields.status) ?? 'draft',
      text: body,
    }]
  })
}

/**
 * 契约 YAML → 行。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示契约；读不懂为 undefined。
 */
export function contractTextToRow(fileName: string, text: string): ContractRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const change = stringArray(fields.change)
  const acceptance = stringArray(fields.acceptance)
  if (change.length === 0 || acceptance.length === 0) return undefined
  const sig = recordOf(fields.sig)
  const by = sig?.by
  const actor = asText(sig?.actor)
  const signedBy = by === 'human' || by === 'agent' ? by : null
  return {
    id: asText(fields.id) ?? fileName.replace(/\.contract\.yaml$/, ''),
    change,
    notChange: stringArray(fields.not_change),
    acceptance,
    failIf: stringArray(fields.fail_if),
    signedBy,
    signedAt: sig === undefined ? null : (asText(sig.at) ?? null),
    ...(signedBy === 'agent' && actor !== undefined ? { signedActor: actor } : {}),
  }
}

/**
 * 自动化策略文本 → 行。
 * @param text - 文件正文。
 * @returns 可展示策略；读不懂为 undefined。
 */
export function automationTextToRow(text: string): AutomationPolicyRow | undefined {
  const doc = parsed(text)
  if (doc === undefined) return undefined
  const actions = recordOf(doc.actions)
  const limits = recordOf(doc.limits)
  const mode = (name: AutomationActionRow): AutomationModeRow => actions?.[name] === 'auto' ? 'auto' : 'manual'
  return {
    actions: {
      draft: mode('draft'),
      contract: mode('contract'),
      sign: mode('sign'),
      implement: mode('implement'),
      verify: mode('verify'),
      close: mode('close'),
      commit: mode('commit'),
    },
    limits: {
      tokenBudget: positiveInt(limits?.token_budget),
      maxMinutes: positiveInt(limits?.max_minutes),
      maxConsecutiveFailures: nonNegativeInt(limits?.max_consecutive_failures),
      maxParallel: positiveInt(limits?.max_parallel),
    },
    tasks: stringArray(doc.tasks),
  }
}

/**
 * 联调组 YAML → 行。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示联调组；读不懂为 undefined。
 */
export function groupTextToRow(fileName: string, text: string): SchedulingGroupRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const sessionId = asText(fields.session)
  const createdAt = asText(fields.created_at)
  const members = stringArray(fields.members)
  if (sessionId === undefined || createdAt === undefined || members.length === 0) return undefined
  return { id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''), sessionId, members, createdAt }
}

/**
 * 提案里的需求变更载荷 → 行；形状不合（缺 mode/正文/分析，revise 缺目标或基线，patch 缺目标或基线正文，new 依据不成对）时缺省。
 * @param value - YAML 里的 requirement_change 字段。
 * @returns 可展示的变更载荷；读不懂为 undefined。
 */
function requirementChangeOf(value: unknown): RequirementChangeRow | undefined {
  const fields = recordOf(value)
  if (fields === undefined) return undefined
  const mode = fields.mode
  const content = asText(fields.content)
  const analysis = asText(fields.analysis)
  if (mode !== 'new' && mode !== 'revise' && mode !== 'patch') return undefined
  if (content === undefined || analysis === undefined) return undefined
  const target = asText(fields.target)
  const baseVersion = positiveInt(fields.base_version)
  if (mode === 'patch') {
    const baseContent = asText(fields.base_content)
    if (target === undefined || baseContent === undefined) return undefined
    return { mode, target, baseContent, content, analysis }
  }
  if (mode === 'revise') {
    if (target === undefined || baseVersion === null) return undefined
    return { mode, target, baseVersion, content, analysis }
  }
  if ((target === undefined) !== (baseVersion === null)) return undefined
  if (target !== undefined && baseVersion !== null) return { mode, target, baseVersion, content, analysis }
  return { mode, content, analysis }
}

/**
 * 方案 YAML → 行。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示方案；读不懂为 undefined。
 */
export function proposalTextToRow(fileName: string, text: string): ProposalRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const title = asText(fields.title)
  const problem = asText(fields.problem)
  const recommendation = asText(fields.recommendation)
  if (title === undefined || problem === undefined || recommendation === undefined) return undefined
  const options = (Array.isArray(fields.options) ? fields.options : []).flatMap((entry: unknown) => {
    const record = recordOf(entry)
    const name = asText(record?.name)
    if (name === undefined) return []
    return [{ name, summary: asText(record?.summary) ?? '', cost: asText(record?.cost) ?? '' }]
  })
  const decision = asText(fields.decision)
  const requirementChange = requirementChangeOf(fields.requirement_change)
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    title,
    problem,
    options,
    recommendation,
    decision: decision === 'draft' || decision === 'approved' || decision === 'rejected' ? decision : 'unknown',
    decidedAt: asText(fields.decided_at) ?? null,
    ...(requirementChange === undefined ? {} : { requirementChange }),
  }
}

/**
 * 需求 YAML → 行（正文由读取侧补）。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示需求元数据；读不懂为 undefined。
 */
export function requirementTextToRow(fileName: string, text: string): Omit<RequirementDocRow, 'text'> | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const title = asText(fields.title)
  if (title === undefined) return undefined
  const options = (Array.isArray(fields.options) ? fields.options : []).flatMap((entry: unknown) => {
    const record = recordOf(entry)
    const name = asText(record?.name)
    const summary = asText(record?.summary)
    if (name === undefined || summary === undefined) return []
    const cost = asText(record?.cost)
    return [{ name, summary, ...(cost === undefined ? {} : { cost }) }]
  })
  const rawState = asText(fields.state)
  const state = rawState === undefined
    ? 'draft'
    : rawState === 'draft' || rawState === 'confirmed' || rawState === 'released' || rawState === 'closed'
      ? rawState
      : 'unknown'
  const recommendation = asText(fields.recommendation)
  const openedAt = asText(fields.opened_at)
  const confirmedAt = asText(fields.confirmed_at)
  const releasedAt = asText(fields.released_at)
  const closedAt = asText(fields.closed_at)
  const versions = (Array.isArray(fields.versions) ? fields.versions : []).flatMap((entry: unknown) => {
    const record = recordOf(entry)
    const n = record?.n
    const at = asText(record?.at)
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || at === undefined) return []
    const note = asText(record?.note)
    return [{ n, at, ...(note === undefined ? {} : { note }) }]
  })
  const reviews = (Array.isArray(fields.reviews) ? fields.reviews : []).flatMap((entry: unknown) => {
    const record = recordOf(entry)
    const round = record?.round
    const at = asText(record?.at)
    const report = asText(record?.report)
    if (typeof round !== 'number' || !Number.isInteger(round) || round < 1 || at === undefined || report === undefined) return []
    const sessionId = asText(record?.sessionId)
    const role = asText(record?.role)
    const baseContent = asText(record?.base_content)
    const rawDecision = asText(record?.decision)
    const decision: 'pending' | 'accepted' | 'rejected' | undefined =
      rawDecision === 'pending' || rawDecision === 'accepted' || rawDecision === 'rejected'
        ? rawDecision
        : undefined
    const decidedAt = asText(record?.decided_at)
    const decisionNote = asText(record?.decision_note)
    const rawAppliedVersion = record?.applied_version
    const appliedVersion = typeof rawAppliedVersion === 'number'
      && Number.isInteger(rawAppliedVersion)
      && rawAppliedVersion > 0
      ? rawAppliedVersion
      : undefined
    return [{
      round,
      at,
      report,
      ...(baseContent === undefined ? {} : { baseContent }),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(role === undefined ? {} : { role }),
      ...(decision === undefined ? {} : { decision }),
      ...(decidedAt === undefined ? {} : { decidedAt }),
      ...(appliedVersion === undefined ? {} : { appliedVersion }),
      ...(decisionNote === undefined ? {} : { decisionNote }),
    }]
  })
  const approvedAt = asText(fields.approved_at)
  const rawApprovedVersion = fields.approved_version
  const approvedVersion = typeof rawApprovedVersion === 'number'
    && Number.isInteger(rawApprovedVersion)
    && rawApprovedVersion > 0
    ? rawApprovedVersion
    : undefined
  const rawPrototype = recordOf(fields.prototype)
  const prototypePath = rawPrototype === undefined ? undefined : asText(rawPrototype.path)
  const prototypeGeneratedAt = rawPrototype === undefined ? undefined : asText(rawPrototype.generatedAt)
  const prototypeReferenceSummary = rawPrototype === undefined ? undefined : asText(rawPrototype.referenceSummary)
  const prototypeAdoptedAt = rawPrototype === undefined ? undefined : asText(rawPrototype.adoptedAt)
  const rawQuality = recordOf(rawPrototype?.quality)
  const rate = rawQuality?.keywordHitRate
  const quality = rawQuality === undefined || typeof rate !== 'number' || !Number.isFinite(rate)
    ? undefined
    : {
      passed: stringArray(rawQuality.passed),
      failed: (Array.isArray(rawQuality.failed) ? rawQuality.failed : []).flatMap((entry: unknown) => {
        const issue = recordOf(entry)
        const code = asText(issue?.code)
        const message = asText(issue?.message)
        return code === undefined || message === undefined ? [] : [{ code, message }]
      }),
      keywordHitRate: rate,
      keywords: stringArray(rawQuality.keywords),
      hits: stringArray(rawQuality.hits),
      misses: stringArray(rawQuality.misses),
    }
  const prototype = prototypePath === undefined || prototypeGeneratedAt === undefined
    ? undefined
    : {
      path: prototypePath,
      generatedAt: prototypeGeneratedAt,
      ...(prototypeReferenceSummary === undefined ? {} : { referenceSummary: prototypeReferenceSummary }),
      references: stringArray(rawPrototype?.references),
      ...(quality === undefined ? {} : { quality }),
      ...(prototypeAdoptedAt === undefined ? {} : { adoptedAt: prototypeAdoptedAt }),
    }
  const amendCount = nonNegativeInt(fields.amendCount)
  const amendments: RequirementAmendmentRow[] = (Array.isArray(fields.amendments) ? fields.amendments : []).flatMap((entry: unknown) => {
    const record = recordOf(entry)
    const at = asText(record?.at)
    const summary = asText(record?.summary)
    if (at === undefined || summary === undefined) return []
    const files = stringArray(record?.files).filter(item => item !== '')
    const actor = asText(record?.actor)
    return [{
      at,
      summary,
      ...(files.length > 0 ? { files } : {}),
      ...(actor === undefined ? {} : { actor }),
    }]
  })
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    title,
    state,
    options,
    ...(recommendation === undefined ? {} : { recommendation }),
    ...(openedAt === undefined ? {} : { openedAt }),
    ...(confirmedAt === undefined ? {} : { confirmedAt }),
    ...(releasedAt === undefined ? {} : { releasedAt }),
    ...(closedAt === undefined ? {} : { closedAt }),
    versions,
    reviews,
    ...(approvedAt === undefined ? {} : { approvedAt }),
    ...(approvedVersion === undefined ? {} : { approvedVersion }),
    ...(prototype === undefined ? {} : { prototype }),
    ...(amendCount === null ? {} : { amendCount }),
    ...(amendments.length > 0 ? { amendments } : {}),
  }
}

/**
 * 拆分计划 YAML → 行。
 * @param text - `requirements/<编号>/split-plan.yaml` 正文。
 * @returns 生成时刻与逐条建议；读不懂或没有有效条目时为 undefined。
 */
export function splitPlanTextToRow(text: string): RequirementSplitPlanRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const at = asText(fields.at)
  if (at === undefined) return undefined
  const entries = (Array.isArray(fields.tasks) ? fields.tasks : []).flatMap((entry: unknown) => {
    const record = recordOf(entry)
    const task = asText(record?.task)
    const role = asText(record?.role)
    if (task === undefined || role === undefined) return []
    const reason = asText(record?.reason)
    return [{ task, role, ...(reason === undefined ? {} : { reason }) }]
  })
  return entries.length === 0 ? undefined : { at, entries }
}

function repoRelativeDocs(value: unknown): string[] {
  return stringArray(value).filter((doc) => {
    if (/^(?:[A-Za-z]:|[\\/])/.test(doc)) return false
    return !doc.split(/[\\/]/).includes('..')
  })
}

/**
 * 交付索引 YAML → 行。
 * @param fileName - 文件名，缺 task 时兜底。
 * @param text - 文件正文。
 * @returns 可展示交付索引；读不懂为 undefined。
 */
export function deliverableTextToRow(fileName: string, text: string): DeliverableRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const summary = asText(fields.summary)
  if (summary === undefined) return undefined
  const createdAt = asText(fields.created_at)
  const updatedAt = asText(fields.updated_at)
  return {
    task: asText(fields.task) ?? fileName.replace(/\.yaml$/, ''),
    summary,
    docs: repoRelativeDocs(fields.docs),
    commands: stringArray(fields.commands),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

function roleSignalsOf(value: unknown): RoleSignals | undefined {
  const fields = recordOf(value)
  if (fields === undefined) return undefined
  const signals: RoleSignals = {
    strong: stringArray(fields.strong),
    medium: stringArray(fields.medium),
    preferredPaths: stringArray(fields.preferredPaths),
  }
  return signals.strong.length + signals.medium.length + signals.preferredPaths.length === 0 ? undefined : signals
}

/**
 * 岗位名册 YAML → 行。
 * @param text - `roles.yaml` 正文。
 * @returns 岗位行；缺文件时为空表。
 */
export function rolesTextToRows(text: string): JobRoleRow[] {
  const doc = parsed(text)
  const list = Array.isArray(doc?.roles) ? doc.roles : []
  return list.flatMap((entry: unknown) => {
    const fields = recordOf(entry)
    const id = asText(fields?.id)
    const name = asText(fields?.name)
    const inherits = asText(fields?.inherits)
    if (id === undefined || name === undefined || inherits === undefined) return []
    const persona = asText(fields?.persona)
    const signals = roleSignalsOf(fields?.signals)
    return [{
      id,
      name,
      inherits,
      ...(persona === undefined ? {} : { persona }),
      ...(signals === undefined ? {} : { signals }),
    }]
  })
}

/**
 * 判断任意值是内置流程节点类型。
 * @param value - 配置文件里的节点名。
 * @returns 四种内置节点之一为 true。
 */
export function isFlowNodeKind(value: unknown): value is FlowNodeKind {
  return value === 'intake' || value === 'review' || value === 'revise' || value === 'split'
}

/**
 * 流程配置 YAML → 行；形状非法（未知节点、空岗位、重复节点、auto 非布尔）时整份拒读。
 * @param text - `flow.yaml` 正文。
 * @returns 节点配置；读不懂为 undefined，由读取侧记问题。
 */
export function flowTextToRow(text: string): FlowConfigRow | undefined {
  const doc = parsed(text)
  if (doc === undefined || !Array.isArray(doc.nodes)) return undefined
  const nodes: FlowNodeRow[] = []
  const seen = new Set<FlowNodeKind>()
  for (const entry of doc.nodes) {
    const fields = recordOf(entry)
    if (fields === undefined) return undefined
    const kind = fields.node
    if (!isFlowNodeKind(kind) || seen.has(kind)) return undefined
    if (typeof fields.auto !== 'boolean') return undefined
    const roles = fields.roles
    if (!Array.isArray(roles) || roles.length === 0) return undefined
    const ids = roles.filter((item): item is string => typeof item === 'string' && item !== '')
    if (ids.length !== roles.length) return undefined
    seen.add(kind)
    nodes.push({ node: kind, roles: ids, auto: fields.auto })
  }
  return { nodes }
}

/**
 * 项目 YAML → 行。
 * @param text - `project.yaml` 正文。
 * @returns 项目信息；读不懂为 undefined。
 */
export function projectTextToRow(text: string): ProjectInfoRow | undefined {
  const doc = parsed(text)
  if (doc === undefined) return undefined
  const kind = doc.kind === 'web' || doc.kind === 'desktop' || doc.kind === 'library' ? doc.kind : 'library'
  const repo = recordOf(doc.repo)
  const docs = recordOf(doc.docs)
  const tracks: ProjectTrackRow[] = (Array.isArray(doc.tracks) ? doc.tracks : []).flatMap((raw: unknown) => {
    const track = recordOf(raw)
    const id = asText(track?.id)
    const name = asText(track?.name)
    return id === undefined || name === undefined ? [] : [{ id, name }]
  })
  const environments: ProjectEnvironmentRow[] = Object.entries(recordOf(doc.environments) ?? {}).flatMap(([id, raw]) => {
    const env = recordOf(raw)
    if (env === undefined) return []
    const database = recordOf(env.database)
    const port = database?.port
    const server = asText(env.server)
    const note = asText(env.note)
    return [{
      id,
      label: id,
      ...(server === undefined ? {} : { server }),
      ...(note === undefined ? {} : { note }),
      ...(database === undefined
        ? {}
        : {
          database: {
            host: asText(database.host) ?? '',
            ...(typeof port === 'string' ? { port } : typeof port === 'number' ? { port: String(port) } : {}),
            name: asText(database.name) ?? '',
            user: asText(database.user) ?? '',
            passwordRef: asText(database.passwordRef) ?? '',
          },
        }),
    }]
  })
  return {
    kind,
    repoUrl: asText(repo?.url) ?? '',
    branch: asText(repo?.branch) ?? '—',
    docs: {
      product: asText(docs?.product) ?? '',
      architecture: asText(docs?.architecture) ?? '',
      tests: asText(docs?.tests) ?? '',
    },
    environments,
    tracks,
  }
}

/**
 * `local.yaml` → 引用名到本机值；只留在内存。
 * @param text - 文件正文。
 * @returns 敏感值映射；读不懂为空表。
 */
export function localSecretsOf(text: string): Record<string, string> {
  const doc = parsed(text)
  if (doc === undefined) return {}
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(recordOf(doc.secrets) ?? doc)) {
    if (typeof value === 'string') out[name] = value
  }
  return out
}

/**
 * `agents.yaml` → 两条常驻会话。
 * @param text - 文件正文。
 * @returns 会话号；缺字段时对应项缺省。
 */
export function agentsTextToRow(text: string): AgentsRow | undefined {
  const doc = parsed(text)
  if (doc === undefined) return undefined
  const schedulerSession = asText(doc.schedulerSession)
  const flowSession = asText(doc.flowSession)
  return {
    ...(schedulerSession === undefined ? {} : { schedulerSession }),
    ...(flowSession === undefined ? {} : { flowSession }),
  }
}

/**
 * 判断失败是否只是「目标还不存在」。
 * @param error - 远程失败字段。
 * @param path - 目标路径。
 * @returns 缺失时为 true。
 */
export function isMissing(error: { readonly code?: unknown; readonly message?: unknown }, path: string): boolean {
  const code = typeof error.code === 'string' ? error.code : ''
  if (code.includes('not-found') || code.includes('ENOENT')) return true
  const message = typeof error.message === 'string' ? error.message : ''
  return message.includes(path) && (message.includes('ENOENT') || message.includes('does not exist') || message.includes('不存在'))
}
