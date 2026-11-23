/** 四维 S / M / L 变更分流纯函数：基于 `.spec` 上下文与一句话诉求判定变更通道与文档影响，零硬编码 UI 文案。 */

import type { MessageKey } from '../locale.ts'
import { canModifyDraft } from '../pages/requirement-gate.ts'
import type { ProjectTrackRow, RequirementDocRow, TaskRow } from '../spec/rows.ts'

/** 变更分流等级：草稿原地修改或 S / M / L 三级演进通道。 */
export type ChangeTriageLevel = 'draft' | 'S' | 'M' | 'L'

/** 分流后对应的下游执行动作标识。 */
export type ChangeTriageActionKind = 'draft_patch' | 'amend' | 'delta' | 'milestone'

/** 文档与任务影响预览（全部为可定位双语词典键）。 */
export interface ChangeDocImpact {
  /** 会自动改写或新建的文档与任务说明键列表。 */
  readonly willUpdate: readonly MessageKey[]
  /** 保持封存或不被打断的文档与任务说明键列表。 */
  readonly willKeep: readonly MessageKey[]
}

/** 四维变更分流输入。 */
export interface ChangeTriageInput {
  /** 用户输入的一句话变更诉求。 */
  readonly description: string
  /** 选中的目标需求；为空表示不绑定既有需求（独立新立项）。 */
  readonly target?:
    | (Pick<RequirementDocRow, 'id' | 'state' | 'title'> & Partial<Pick<RequirementDocRow, 'reviews' | 'versions'>>)
    | null
    | undefined
  /** `.spec/project.yaml` 声明的自定义交付轨。 */
  readonly tracks?: readonly ProjectTrackRow[] | undefined
  /** `.spec/project.yaml` 声明的项目形态。 */
  readonly projectKind?: 'web' | 'desktop' | 'library' | undefined
  /** 当前投影中的任务列表，用于识别已启用的交付轨。 */
  readonly tasks?: readonly Pick<TaskRow, 'track'>[] | undefined
}

/** 结构化分流建议卡结果。 */
export interface ChangeTriageResult {
  readonly level: ChangeTriageLevel
  readonly actionKind: ChangeTriageActionKind
  readonly reasons: readonly MessageKey[]
  readonly docImpact: ChangeDocImpact
}

/** 手动改选某个执行等级时的准入判定结果。 */
export interface TriageLevelEligibility {
  readonly allowed: boolean
  readonly reasonKey?: MessageKey
}

const ACTION_BY_LEVEL: Readonly<Record<ChangeTriageLevel, ChangeTriageActionKind>> = {
  draft: 'draft_patch',
  S: 'amend',
  M: 'delta',
  L: 'milestone',
}

const DOC_IMPACT_BY_LEVEL: Readonly<Record<ChangeTriageLevel, ChangeDocImpact>> = {
  draft: {
    willUpdate: ['triage.impact.draft.updateBody'],
    willKeep: ['triage.impact.draft.keepOthers'],
  },
  S: {
    willUpdate: ['triage.impact.s.updateBody', 'triage.impact.s.updateTask'],
    willKeep: ['triage.impact.s.keepState', 'triage.impact.s.keepReviews'],
  },
  M: {
    willUpdate: ['triage.impact.m.updateProposal', 'triage.impact.m.updateTasks'],
    willKeep: ['triage.impact.m.keepOldTasks', 'triage.impact.m.keepOldSnapshot'],
  },
  L: {
    willUpdate: ['triage.impact.l.updateNewReq', 'triage.impact.l.updateTracks'],
    willKeep: ['triage.impact.l.keepCurrentWork'],
  },
}

