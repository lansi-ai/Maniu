/**
 * 岗位分配建议的本地纯函数：只排序候选、给可解释理由，不写盘、不调外部模型、不进调度判定。
 *
 * 理由是稳定 code 加数据参数，不拼句子：界面按 code 查 locales 渲染，中英文共用同一份排序结果。
 *
 * 三条边界：
 *   1. **能力先于语义。** 需要写盘的任务只保留天花板带 `file_edit` 的角色；只读复核与
 *      设计任务才允许只读角色。天花板由调用方注入，本文件不抄 `surface.ts`。
 *   2. **无命中显式兜底。** 没有任何名册岗位命中时返回内置 `dev`、置信度 0 与
 *      `needs_human`，不返回空列表，也不猜一个名册岗位。
 *   3. **建议不是事实。** 输出不写 `Task.role`、不调用 `/task_assign`，分配仍由人执行。
 *
 * 打分权重是本地规则：强特征 3、弱语义 1、命中标题再加 2、落点偏好 4；
 * 历史保留只给已有信号命中的岗位加少量分。置信度是候选分占比，没有校准概率语义。
 */
import { isBuiltinRole } from '@maniu/kernel/src/schema/roles.ts'
import type { BuiltinRoleId } from '@maniu/kernel/src/schema/roles.ts'
import type { RoleSignals } from '@maniu/kernel/src/schema/spec.ts'

/** 本地规则阈值：置信度不低于 0.6 且与第二名分差不小于 1 才给建议。 */
export const LOCAL_ROLE_POLICY = { accept: 0.6, margin: 1 } as const

/** 需要写盘的任务类型；允许路径非空时同样按写盘任务处理。 */
const WRITE_TASK_TYPES: readonly string[] = ['开发', '缺陷', '变更', '文档', '流程']

const STRONG_WEIGHT = 3
const MEDIUM_WEIGHT = 1
const TITLE_BONUS = 2
const PREFERRED_PATH_WEIGHT = 4
const HISTORY_KEPT_BONUS = 1
const HISTORY_BONUS_CAP = 2

const POLICY = { accept: LOCAL_ROLE_POLICY.accept, margin: LOCAL_ROLE_POLICY.margin, source: 'default' } as const
const OFFLINE = { mode: 'local_rules' } as const

/** 参与建议的任务事实；`state` 与 `dependsOn` 只随请求传入，本函数不据此判定。 */
export interface SuggestTask {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly type: string
  readonly state: string
  readonly dependsOn: readonly string[]
  readonly allowedPaths: readonly string[]
}

/** 可选契约摘要；`irreversible` 非空时决定恒为 `needs_human`。 */
export interface SuggestContract {
  readonly summary: string
  readonly irreversible: readonly string[]
  readonly acceptance: readonly string[]
}

/** 名册里的一个岗位；`inherits` 运行时可能写坏，解析失败时进入否决候选。 */
export interface SuggestRosterJob {
  readonly id: string
  readonly name: string
  readonly inherits: string
  readonly persona?: string
  readonly signals?: RoleSignals
}

/** 一条历史分配事实；只有 `kept` 参与加分，`taskId` 与当前任务相同的条目忽略。 */
export interface SuggestHistoryEntry {
  readonly taskId: string
  readonly roleId: string
  readonly verdict: 'kept' | 'changed'
}

/**
 * 一条命中理由：稳定 code 加数据参数，界面按 code 查 locales。
 *
 * `field` 区分命中的是标题还是描述/契约/允许路径拼成的文案；`delta` 是这次命中的加分。
 */
export type RoleReason =
  | { readonly code: 'strong_signal'; readonly term: string; readonly field: 'title' | 'body'; readonly delta: number }
  | { readonly code: 'medium_signal'; readonly term: string; readonly field: 'title' | 'body'; readonly delta: number }
  | { readonly code: 'preferred_path'; readonly preferred: string; readonly matched: string; readonly delta: number }
  | { readonly code: 'history_kept'; readonly count: number; readonly bonus: number }
  | { readonly code: 'fallback_no_match' }

/** 岗位被排除的原因：同样是稳定 code 加参数，文案由界面按 locales 渲染。 */
export type RoleDisqualification =
  | { readonly code: 'inherits_unknown'; readonly inherits: string }
  | { readonly code: 'write_requires_file_edit'; readonly inherits: string }

/** 内置角色到工具名的天花板表；由调用方从角色表注入，本函数不自带。 */
export type RoleCeiling = Readonly<Record<BuiltinRoleId, readonly string[]>>

