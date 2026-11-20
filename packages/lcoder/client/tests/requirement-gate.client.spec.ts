// @vitest-environment jsdom
/** T-272：评审、确认与原地改稿的共享门禁口径——多岗会审豁免、送审即锁定，与 kernel 保持一致。 */
import { describe, expect, it } from 'vitest'
import {
  canApproveRequirement,
  canModifyDraft,
  canReviewRequirement,
  hasPendingReviews,
} from '../src/pages/requirement-gate.ts'
import type { FlowConfigRow, JobRoleRow, RequirementReviewRow, RequirementVersionRow } from '../src/spec/rows.ts'

const V1: RequirementVersionRow = { n: 1, at: '2026-11-17T09:00:00+08:00' }
const V2: RequirementVersionRow = { n: 2, at: '2026-11-17T12:00:00+08:00' }
const R1 = (decision?: 'pending' | 'accepted' | 'rejected', role?: string, at = '2026-11-17T10:00:00+08:00'): RequirementReviewRow => ({
  round: 1,
  at,
  report: 'requirements/REQ-01/reviews/R1.md',
  ...(decision === undefined ? {} : { decision }),
  ...(role === undefined ? {} : { role }),
})
const FLOW_TWO: FlowConfigRow = {
  nodes: [{ node: 'review', roles: ['maniu-pm', 'maniu-manager'], auto: true }],
}
const ROSTER: readonly JobRoleRow[] = []

describe('hasPendingReviews', () => {
  it('缺省与显式 pending 都是未决；accepted 与 rejected 已处置', () => {
    expect(hasPendingReviews([])).toBe(false)
    expect(hasPendingReviews([R1()])).toBe(true)
    expect(hasPendingReviews([R1('pending')])).toBe(true)
    expect(hasPendingReviews([R1('accepted')])).toBe(false)
    expect(hasPendingReviews([R1('rejected')])).toBe(false)
  })
})

describe('canReviewRequirement', () => {
  it('没有评审时允许发起', () => {
    expect(canReviewRequirement({ reviews: [], versions: [], flow: null, roster: ROSTER })).toEqual({ ok: true })
  })

  it('最新一轮未处置且正文未改稿时拦重复评审', () => {
    const gate = canReviewRequirement({ reviews: [R1()], versions: [V1], flow: null, roster: ROSTER })
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.block).toEqual({ reason: 'pending', round: 1 })
  })

  it('未决轮次即便正文已改稿仍无条件阻塞：送审即锁定，须先处置本轮意见', () => {
    const gate = canReviewRequirement({ reviews: [R1()], versions: [V1, V2], flow: null, roster: ROSTER })
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.block).toEqual({ reason: 'pending', round: 1 })
    // 显式 pending 与缺省同义。
    const explicit = canReviewRequirement({ reviews: [R1('pending')], versions: [V1, V2], flow: null, roster: ROSTER })
    expect(explicit.ok).toBe(false)
    if (!explicit.ok) expect(explicit.block).toEqual({ reason: 'pending', round: 1 })
  })

  it('已采纳但正文未改稿时拦重复评审，已改稿时允许', () => {
    const blocked = canReviewRequirement({ reviews: [R1('accepted')], versions: [V1], flow: null, roster: ROSTER })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.block).toEqual({ reason: 'repeat', round: 1 })
    expect(canReviewRequirement({ reviews: [R1('accepted')], versions: [V1, V2], flow: null, roster: ROSTER })).toEqual({ ok: true })
  })

  it('上一轮已放弃时允许重新评审', () => {
    expect(canReviewRequirement({ reviews: [R1('rejected')], versions: [V1], flow: null, roster: ROSTER })).toEqual({ ok: true })
  })

  it('带基线时按报告依据正文与当前正文比对，patch 原地改正文也能识别', () => {
    const based = (decision?: 'pending' | 'accepted'): RequirementReviewRow => ({
      ...R1(decision), baseContent: '# 原正文',
    })
    expect(canReviewRequirement({
      reviews: [based()], versions: [V1], flow: null, roster: ROSTER, document: '# 原正文',
    })).toMatchObject({ ok: false, block: { reason: 'pending' } })
    // 未决评审即便基线正文已变，也须先处置本轮意见，不能据此放行新一轮。
    expect(canReviewRequirement({
      reviews: [based()], versions: [V1], flow: null, roster: ROSTER, document: '# 改后的正文',
    })).toMatchObject({ ok: false, block: { reason: 'pending' } })
    expect(canReviewRequirement({
      reviews: [based('accepted')], versions: [V1], flow: null, roster: ROSTER, document: '# 改后的正文',
    })).toEqual({ ok: true })
    expect(canReviewRequirement({
      reviews: [based('accepted')], versions: [V1], flow: null, roster: ROSTER, document: '# 原正文',
    })).toMatchObject({ ok: false, block: { reason: 'repeat' } })
  })

  it('旧评审没有基线时回退版本时间戳口径，但未决轮次仍无条件阻塞', () => {
    expect(canReviewRequirement({
      reviews: [R1()], versions: [V1], flow: null, roster: ROSTER, document: '# 与版本表无关的新正文',
    })).toMatchObject({ ok: false, block: { reason: 'pending' } })
    expect(canReviewRequirement({
      reviews: [R1()], versions: [V1, V2], flow: null, roster: ROSTER, document: '# 与版本表无关的新正文',
    })).toMatchObject({ ok: false, block: { reason: 'pending' } })
    // 已采纳分支仍按版本时间戳判断正文是否改过。
    expect(canReviewRequirement({
      reviews: [R1('accepted')], versions: [V1, V2], flow: null, roster: ROSTER, document: '# 与版本表无关的新正文',
    })).toEqual({ ok: true })
  })

  it('多岗会审只署了一岗时允许继续评；两岗评齐且未决时拦重复评审', () => {
    const oneSigned = [R1(undefined, 'maniu-pm')]
    expect(canReviewRequirement({ reviews: oneSigned, versions: [V1], flow: FLOW_TWO, roster: ROSTER })).toEqual({ ok: true })
    const bothSigned = [R1(undefined, 'maniu-pm'), { ...R1('pending', 'maniu-manager'), round: 2 }]
    const gate = canReviewRequirement({ reviews: bothSigned, versions: [V1], flow: FLOW_TWO, roster: ROSTER })
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.block).toEqual({ reason: 'pending', round: 2 })
  })
})