const DESKTOP_TRACK_RE = /(?:桌面版|桌面端|windows\s*版|mac\s*版|macos\s*版|electron|desktop\s*(?:app|client|version))/i
const MOBILE_TRACK_RE = /(?:移动端|手机端|ios\s*端|android\s*端|小程序|mobile\s*app|app\s*端)/i
const EXPLICIT_NEW_TRACK_RE = /(?:新端|跨端|多端|新交付轨|新轨|新平台|跨平台)/i
const ARCHITECTURE_L_RE = new RegExp(
  [
    '外部数据库', '独立数据库', '第三方支付', '接入支付', '微信支付', '支付宝', 'stripe',
    '云端同步', '多账号', '团队协作', '多租户', '架构级', '大模块', '独立子系统', '微服务', '插件体系',
    'architecture', 'multi-tenant', 'cloud\\s*sync', 'payment\\s*gateway', 'external\\s*database',
  ].join('|'),
  'i',
)
const IRREVERSIBLE_M_RE = /(?:不可逆|删表|删除字段|破坏性|清空数据|数据迁移|表结构|migration|irreversible|breaking)/i
const CORE_RULE_OR_SCHEMA_M_RE = new RegExp(
  [
    '计费', '费率', '佣金', '结算', '退款', '冲减', '定价', '预算', '超支', '统计口径',
    '核心规则', '业务规则', '权限', '鉴权', '角色', '认证', '登录', '状态机', '审批流',
    'schema', '数据结构', '数据库', '持久化', '功能扩充', '增量修订', '新增页面', '统计图表',
    '超过\\s*3\\s*个?文件', '[4-9]\\s*个?文件', '\\d{2,}\\s*个?文件',
    'billing', 'pricing', 'commission', 'refund', 'settlement', 'permission', 'rbac',
    'auth', 'state\\s*machine', 'business\\s*rule', 'dashboard', 'chart', 'feature\\s*delta',
  ].join('|'),
  'i',
)

/**
 * 根据分流等级返回对应的执行动作标识。
 * @param level - 分流等级。
 * @returns 动作标识。
 */
export function actionKindForLevel(level: ChangeTriageLevel): ChangeTriageActionKind {
  return ACTION_BY_LEVEL[level]
}

/**
 * 根据分流等级返回「哪些文档会自动改、哪些不动」的词典键清单。
 * @param level - 分流等级。
 * @returns 文档与任务影响预览。
 */
export function docImpactForLevel(level: ChangeTriageLevel): ChangeDocImpact {
  return DOC_IMPACT_BY_LEVEL[level]
}

/** 判断草稿目标是否因送审而处于锁定态；复用 `canModifyDraft` 口径。 */
function isDraftTargetLocked(
  target: (Pick<RequirementDocRow, 'state'> & Partial<Pick<RequirementDocRow, 'reviews' | 'versions'>>) | null | undefined,
): boolean {
  if (target === null || target === undefined || target.state !== 'draft') return false
  const reviews = target.reviews ?? []
  if (reviews.length === 0) return false
  return !canModifyDraft({
    reviews,
    versions: target.versions ?? [],
    flow: null,
    roster: [],
  }).ok
}

/**
 * 判断手动选择某等级是否允许执行（例如 S 级仅支持 `confirmed` 目标需求，送审锁定的草稿禁止原地改稿）。
 * @param level - 拟选择的等级。
 * @param target - 当前选中的目标需求。
 * @returns 允许状态及不可选时的词典原因键。
 */
export function isTriageLevelAllowed(
  level: ChangeTriageLevel,
  target: (Pick<RequirementDocRow, 'state'> & Partial<Pick<RequirementDocRow, 'reviews' | 'versions'>>) | null | undefined,
): TriageLevelEligibility {
  if (level === 'S') {
    if (target === null || target === undefined || target.state !== 'confirmed') {
      return { allowed: false, reasonKey: 'triage.sDisabledReason' }
    }
    return { allowed: true }
  }
  if (level === 'M') {
    if (target === null || target === undefined || target.state === 'draft') {
      return { allowed: false, reasonKey: 'triage.mDisabledReason' }
    }
    return { allowed: true }
  }
  if (level === 'draft') {
    if (target === null || target === undefined || target.state !== 'draft') {
      return { allowed: false, reasonKey: 'triage.reason.draftTarget' }
    }
    if (isDraftTargetLocked(target)) {
      return { allowed: false, reasonKey: 'triage.draftLockedReason' }
    }
    return { allowed: true }
  }
  return { allowed: true }
}