/** 一次建议请求。 */
export interface SuggestRoleRequest {
  readonly task: SuggestTask
  readonly contract?: SuggestContract
  readonly roster: { readonly jobs: readonly SuggestRosterJob[] }
  readonly ceiling: RoleCeiling
  readonly history?: readonly SuggestHistoryEntry[]
  /**
   * 调用方对「任务是否要写盘」的判定；缺省时按任务类型与允许路径推断。
   * 产品任务没有类型字段，界面侧无法证明只读，因此传 `true`（保守口径）。
   */
  readonly writeRequired?: boolean
}

/** 一个候选岗位；`disqualified` 有值时该候选不参与排序与推荐。 */
export interface RoleSuggestionCandidate {
  readonly roleId: string
  readonly score: number
  /** 候选分占所有有分候选总分的比例；未命中与否决项为 0。 */
  readonly confidence: number
  /** 命中的信号：稳定 code 加参数，文案由界面按 locales 渲染。 */
  readonly reasons: readonly RoleReason[]
  /** 被否决的原因：能力不足、继承角色未知等。 */
  readonly disqualified?: RoleDisqualification
}

/** 决策：`suggest` 表示本地规则过阈值，`needs_human` 表示必须由人挑。 */
export type RoleSuggestionDecision = 'suggest' | 'needs_human'

/** 人下一步该做什么：采用建议、自己挑岗位，或先不分配。 */
export type RoleSuggestionHumanAction = 'assign_via_task_assign' | 'pick_role' | 'leave_unassigned'

/** 本地规则阈值及其来源；本函数只有默认策略，项目覆盖留给调用方以后注入。 */
export interface RoleSuggestionPolicy {
  readonly accept: number
  readonly margin: number
  readonly source: 'project' | 'default'
}

/** 一次建议的完整输出。 */
export interface RoleSuggestion {
  readonly candidates: readonly RoleSuggestionCandidate[]
  readonly decision: RoleSuggestionDecision
  /** 只有 `suggest` 时给出；`needs_human` 不替人做选择。 */
  readonly recommended?: { readonly roleId: string; readonly confidence: number; readonly margin: number }
  readonly policy: RoleSuggestionPolicy
  readonly humanAction: RoleSuggestionHumanAction
  /** 本地规则固定为 `local_rules`；外部模型未接入，因此没有降级字段。 */
  readonly offline: { readonly mode: 'local_rules'; readonly degradedFrom?: 'remote_model'; readonly reason?: string }
}

/** 路径归一：反斜杠转正斜杠并去掉末尾斜杠。 */
function normalizePath(value: string): string {
  return value.split('\\').join('/').replace(/\/+$/u, '')
}

/** 两条路径是否重叠；按前缀比较，任一侧为空视为不重叠。 */
function pathsOverlap(left: string, right: string): boolean {
  const l = normalizePath(left)
  const r = normalizePath(right)
  return l !== '' && r !== '' && (l === r || l.startsWith(`${r}/`) || r.startsWith(`${l}/`))
}

/** 置信度保留两位小数，避免浮点尾数进入界面与断言。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 任务是否需要写盘：类型属写盘类型，或声明了允许路径；调用方可显式覆盖。 */
function needsWrite(task: SuggestTask): boolean {
  return WRITE_TASK_TYPES.includes(task.type) || task.allowedPaths.length > 0
}

/** 打分所需的文本与路径；只读一次，避免每个候选重复拼接。 */
interface ScoringContext {
  readonly task: SuggestTask
  readonly title: string
  readonly body: string
  readonly history: readonly SuggestHistoryEntry[]
}

/**
 * 给一个岗位打分并写理由。
 * @param job - 名册岗位。
 * @param context - 任务文本与历史事实。
 * @returns 分数与命中的信号理由。
 */
function scoreJob(job: SuggestRosterJob, context: ScoringContext): { score: number; reasons: RoleReason[] } {
  const reasons: RoleReason[] = []
  let score = 0
  const counted = new Set<string>()

  for (const raw of job.signals?.strong ?? []) {
    const term = raw.trim()
    const key = term.toLowerCase()
    if (key === '') continue
    counted.add(key)
    const inTitle = context.title.includes(key)
    if (!inTitle && !context.body.includes(key)) continue
    const delta = STRONG_WEIGHT + (inTitle ? TITLE_BONUS : 0)
    score += delta
    reasons.push({ code: 'strong_signal', term, field: inTitle ? 'title' : 'body', delta })
  }

  for (const raw of job.signals?.medium ?? []) {
    const term = raw.trim()
    const key = term.toLowerCase()
    if (key === '' || counted.has(key)) continue
    counted.add(key)
    const inTitle = context.title.includes(key)
    if (!inTitle && !context.body.includes(key)) continue
    const delta = MEDIUM_WEIGHT + (inTitle ? TITLE_BONUS : 0)
    score += delta
    reasons.push({ code: 'medium_signal', term, field: inTitle ? 'title' : 'body', delta })
  }

  const seenPaths = new Set<string>()
  for (const raw of job.signals?.preferredPaths ?? []) {
    const preferred = normalizePath(raw.trim())
    if (preferred === '' || seenPaths.has(preferred)) continue
    seenPaths.add(preferred)
    const matched = context.task.allowedPaths.find(path => pathsOverlap(path, preferred))
    if (matched === undefined) continue
    score += PREFERRED_PATH_WEIGHT
    reasons.push({ code: 'preferred_path', preferred: raw.trim(), matched, delta: PREFERRED_PATH_WEIGHT })
  }

  // 历史只在当前任务已有信号时作小幅加权；它不能凭空把无关岗位变成候选。
  if (score > 0) {
    const kept = context.history.filter(entry =>
      entry.roleId === job.id && entry.verdict === 'kept' && entry.taskId !== context.task.id).length
    const bonus = Math.min(kept * HISTORY_KEPT_BONUS, HISTORY_BONUS_CAP)
    if (bonus > 0) {
      score += bonus
      reasons.push({ code: 'history_kept', count: kept, bonus })
    }
  }

  return { score, reasons }
}

