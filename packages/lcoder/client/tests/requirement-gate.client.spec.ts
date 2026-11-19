// @vitest-environment jsdom
/** T-272：评审与确认的共享门禁口径——多岗会审豁免、未决与改稿判据，与 kernel 保持一致。 */
import { describe, expect, it } from 'vitest'
import {
  canApproveRequirement,
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

  it('未处置但正文已改稿时允许复核', () => {
    expect(canReviewRequirement({ reviews: [R1()], versions: [V1, V2], flow: null, roster: ROSTER })).toEqual({ ok: true })
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

  it('多岗会审只署了一岗时允许继续评；两岗评齐且未决时拦重复评审', () => {
    const oneSigned = [R1(undefined, 'maniu-pm')]
    expect(canReviewRequirement({ reviews: oneSigned, versions: [V1], flow: FLOW_TWO, roster: ROSTER })).toEqual({ ok: true })
    const bothSigned = [R1(undefined, 'maniu-pm'), { ...R1('pending', 'maniu-manager'), round: 2 }]
    const gate = canReviewRequirement({ reviews: bothSigned, versions: [V1], flow: FLOW_TWO, roster: ROSTER })
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.block).toEqual({ reason: 'pending', round: 2 })
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
