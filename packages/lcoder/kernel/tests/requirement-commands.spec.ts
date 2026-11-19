/**
 * 三条需求人机命令的行为测：状态流转的每条边与它的前置条件。
 *
 * 与 `proposal_approve`、`contract_sign` 同档：模型拿不到这三条命令，
 * 所以这里只测命令面本身；工具面的缺席由 `surface.spec.ts` 钉住。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createRequirementApproveCommand } from '../src/commands/requirement-approve.js'
import { createRequirementCloseCommand } from '../src/commands/requirement-close.js'
import { createRequirementReleaseCommand } from '../src/commands/requirement-release.js'
import { createRequirementReviewDecideCommand } from '../src/commands/requirement-review-decide.js'
import { loadRequirement, requirementVersionPath, reviewStaleReason, saveRequirement } from '../src/kernel/requirement-store.js'
import { saveTask } from '../src/kernel/task-store.js'
import { Requirement } from '../src/schema/spec.js'
import type { RequirementState, TaskState } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-requirement-cmd-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'requirements'), { recursive: true })
  mkdirSync(join(root, 'tasks'), { recursive: true })
  return root
}

function writeRequirement(root: string, state: RequirementState = 'draft', withDocument = true): Requirement {
  const requirement = Requirement.parse({
    id: 'REQ-01',
    title: '支持自营与代发两种佣金',
    state,
    options: [{ name: '加参数', summary: '增加可选第三参数' }],
    opened_at: '2026-11-13T09:00:00+08:00',
  })
  saveRequirement(root, requirement)
  if (withDocument) writeFileSync(join(root, 'requirements', 'REQ-01.md'), '# 佣金改造\n', 'utf8')
  return requirement
}

function addReview(root: string, round = 1): void {
  const requirement = loadRequirement(root, 'REQ-01')
  const relative = `requirements/REQ-01/reviews/R${String(round)}.md`
  mkdirSync(join(root, 'requirements', 'REQ-01', 'reviews'), { recursive: true })
  writeFileSync(join(root, relative), '# 评审报告\n', 'utf8')
  saveRequirement(root, {
    ...requirement,
    reviews: [...requirement.reviews, { round, at: AT, report: relative }],
  })
}

function writeTask(root: string, id: string, state: TaskState, requirement = 'REQ-01'): void {
  saveTask(root, {
    id,
    title: `任务 ${id}`,
    description: '',
    attachments: [],
    grade: 'B',
    state,
    rules: [],
    requirement,
    depends_on: [],
    scope: { irreversible: [], allowed_paths: [] },
    evidence_required: [],
    opened_at: '2026-11-13T10:00:00+08:00',
    closed_at: null,
  })
}

const AT = '2026-11-13T12:00:00+08:00'
const approve = (root: string, raw: string) => createRequirementApproveCommand(root, () => AT).handler({ rawInput: raw })
const release = (root: string, raw: string) => createRequirementReleaseCommand(root, () => AT).handler({ rawInput: raw })
const close = (root: string, raw: string) => createRequirementCloseCommand(root, () => AT).handler({ rawInput: raw })
const decide = (root: string, raw: string) => createRequirementReviewDecideCommand(root, () => AT).handler({ rawInput: raw })

describe('需求确认命令', () => {
  it('起草态、有正文且有一轮评审：写状态、确认时刻与批准版本，旧需求补 v1', () => {
    const root = makeSpec()
    const before = writeRequirement(root)
    addReview(root)

    const result = approve(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result.kind === 'success' ? result.text : '').toContain('批准版本 v1')
    const after = loadRequirement(root, 'REQ-01')
    expect(after.state).toBe('confirmed')
    expect(after.confirmed_at).toBe(AT)
    expect(after.approved_at).toBe(AT)
    expect(after.approved_version).toBe(1)
    expect(after.versions).toEqual([{ n: 1, at: AT }])
    expect(readFileSync(requirementVersionPath(root, 'REQ-01', 1), 'utf8')).toBe('# 佣金改造\n')
    expect({ ...after, state: 'draft', confirmed_at: undefined, approved_at: undefined, approved_version: undefined, versions: [], reviews: [] }).toEqual(before)
  })

  it('至少一轮评审才允许过审，没有评审时拒绝且状态不动', () => {
    const root = makeSpec()
    writeRequirement(root)

    const result = approve(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('还没有评审记录')
    expect(loadRequirement(root, 'REQ-01').state).toBe('draft')
  })

  it('已有版本时批准版本指向当前正文；正文与最新快照不一致时追加一版', () => {
    const root = makeSpec()
    writeRequirement(root)
    mkdirSync(join(root, 'requirements', 'REQ-01', 'versions'), { recursive: true })
    writeFileSync(requirementVersionPath(root, 'REQ-01', 1), '# 旧正文\n', 'utf8')
    saveRequirement(root, {
      ...loadRequirement(root, 'REQ-01'),
      versions: [{ n: 1, at: '2026-11-13T10:00:00+08:00' }],
    })
    addReview(root)
    writeFileSync(join(root, 'requirements', 'REQ-01.md'), '# 新正文\n', 'utf8')

    const result = approve(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'success' })
    const after = loadRequirement(root, 'REQ-01')
    expect(after.approved_version).toBe(2)
    expect(after.versions.map(version => version.n)).toEqual([1, 2])
    expect(readFileSync(requirementVersionPath(root, 'REQ-01', 2), 'utf8')).toBe('# 新正文\n')
  })

  it('正文不存在时拒绝确认', () => {
    const root = makeSpec()
    writeRequirement(root, 'draft', false)

    const result = approve(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('还没有正文')
    expect(loadRequirement(root, 'REQ-01').state).toBe('draft')
  })

  it('非起草态拒绝重复确认', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')

    const result = approve(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('只有起草态')
  })

  it('编号缺失或不存在都报人话', () => {
    const root = makeSpec()
    expect(approve(root, '')).toMatchObject({ kind: 'error' })
    expect(approve(root, 'REQ-09')).toMatchObject({ kind: 'error' })
    expect(approve(root, 'P-01')).toMatchObject({ kind: 'error' })
  })
})

describe('需求发布命令', () => {
  it('已确认且关联任务全部收口：标为已上线并写发布时刻', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')
    writeTask(root, 'T-01', 'closed')
    writeTask(root, 'T-02', 'closed')

    const result = release(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'success' })
    const after = loadRequirement(root, 'REQ-01')
    expect(after.state).toBe('released')
    expect(after.released_at).toBe(AT)
  })

  it('没有关联任务时拒绝，并提示先拆任务', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')

    const result = release(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('还没有关联任务')
    expect(loadRequirement(root, 'REQ-01').state).toBe('confirmed')
  })

  it('还有未关闭任务时拒绝，并列出任务编号与状态', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')
    writeTask(root, 'T-01', 'closed')
    writeTask(root, 'T-02', 'implementing')
    writeTask(root, 'T-03', 'verifying')

    const result = release(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    const text = result.kind === 'error' ? result.text : ''
    expect(text).toContain('T-02（implementing）')
    expect(text).toContain('T-03（verifying）')
    expect(text).not.toContain('T-01')
  })

  it('未确认的需求不能发布', () => {
    const root = makeSpec()
    writeRequirement(root, 'draft')
    writeTask(root, 'T-01', 'closed')

    const result = release(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('只有已确认')
  })
})

describe('需求关闭命令', () => {
  it('起草态可以直接关闭，写关闭时刻', () => {
    const root = makeSpec()
    writeRequirement(root, 'draft')

    const result = close(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'success' })
    expect(loadRequirement(root, 'REQ-01')).toMatchObject({ state: 'closed', closed_at: AT })
  })

  it('已确认的需求可以关闭', () => {
    const root = makeSpec()
    writeRequirement(root, 'confirmed')

    expect(close(root, 'REQ-01')).toMatchObject({ kind: 'success' })
    expect(loadRequirement(root, 'REQ-01').state).toBe('closed')
  })

  it('已关闭的需求不再重复关闭', () => {
    const root = makeSpec()
    writeRequirement(root, 'closed')

    const result = close(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('不需要重复关闭')
  })

  it('已上线是终态，拒绝关闭', () => {
    const root = makeSpec()
    writeRequirement(root, 'released')

    const result = close(root, 'REQ-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('终态')
    expect(loadRequirement(root, 'REQ-01').state).toBe('released')
  })

  it('编号形态不对直接报错，不碰文件', () => {
    const root = makeSpec()
    writeRequirement(root, 'draft')

    const result = close(root, 'REQ-1')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' ? result.text : '').toContain('非法的需求编号')
  })
})

describe('需求评审处置命令', () => {
  it('放弃本轮意见后正文不改也能复评，备注照写', () => {
    const root = makeSpec()
    writeRequirement(root)
    addReview(root)

    const result = decide(root, 'REQ-01 1 rejected 边界另议')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result.kind === 'success' ? result.text : '').toContain('放弃')
    const review = loadRequirement(root, 'REQ-01').reviews[0]
    expect(review).toMatchObject({
      round: 1, decision: 'rejected', decided_at: AT, decision_note: '边界另议',
    })
    expect(review?.applied_version).toBeUndefined()
    expect(reviewStaleReason(loadRequirement(root, 'REQ-01'))).toBeUndefined()
  })

  it('采纳时关联晚于该轮的正文版本，写进 applied_version', () => {
    const root = makeSpec()
    writeRequirement(root)
    addReview(root)
    saveRequirement(root, {
      ...loadRequirement(root, 'REQ-01'),
      versions: [
        { n: 1, at: '2026-11-13T10:00:00+08:00' },
        { n: 2, at: '2026-11-13T13:00:00+08:00' },
      ],
    })

    const result = decide(root, 'REQ-01 1 accepted')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result.kind === 'success' ? result.text : '').toContain('关联正文 v2')
    const review = loadRequirement(root, 'REQ-01').reviews[0]
    expect(review).toMatchObject({ decision: 'accepted', decided_at: AT, applied_version: 2 })
    expect(reviewStaleReason(loadRequirement(root, 'REQ-01'))).toBeUndefined()
  })

  it('采纳但没有新版本时不写 applied_version，复评仍被拦', () => {
    const root = makeSpec()
    writeRequirement(root)
    addReview(root)

    expect(decide(root, 'REQ-01 1 accepted')).toMatchObject({ kind: 'success' })
    const requirement = loadRequirement(root, 'REQ-01')
    expect(requirement.reviews[0]?.applied_version).toBeUndefined()
    expect(reviewStaleReason(requirement)).toContain('已采纳但正文未改稿')
  })

  it('需求不存在、非起草态、轮次不存在都报错且不改文件', () => {
    const root = makeSpec()
    writeRequirement(root)
    addReview(root)

    expect(decide(root, 'REQ-09 1 rejected')).toMatchObject({ kind: 'error' })
    expect(decide(root, 'REQ-01 2 rejected')).toMatchObject({ kind: 'error' })
    expect(decide(root, 'REQ-01 1 rejected')).toMatchObject({ kind: 'success' })
    expect(loadRequirement(root, 'REQ-01').reviews[0]?.decision).toBe('rejected')

    saveRequirement(root, { ...loadRequirement(root, 'REQ-01'), state: 'confirmed' })
    expect(decide(root, 'REQ-01 1 accepted')).toMatchObject({ kind: 'error' })
    expect(resultText(decide(root, 'REQ-01 1 accepted'))).toContain('只有起草态')
  })

  it('参数缺失或取值非法都报人话', () => {
    const root = makeSpec()
    writeRequirement(root)
    addReview(root)

    expect(resultText(decide(root, ''))).toContain('需要需求编号')
    expect(resultText(decide(root, 'REQ-01 1'))).toContain('需要需求编号')
    expect(resultText(decide(root, 'REQ-1 1 accepted'))).toContain('非法的需求编号')
    expect(resultText(decide(root, 'REQ-01 x accepted'))).toContain('正整数')
    expect(resultText(decide(root, 'REQ-01 0 accepted'))).toContain('正整数')
    expect(resultText(decide(root, 'REQ-01 1 maybe'))).toContain('accepted 或 rejected')
    expect(loadRequirement(root, 'REQ-01').reviews[0]?.decision).toBeUndefined()
  })
})

function resultText(result: { readonly kind: string; readonly text?: string }): string {
  return result.text ?? ''
}
