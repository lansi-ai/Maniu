/**
 * 三补偿闸与评审证据识别的行为测。
 *
 * 闸的顺序固定，失败清单要稳定——回执与 P3 的说明都按它拼句子。
 */
import { describe, expect, it } from 'vitest'

import { hasReviewEvidence } from '../src/kernel/evidence-store.js'
import { describeSelfSignFailure, evaluateSelfSignGate } from '../src/kernel/sign-gate.js'

describe('evaluateSelfSignGate', () => {
  it('三闸同时成立才放行', () => {
    expect(evaluateSelfSignGate({ signAuto: true, irreversible: [], reviewEvidence: true }))
      .toEqual({ allowed: true, failed: [] })
  })

  it('逐道失败按 policy、irreversible、review 的顺序报出', () => {
    expect(evaluateSelfSignGate({ signAuto: false, irreversible: ['api'], reviewEvidence: false }))
      .toEqual({ allowed: false, failed: ['policy', 'irreversible', 'review'] })
    expect(evaluateSelfSignGate({ signAuto: true, irreversible: ['api'], reviewEvidence: true }).failed)
      .toEqual(['irreversible'])
    expect(evaluateSelfSignGate({ signAuto: true, irreversible: [], reviewEvidence: false }).failed)
      .toEqual(['review'])
  })
})

describe('describeSelfSignFailure', () => {
  it('把未通过的闸翻成一句人话', () => {
    const text = describeSelfSignFailure({
      allowed: false,
      failed: ['policy', 'irreversible', 'review'],
    })
    expect(text).toContain('auto')
    expect(text).toContain('不可逆项')
    expect(text).toContain('review')
  })

  it('全部通过时给空串', () => {
    expect(describeSelfSignFailure({ allowed: true, failed: [] })).toBe('')
  })
})

describe('hasReviewEvidence', () => {
  it('review 开头的非空证据才算复核', () => {
    expect(hasReviewEvidence({ review: 12 })).toBe(true)
    expect(hasReviewEvidence({ 'review-round-2': 3 })).toBe(true)
    expect(hasReviewEvidence({ review_1: 1 })).toBe(true)
  })

  it('空文件、其它证据名都不算', () => {
    expect(hasReviewEvidence({ review: 0 })).toBe(false)
    expect(hasReviewEvidence({ build: 100, test: 200 })).toBe(false)
    expect(hasReviewEvidence({ reviewer: 10 })).toBe(false)
    expect(hasReviewEvidence({})).toBe(false)
  })
})
