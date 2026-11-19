/**
 * 需求评审与确认的共享门禁：纯判定，不读磁盘、不发命令、不依赖 React。
 * 口径与 kernel 的 `reviewStaleReason` 与 `requirement_approve` 一致：
 * 同版本多岗会审未评完时允许继续评，已评完且仍有未决轮次时拦重复评审与定稿。
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

/** 门禁判定的输入：需求的评审、版本、流程配置与岗位名册。 */
export interface RequirementGateParams {
  readonly reviews: readonly RequirementReviewRow[]
  readonly versions: readonly RequirementVersionRow[]
  readonly flow: FlowConfigRow | null | undefined
  readonly roster: readonly JobRoleRow[]
}

/** 发起评审被拦的原因。 */
export interface ReviewBlock {
  /** pending：上一轮未处置且正文未改；repeat：本轮已处置但正文未改稿。 */
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
 * 未决轮次未改稿或已处置但正文未改稿时拦重复评审。复用 `missingReviewRoles` 实现多岗同版本会审豁免。
 * @param params - 评审、版本与流程配置。
 * @returns 可发起时 ok 为 true，否则给出原因。
 */
export function canReviewRequirement(params: RequirementGateParams): ReviewGate {
  const { reviews, versions, flow, roster } = params
  if (reviews.length === 0) return { ok: true }
  if (missingReviewRoles(flow, roster, reviews).length > 0) return { ok: true }
  const latest = reviews.reduce((best, review) => review.round > best.round ? review : best)
  const latestVersion = versions.reduce<RequirementVersionRow | undefined>(
    (best, version) => best === undefined || version.n > best.n ? version : best,
    undefined,
  )
  const changedAfterReview = latestVersion !== undefined && Date.parse(latestVersion.at) > Date.parse(latest.at)
  if (latest.decision === 'rejected') return { ok: true }
  if (latest.decision === 'accepted') {
    return changedAfterReview ? { ok: true } : { ok: false, block: { reason: 'repeat', round: latest.round } }
  }
  return changedAfterReview ? { ok: true } : { ok: false, block: { reason: 'pending', round: latest.round } }
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