describe('canModifyDraft', () => {
  const params = (
    reviews: readonly RequirementReviewRow[],
    versions: readonly RequirementVersionRow[],
  ) => ({ reviews, versions, flow: null, roster: ROSTER })

  it('无评审时草稿从未送审，可以修改', () => {
    expect(canModifyDraft(params([], [V1]))).toEqual({ ok: true })
  })

  it('最新一轮未决时送审即锁定，不可修改', () => {
    expect(canModifyDraft(params([R1()], [V1]))).toEqual({ ok: false, reason: 'pending' })
    expect(canModifyDraft(params([R1('pending')], [V1, V2]))).toEqual({ ok: false, reason: 'pending' })
  })

  it('已采纳且产出晚于该轮的新版本、未再送审时可修改', () => {
    expect(canModifyDraft(params([R1('accepted')], [V1, V2]))).toEqual({ ok: true })
  })

  it('已采纳但没有新版本，或新版本已发起新一轮评审时不可修改', () => {
    expect(canModifyDraft(params([R1('accepted')], [V1]))).toEqual({ ok: false, reason: 'noNewVersion' })
    // 新一轮已送审 → 最新轮未决，回到 pending 锁定。
    expect(canModifyDraft(params(
      [R1('accepted'), { ...R1('pending'), round: 2 }],
      [V1, V2],
    ))).toEqual({ ok: false, reason: 'pending' })
  })

  it('已放弃本轮意见时不可修改，须重新发起评审', () => {
    expect(canModifyDraft(params([R1('rejected')], [V1]))).toEqual({ ok: false, reason: 'rejected' })
  })
})

describe('canApproveRequirement', () => {
  const params = (reviews: readonly RequirementReviewRow[], flow: FlowConfigRow | null = null) => ({ reviews, flow, roster: ROSTER })

  it('没有评审时拦定稿并给出 noReview', () => {
    const gate = canApproveRequirement(params([]))
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.block.reason).toBe('noReview')
  })

  it('有未决轮次时优先拦定稿并点名轮次', () => {
    const gate = canApproveRequirement(params([R1(), { ...R1('accepted'), round: 2 }]))
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.block.reason).toBe('pending')
      expect(gate.block.rounds).toEqual([1])
    }
  })

  it('评审配齐且无未决轮次时允许定稿', () => {
    const reviews = [R1('accepted', 'maniu-pm'), { ...R1('accepted', 'maniu-manager'), round: 2 }]
    expect(canApproveRequirement(params(reviews, FLOW_TWO))).toEqual({ ok: true })
  })

  it('缺评审岗位时拦定稿并点名缺岗', () => {
    const gate = canApproveRequirement(params([R1('accepted', 'maniu-pm')], FLOW_TWO))
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.block.reason).toBe('missingRoles')
      expect(gate.block.roles).toEqual(['maniu-manager'])
    }
  })
})