/** 收集当前 `.spec` 中已激活的交付轨标识集合。 */
function enabledTracksOf(input: ChangeTriageInput): Set<string> {
  const enabled = new Set<string>()
  if (input.projectKind === 'desktop') enabled.add('desktop')
  if (input.projectKind === 'web') {
    enabled.add('h5')
    enabled.add('admin')
    enabled.add('api')
  }
  for (const track of input.tracks ?? []) {
    enabled.add(track.id.toLowerCase())
  }
  for (const task of input.tasks ?? []) {
    if (task.track !== undefined && task.track !== '') {
      enabled.add(task.track.toLowerCase())
    }
  }
  return enabled
}

/**
 * 按四维客观标尺对一条变更诉求进行确定性 S / M / L 分流。
 *
 * 判定顺序：
 * 1. 生命周期维度：目标需求为 `draft` 直接走草稿修改通道；
 * 2. 技术轨与架构维度：引入未启用新端/新轨或架构级大模块判为 `L`，未选目标需求也判 `L`；
 * 3. 验收契约与不可逆维度：涉及核心规则/计费/权限/schema/不可逆改动或目标已上线/关闭判为 `M`；
 * 4. 影响范围维度：已确认需求上的局部微调判为 `S`。
 * @param input - 当前 `.spec` 上下文、目标需求与一句话诉求。
 * @returns 结构化分级建议、可定位词典原因键、文档影响说明与动作标识。
 */
export function triageRequirementChange(input: ChangeTriageInput): ChangeTriageResult {
  const target = input.target ?? null
  if (target !== null && target.state === 'draft') {
    return {
      level: 'draft',
      actionKind: ACTION_BY_LEVEL.draft,
      reasons: [isDraftTargetLocked(target) ? 'triage.reason.draftLocked' : 'triage.reason.draftTarget'],
      docImpact: DOC_IMPACT_BY_LEVEL.draft,
    }
  }

  const text = input.description.trim()
  const enabledTracks = enabledTracksOf(input)
  const lReasons: MessageKey[] = []

  const hitsNewDesktop = DESKTOP_TRACK_RE.test(text) && !enabledTracks.has('desktop')
  const hitsNewMobile = MOBILE_TRACK_RE.test(text) && !enabledTracks.has('mobile') && !enabledTracks.has('ios') && !enabledTracks.has('android')
  if (hitsNewDesktop || hitsNewMobile || EXPLICIT_NEW_TRACK_RE.test(text)) {
    lReasons.push('triage.reason.newTrack')
  }
  if (ARCHITECTURE_L_RE.test(text)) {
    lReasons.push('triage.reason.architectureScope')
  }
  if (target === null) {
    if (lReasons.length === 0) lReasons.push('triage.reason.noTarget')
    return {
      level: 'L',
      actionKind: ACTION_BY_LEVEL.L,
      reasons: lReasons,
      docImpact: DOC_IMPACT_BY_LEVEL.L,
    }
  }
  if (lReasons.length > 0) {
    return {
      level: 'L',
      actionKind: ACTION_BY_LEVEL.L,
      reasons: lReasons,
      docImpact: DOC_IMPACT_BY_LEVEL.L,
    }
  }

  const mReasons: MessageKey[] = []
  if (IRREVERSIBLE_M_RE.test(text)) {
    mReasons.push('triage.reason.irreversibleRisk')
  }
  if (CORE_RULE_OR_SCHEMA_M_RE.test(text)) {
    mReasons.push('triage.reason.coreRuleOrSchema')
  }
  if (target.state === 'released' || target.state === 'closed') {
    mReasons.push('triage.reason.sealedTarget')
  }
  if (mReasons.length > 0) {
    return {
      level: 'M',
      actionKind: ACTION_BY_LEVEL.M,
      reasons: mReasons,
      docImpact: DOC_IMPACT_BY_LEVEL.M,
    }
  }

  return {
    level: 'S',
    actionKind: ACTION_BY_LEVEL.S,
    reasons: ['triage.reason.localScope'],
    docImpact: DOC_IMPACT_BY_LEVEL.S,
  }
}
