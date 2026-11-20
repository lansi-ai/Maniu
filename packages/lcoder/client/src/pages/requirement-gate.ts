/**
 * 需求评审与确认的共享门禁：纯判定，不读磁盘、不发命令、不依赖 React。
 * 口径与 kernel 的 `reviewStaleReason` 与 `requirement_approve` 一致：
 * 同版本多岗会审未评完时允许继续评；最新一轮未决时送审即锁定，无条件拦重复评审与原地改稿，
 * 已处置且仍有未决轮次时另拦定稿。
 */

import type { FlowConfigRow, JobRoleRow, RequirementReviewRow, RequirementVersionRow } from '../spec/rows.ts'
import { missingReviewRoles } from '../flow/config.ts'

/** 一轮评审是否已处置；旧数据没有 decision 与显式 pending 都按未决看待。 */
function isPending(review: RequirementReviewRow): boolean {
  return review.decision === undefined || review.decision === 'pending'
}

/**
 * 是否还有未处置的评审轮次；与 kernel `requirement_approve` 的 pending 门禁同口径。
 * @param reviews - 需求的评审轮次。
 * @returns 存在未决轮次时为 true。
 */
export function hasPendingReviews(reviews: readonly RequirementReviewRow[]): boolean {
  return reviews.some(isPending)
}

/** 门禁判定的输入：需求的评审、版本、流程配置、岗位名册与当前正文。 */
export interface RequirementGateParams {
  readonly reviews: readonly RequirementReviewRow[]
  readonly versions: readonly RequirementVersionRow[]
  readonly flow: FlowConfigRow | null | undefined
  readonly roster: readonly JobRoleRow[]
  /** 当前正文全文；评审带基线时用它判断是否已变，旧评审回退版本时间戳。 */
  readonly document?: string
}

/** 发起评审被拦的原因。 */
export interface ReviewBlock {
  /** pending：最新一轮未决（送审即锁定，与正文是否改过无关）；repeat：已处置但正文未改稿。 */
  readonly reason: 'pending' | 'repeat'
  /** 相关评审轮次，供原因文案点名。 */
  readonly round: number
}

/** 发起定稿被拦的原因。 */
export interface ApproveBlock {
  /** noReview：没有评审；pending：有未决轮次；missingRoles：流程岗位未配齐。 */
  readonly reason: 'noReview' | 'pending' | 'missingRoles'
  /** pending 的未决轮次，供原因文案点名。 */
  readonly rounds?: readonly number[]
  /** missingRoles 缺的岗位 id。 */
  readonly roles?: readonly string[]
}

/** 评审发起判定；ok 为 true 时可发起，否则 block 给出原因。 */
export type ReviewGate = { readonly ok: true } | { readonly ok: false; readonly block: ReviewBlock }

/** 定稿发起判定；ok 为 true 时可发起，否则 block 给出原因。 */
export type ApproveGate = { readonly ok: true } | { readonly ok: false; readonly block: ApproveBlock }

/**
 * 评审能否发起：没有评审、多岗会审仍有缺岗、上一轮已放弃或已采纳且正文改过，都允许；
 * 最新一轮未决（缺省或显式 pending）时无条件拦重复评审——送审即锁定，正文即便已变也须先在
 * 报告里处置本轮意见。正文基线只用于已采纳分支判断正文是否已改稿；旧评审回退版本时间戳。
 * 复用 `missingReviewRoles` 实现多岗同正文会审豁免。
 * @param params - 评审、版本与流程配置。
 * @returns 可发起时 ok 为 true，否则给出原因。
 */
export function canReviewRequirement(params: RequirementGateParams): ReviewGate {
  const { reviews, versions, flow, roster, document } = params
  if (reviews.length === 0) return { ok: true }
  if (missingReviewRoles(flow, roster, reviews).length > 0) return { ok: true }
  const latest = reviews.reduce((best, review) => review.round > best.round ? review : best)
  // 送审即锁定：未决轮次无条件阻塞，不看正文是否改过；多岗豁免已在上面放行。
  if (isPending(latest)) return { ok: false, block: { reason: 'pending', round: latest.round } }
  if (latest.decision === 'rejected') return { ok: true }
  const latestVersion = versions.reduce<RequirementVersionRow | undefined>(
    (best, version) => best === undefined || version.n > best.n ? version : best,
    undefined,
  )
  const bodyChanged = latest.baseContent !== undefined && document !== undefined
    ? latest.baseContent !== document
    : undefined
  const changedAfterReview = bodyChanged === undefined
    ? latestVersion !== undefined && Date.parse(latestVersion.at) > Date.parse(latest.at)
    : bodyChanged
  return changedAfterReview ? { ok: true } : { ok: false, block: { reason: 'repeat', round: latest.round } }
}

/** 原地「修改需求」被拦的原因。 */
export type ModifyBlockReason = 'pending' | 'rejected' | 'noNewVersion'

/** 原地修改判定；ok 为 true 时可修改，否则 reason 给出拦截原因，供按钮 isDisabled 与 title 使用。 */
export type ModifyGate = { readonly ok: true } | { readonly ok: false; readonly reason: ModifyBlockReason }

/**
 * 当前版本能否原地「修改需求」：送审即锁定，只有尚未送审或已采纳且派生出未审新版本时才可改。
 * 没有评审时草稿从未送审，可以修改；最新一轮未决或已放弃时当前版本已锁定，不能改；最新一轮已采纳时，
 * 须存在晚于该轮的版本，且该版本尚未发起新一轮评审——新一轮一旦送审即成为最新未决轮次，由上面的
 * 未决分支拦下。多岗会审豁免不适用于原地修改：只要最新轮未决就锁定。
 * @param params - 评审与版本；document 不参与判定，仅为复用 RequirementGateParams。
 * @returns 可修改时 ok 为 true，否则给出原因。
 */
export function canModifyDraft(params: RequirementGateParams): ModifyGate {
  const { reviews, versions } = params
  if (reviews.length === 0) return { ok: true }
  const latest = reviews.reduce((best, review) => review.round > best.round ? review : best)
  if (isPending(latest)) return { ok: false, reason: 'pending' }
  if (latest.decision === 'rejected') return { ok: false, reason: 'rejected' }
  return versions.some(version => version.n > latest.round)
    ? { ok: true }
    : { ok: false, reason: 'noNewVersion' }
}

/**
 * 定稿能否发起：先查有没有评审，再查未决轮次，最后查流程岗位是否配齐；
 * 顺序与 kernel `requirement_approve` 一致，未决轮次优先于缺岗给出原因。
 * @param params - 评审与流程配置，不使用版本快照。
 * @returns 可发起时 ok 为 true，否则给出原因。
 */
export function canApproveRequirement(params: Omit<RequirementGateParams, 'versions'>): ApproveGate {
  const { reviews, flow, roster } = params
  if (reviews.length === 0) return { ok: false, block: { reason: 'noReview' } }
  const pending = reviews.filter(isPending).map(review => review.round).sort((left, right) => left - right)
  if (pending.length > 0) return { ok: false, block: { reason: 'pending', rounds: pending } }
  const missing = missingReviewRoles(flow, roster, reviews)
  if (missing.length > 0) return { ok: false, block: { reason: 'missingRoles', roles: missing } }
  return { ok: true }
}