/** 候选排序：分数降序，同分按岗位 id 升序，保证同一输入顺序固定。 */
function compareCandidates(left: RoleSuggestionCandidate, right: RoleSuggestionCandidate): number {
  if (left.score !== right.score) return right.score - left.score
  return left.roleId < right.roleId ? -1 : left.roleId > right.roleId ? 1 : 0
}

/**
 * 按任务事实与名册给一份岗位建议。
 * @param request - 任务事实、可选契约、名册、由调用方注入的能力天花板与可选历史。
 * @returns 候选排序、决策、阈值、人工动作与固定为本地规则的离线标记。
 */
export function suggestRole(request: SuggestRoleRequest): RoleSuggestion {
  const task = request.task
  const context: ScoringContext = {
    task,
    title: task.title.toLowerCase(),
    body: [task.description, request.contract?.summary ?? '', ...task.allowedPaths].join('\n').toLowerCase(),
    history: request.history ?? [],
  }
  const writeRequired = request.writeRequired ?? needsWrite(task)
  const candidates: RoleSuggestionCandidate[] = []

  for (const job of request.roster.jobs) {
    if (!isBuiltinRole(job.inherits)) {
      candidates.push({
        roleId: job.id,
        score: 0,
        confidence: 0,
        reasons: [],
        disqualified: { code: 'inherits_unknown', inherits: job.inherits },
      })
      continue
    }
    const tools = request.ceiling[job.inherits]
    if (writeRequired && !tools.includes('file_edit')) {
      candidates.push({
        roleId: job.id,
        score: 0,
        confidence: 0,
        reasons: [],
        disqualified: { code: 'write_requires_file_edit', inherits: job.inherits },
      })
      continue
    }
    const scored = scoreJob(job, context)
    candidates.push({ roleId: job.id, score: scored.score, confidence: 0, reasons: scored.reasons })
  }

  const positive = candidates.filter(candidate => candidate.disqualified === undefined && candidate.score > 0)
  const total = positive.reduce((sum, candidate) => sum + candidate.score, 0)

  if (positive.length === 0) {
    const fallback: RoleSuggestionCandidate = {
      roleId: 'dev',
      score: 0,
      confidence: 0,
      reasons: [{ code: 'fallback_no_match' }],
    }
    return {
      candidates: [fallback, ...candidates],
      decision: 'needs_human',
      policy: POLICY,
      humanAction: 'leave_unassigned',
      offline: OFFLINE,
    }
  }

  const ranked = positive
    .map(candidate => ({ ...candidate, confidence: round2(candidate.score / total) }))
    .sort(compareCandidates)
  const rest = candidates.filter(candidate => !positive.includes(candidate))
  const top = ranked[0]
  if (top === undefined) {
    // positive 非空时不可能走到这里；保留兜底是为了不把空推荐当成建议。
    return {
      candidates,
      decision: 'needs_human',
      policy: POLICY,
      humanAction: 'pick_role',
      offline: OFFLINE,
    }
  }
  const margin = top.score - (ranked[1]?.score ?? 0)
  const irreversible = (request.contract?.irreversible.length ?? 0) > 0
  const accepted = !irreversible
    && top.confidence >= LOCAL_ROLE_POLICY.accept
    && margin >= LOCAL_ROLE_POLICY.margin

  return {
    candidates: [...ranked, ...rest],
    decision: accepted ? 'suggest' : 'needs_human',
    ...(accepted
      ? { recommended: { roleId: top.roleId, confidence: top.confidence, margin } }
      : {}),
    policy: POLICY,
    humanAction: accepted ? 'assign_via_task_assign' : 'pick_role',
    offline: OFFLINE,
  }
}
