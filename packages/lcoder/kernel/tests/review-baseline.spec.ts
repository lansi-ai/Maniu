/**
 * 评审正文基线的行为测：报告能识别自己依据的正文，草稿修改（patch）原地改正文后
 * 陈旧判定与采纳关联版本都按基线判断；旧评审没有基线时回退版本时间戳。
 *
 * 这里只调 store 与 store 级命令，不启动 Loader；权限与装配证据见 requirement-patch-surface.spec.ts。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createRequirementReviewDecideCommand } from '../src/commands/requirement-review-decide.js'
import {
  createRequirement,
  decideRequirementReview,
  loadRequirement,
  patchRequirementDraft,
  recordRequirementReview,
  requirementPath,
  requirementVersionPath,
  reviewStaleReason,
  saveRequirement,
} from '../src/kernel/requirement-store.js'
import { Requirement } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const B1 = '# 需求\n\n原始正文。'
const B2 = '# 需求\n\n原地修改后的正文。'
const VERSION_AT = '2026-11-17T09:00:00+08:00'
const REVIEW_AT = '2026-11-18T10:00:00+08:00'
const DECIDE_AT = '2026-11-18T12:00:00+08:00'

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-review-baseline-'))
  dirs.push(repo)
  return join(repo, '.spec')
}

function seed(spec: string, body = B1): void {
  createRequirement(spec, { title: '需求', content: body, opened_at: VERSION_AT })
}

function review(spec: string, baseContent = B1): void {
  recordRequirementReview(spec, 'REQ-01', {
    report: 'requirements/REQ-01/reviews/R1.md',
    at: REVIEW_AT,
    baseContent,
  })
}

function requirementOf(baseContent: string | undefined): Requirement {
  return Requirement.parse({
    id: 'REQ-01',
    title: '需求',
    opened_at: VERSION_AT,
    versions: [{ n: 1, at: VERSION_AT }],
    reviews: [{
      round: 1,
      at: REVIEW_AT,
      report: 'requirements/REQ-01/reviews/R1.md',
      ...(baseContent === undefined ? {} : { base_content: baseContent }),
    }],
  })
}

describe('评审正文基线', () => {
  it('评审落盘绑定当时读到的正文；旧评审没有该字段照常解析', () => {
    const spec = makeSpec()
    seed(spec)
    review(spec, B1)
    expect(loadRequirement(spec, 'REQ-01').reviews[0]?.base_content).toBe(B1)
    expect(Requirement.safeParse(
      JSON.parse(JSON.stringify(loadRequirement(spec, 'REQ-01'))),
    ).success).toBe(true)

    // 旧数据无 base_content，解析与陈旧判定回退版本时间戳。
    const legacy = requirementOf(undefined)
    expect(legacy.reviews[0]?.base_content).toBeUndefined()
    expect(reviewStaleReason(legacy, { document: B2 })).toContain('上一轮评审后正文未改稿')
  })

  it('报告后 patch：依据正文已变能识别，复评不被错误拦也不被无声放行', () => {
    const spec = makeSpec()
    seed(spec)
    review(spec, B1)

    // 正文未变 → 待处置评审仍拦重复评审。
    expect(reviewStaleReason(loadRequirement(spec, 'REQ-01'), { document: B1 })).toContain('上一轮评审后正文未改稿')
    patchRequirementDraft(spec, 'REQ-01', B1, B2)
    // 正文已变 → 报告依据不再是当前正文，允许重新评审。
    expect(reviewStaleReason(loadRequirement(spec, 'REQ-01'), { document: B2 })).toBeUndefined()

    // 已采纳但正文未改仍拦；已采纳且被 patch 改过则放行。
    const accepted = requirementOf(B1)
    const acceptedReviews = accepted.reviews.map(entry => ({ ...entry, decision: 'accepted' as const }))
    expect(reviewStaleReason({ versions: accepted.versions, reviews: acceptedReviews }, { document: B1 }))
      .toContain('已采纳但正文未改稿')
    expect(reviewStaleReason({ versions: accepted.versions, reviews: acceptedReviews }, { document: B2 }))
      .toBeUndefined()
  })

  it('三种草稿状态下 patch 后报告仍指向原依据正文，不静默改判', () => {
    const cases = [
      { label: '无评审', decision: undefined },
      { label: '待处置', decision: 'pending' as const },
      { label: '已有结论', decision: 'accepted' as const },
    ]
    for (const item of cases) {
      const spec = makeSpec()
      seed(spec)
      review(spec, B1)
      if (item.decision !== undefined) {
        const current = loadRequirement(spec, 'REQ-01')
        saveRequirement(spec, {
          ...current,
          reviews: current.reviews.map(entry => ({ ...entry, decision: item.decision })),
        })
      }
      patchRequirementDraft(spec, 'REQ-01', B1, B2)
      const after = loadRequirement(spec, 'REQ-01')
      expect(after.reviews[0]?.base_content, item.label).toBe(B1)
      expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8'), item.label).toBe(B2)
      expect(after.versions.map(version => version.n), item.label).toEqual([1])
      if (item.decision !== undefined) {
        expect(after.reviews[0]?.decision, item.label).toBe(item.decision)
      }
    }
  })

  it('反向交错：patch 先成功后报告后落盘，新报告绑定当时实际正文', () => {
    const spec = makeSpec()
    seed(spec)
    review(spec, B1) // R1 基于 B1，仍在飞的第一个报告
    patchRequirementDraft(spec, 'REQ-01', B1, B2)
    // 评审报告落盘时按当时实际读到的正文绑定基线（store 的 baseContent 入参即工具读盘值）。
    recordRequirementReview(spec, 'REQ-01', {
      report: 'requirements/REQ-01/reviews/R2.md',
      at: '2026-11-18T11:00:00+08:00',
      baseContent: B2,
    })
    const reviews = loadRequirement(spec, 'REQ-01').reviews
    expect(reviews[0]?.base_content).toBe(B1)
    expect(reviews[1]?.base_content).toBe(B2)
    // R2 依据的正文就是当前正文：未处置时仍拦重复评审，不会无声放行。
    expect(reviewStaleReason(loadRequirement(spec, 'REQ-01'), { document: B2 }))
      .toContain('上一轮评审后正文未改稿')
  })

  it('patch 后采纳：baselineChanged 为真、不关联错版，命令给出明确回执', () => {
    const spec = makeSpec()
    seed(spec)
    review(spec, B1)
    patchRequirementDraft(spec, 'REQ-01', B1, B2)

    const result = decideRequirementReview(spec, 'REQ-01', { round: 1, decision: 'accepted', at: DECIDE_AT })
    expect(result.baselineChanged).toBe(true)
    expect(result.appliedVersion).toBeUndefined()
    const storedReview = loadRequirement(spec, 'REQ-01').reviews[0]
    expect(storedReview).toMatchObject({ base_content: B1, decision: 'accepted' })
    expect(storedReview?.applied_version).toBeUndefined()

    const outcome = createRequirementReviewDecideCommand(spec, () => DECIDE_AT)
      .handler({ rawInput: 'REQ-01 1 accepted' })
    expect(outcome.kind).toBe('success')
    expect(outcome.text ?? '').toContain('没有对应的新版本可关联')
  })

  it('带基线的采纳只关联快照等于当前正文的版本，不静默指向错位旧版', () => {
    const spec = makeSpec()
    seed(spec)
    review(spec, B1)
    patchRequirementDraft(spec, 'REQ-01', B1, B2)

    // 两个晚于评审的版本：v2 快照与当前正文不符，v3 与当前正文一致。
    writeFileSync(requirementVersionPath(spec, 'REQ-01', 2), '# 错位快照', 'utf8')
    writeFileSync(requirementVersionPath(spec, 'REQ-01', 3), B2, 'utf8')
    saveRequirement(spec, {
      ...loadRequirement(spec, 'REQ-01'),
      versions: [
        { n: 1, at: VERSION_AT },
        { n: 2, at: '2026-11-18T11:00:00+08:00' },
        { n: 3, at: '2026-11-18T11:30:00+08:00' },
      ],
    })

    const result = decideRequirementReview(spec, 'REQ-01', { round: 1, decision: 'accepted', at: DECIDE_AT })
    expect(result.appliedVersion).toBe(3)
  })

  it('旧评审没有基线时采纳关联仍按原时间戳口径，不受正文比对影响', () => {
    const spec = makeSpec()
    seed(spec)
    // 旧式评审：无 base_content。
    recordRequirementReview(spec, 'REQ-01', {
      report: 'requirements/REQ-01/reviews/R1.md',
      at: REVIEW_AT,
    })
    const current = loadRequirement(spec, 'REQ-01')
    saveRequirement(spec, {
      ...current,
      versions: [
        { n: 1, at: VERSION_AT },
        { n: 2, at: '2026-11-18T11:00:00+08:00' },
      ],
    })
    // 即便正文与 v1 不同，旧记录仍只按时间关联 v2。
    writeFileSync(join(spec, 'requirements', 'REQ-01.md'), B2, 'utf8')
    const result = decideRequirementReview(spec, 'REQ-01', { round: 1, decision: 'accepted', at: DECIDE_AT })
    expect(result.baselineChanged).toBeUndefined()
    expect(result.appliedVersion).toBe(2)
    expect(loadRequirement(spec, 'REQ-01').reviews[0]?.base_content).toBeUndefined()
    expect(readFileSync(requirementPath(spec, 'REQ-01'), 'utf8')).not.toContain('base_content')
  })
})
