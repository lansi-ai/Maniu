/**
 * 需求工具 `requirement_draft` 的行为测：正文与元数据一起落盘，编号只增不覆盖。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { flowConfigPath } from '../src/kernel/flow-config.js'
import {
  createRequirement,
  decideRequirementReview,
  requirementReviewPath,
  requirementVersionPath,
  reviewStaleReason,
  reviseRequirement,
  saveRequirement,
} from '../src/kernel/requirement-store.js'
import { Requirement } from '../src/schema/spec.js'
import { createRequirementTools } from '../src/tools/requirement-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeRepo(): { repo: string; spec: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-requirement-'))
  dirs.push(repo)
  return { repo, spec: join(repo, '.spec') }
}

function callTool(spec: string, name: string, args: Record<string, unknown>, exec: unknown = {}): Promise<Record<string, unknown>> {
  const tool = createRequirementTools(spec).find(entry => entry.name === name)
  if (tool === undefined) throw new Error(`没有 ${name}`)
  const execute = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return execute(args, exec) as Promise<Record<string, unknown>>
}

function call(spec: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return callTool(spec, 'requirement_draft', args)
}

function read(spec: string, id: string): Requirement {
  return Requirement.parse(parseYaml(readFileSync(join(spec, 'requirements', `${id}.yaml`), 'utf8')))
}

/** 写一份 review 节点按给定岗位配齐的 flow.yaml。 */
function writeReviewFlow(spec: string, roles: readonly string[] = ['maniu-pm', 'maniu-manager']): void {
  mkdirSync(spec, { recursive: true })
  writeFileSync(flowConfigPath(spec), stringifyYaml({
    nodes: [{ node: 'review', roles: [...roles], auto: true }],
  }), 'utf8')
}

/** 带 preset 署名的工具调用上下文。 */
const asRole = (role: string) => ({ agent: { session: { header: { agentPreset: role } } } })

const CONTENT = '# 佣金改造\n\n自营订单不该按下限兜底，代发订单保持现状。'

describe('需求工具', () => {
  it('提供起草、评审、改稿、需求变更提案与拆分岗位建议五个工具，不含过审与分配能力', () => {
    const names = createRequirementTools(makeRepo().spec).map(entry => entry.name)
    expect(names).toEqual(['requirement_draft', 'requirement_review_draft', 'requirement_revise', 'requirement_propose', 'requirement_split_plan'])
    expect(names).not.toContain('requirement_approve')
    expect(names).not.toContain('requirement_review_decide')
    expect(names).not.toContain('task_assign')
    expect(names).not.toContain('proposal_approve')
    expect(names).not.toContain('proposal_reject')
  })

  it('首次落盘取 REQ-01：正文与 YAML 都写下，并留下 v1 快照', async () => {
    const { spec } = makeRepo()

    const result = await call(spec, { title: '支持自营与代发两种佣金', content: CONTENT })
    expect(result).toMatchObject({
      requirement_id: 'REQ-01',
      state: 'draft',
      characters: CONTENT.trim().length,
      version: 1,
    })
    expect(String(result.path)).toBe(join(spec, 'requirements', 'REQ-01.yaml'))
    expect(String(result.document_path)).toBe(join(spec, 'requirements', 'REQ-01.md'))
    expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)
    expect(readFileSync(requirementVersionPath(spec, 'REQ-01', 1), 'utf8')).toBe(CONTENT)

    const requirement = read(spec, 'REQ-01')
    expect(requirement).toMatchObject({
      id: 'REQ-01',
      title: '支持自营与代发两种佣金',
      state: 'draft',
      options: [],
    })
    expect(requirement.versions).toHaveLength(1)
    expect(requirement.versions[0]?.n).toBe(1)
    expect(requirement.reviews).toEqual([])
    expect(requirement.recommendation).toBeUndefined()
    expect(requirement.confirmed_at).toBeUndefined()
  })

  it('候选按位置保留，代价留空即省略；推荐照写', async () => {
    const { spec } = makeRepo()

    await call(spec, {
      title: '佣金改造',
      content: CONTENT,
      options: [
        { name: '加参数', summary: '增加可选第三参数', cost: '调用点要传参' },
        { name: '拆函数', summary: '自营与代发各一个函数', cost: '   ' },
      ],
      recommendation: '推荐加参数：改动面小。',
    })

    const requirement = read(spec, 'REQ-01')
    expect(requirement.options).toEqual([
      { name: '加参数', summary: '增加可选第三参数', cost: '调用点要传参' },
      { name: '拆函数', summary: '自营与代发各一个函数' },
    ])
    expect(requirement.recommendation).toBe('推荐加参数：改动面小。')
  })

  it('标题或正文空白就拒，一个文件都不写', async () => {
    const { spec } = makeRepo()

    await expect(call(spec, { title: '   ', content: CONTENT })).rejects.toThrow(/非空的 title/)
    await expect(call(spec, { title: '佣金改造', content: '  \n\t ' })).rejects.toThrow(/非空的 content/)
    await expect(call(spec, { title: '佣金改造', content: CONTENT, options: [{ name: '', summary: '做法' }] }))
      .rejects.toThrow(/第 1 条候选缺字段/)

    expect(() => readdirSync(join(spec, 'requirements'))).toThrow()
  })

  it('编号只增不覆盖：已有 REQ-01 时下一条取 REQ-02', async () => {
    const { spec } = makeRepo()
    saveRequirement(spec, Requirement.parse({
      id: 'REQ-01',
      title: '占位需求',
      opened_at: '2026-11-13T09:00:00+08:00',
    }))

    const first = await call(spec, { title: '另一条需求', content: CONTENT })
    expect(first).toMatchObject({ requirement_id: 'REQ-02', state: 'draft' })

    const second = await call(spec, { title: '第三条需求', content: CONTENT })
    expect(second).toMatchObject({ requirement_id: 'REQ-03' })
    expect(read(spec, 'REQ-01').title).toBe('占位需求')
  })

  it('连续两次起草各占一号', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '第一条', content: CONTENT })
    await call(spec, { title: '第二条', content: CONTENT })

    expect(readdirSync(join(spec, 'requirements')).sort()).toEqual([
      'REQ-01', 'REQ-01.md', 'REQ-01.yaml', 'REQ-02', 'REQ-02.md', 'REQ-02.yaml',
    ])
  })

  it('requirements 目录缺失时自动建', async () => {
    const { spec } = makeRepo()
    mkdirSync(spec, { recursive: true })

    const result = await call(spec, { title: '新需求', content: CONTENT })
    expect(result).toMatchObject({ requirement_id: 'REQ-01' })
  })
})

describe('需求评审', () => {
  it('每轮追加一条记录与一份报告，正文与状态不变', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })

    const first = await callTool(spec, 'requirement_review_draft', {
      id: 'REQ-01',
      report: '# 第 1 轮评审\n\n缺口：没写代发订单的边界。',
    })
    expect(first).toMatchObject({ requirement_id: 'REQ-01', round: 1, report_path: 'requirements/REQ-01/reviews/R1.md' })
    expect(readFileSync(requirementReviewPath(spec, 'REQ-01', 1), 'utf8')).toContain('缺口')

    reviseRequirement(spec, 'REQ-01', { content: '# 佣金改造\n\n已补齐代发边界。', at: '2099-01-01T00:00:00Z' })
    const second = await callTool(spec, 'requirement_review_draft', {
      id: 'REQ-01',
      report: '# 第 2 轮评审\n\n补充后再看。',
    })
    expect(second).toMatchObject({ round: 2 })

    const requirement = read(spec, 'REQ-01')
    expect(requirement.state).toBe('draft')
    expect(requirement.reviews.map(review => review.round)).toEqual([1, 2])
    expect(requirement.reviews[1]?.report).toBe('requirements/REQ-01/reviews/R2.md')
    expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')).toBe('# 佣金改造\n\n已补齐代发边界。')
  })

  it('评审落盘记产出会话的 preset 署名；没有会话事实时不写 role', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })

    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 署名评审' }, {
      agent: { session: { header: { id: 'session-review-1', agentPreset: 'maniu-pm' } } },
    })
    reviseRequirement(spec, 'REQ-01', { content: '# 佣金改造\n\n已改稿。', at: '2099-01-01T00:00:00Z' })
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 无会话来源' })

    const requirement = read(spec, 'REQ-01')
    expect(requirement.reviews[0]).toMatchObject({ round: 1, sessionId: 'session-review-1', role: 'maniu-pm' })
    expect(requirement.reviews[1]?.role).toBeUndefined()
    expect(requirement.reviews[1]?.sessionId).toBeUndefined()
  })

  it('非起草态、没有正文或空报告都拒绝，一个文件都不写', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })
    saveRequirement(spec, { ...read(spec, 'REQ-01'), state: 'confirmed' })
    await expect(callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 评审' }))
      .rejects.toThrow(/只有起草态/)
    expect(existsSync(requirementReviewPath(spec, 'REQ-01', 1))).toBe(false)

    saveRequirement(spec, { ...read(spec, 'REQ-01'), state: 'draft' })
    rmSync(join(spec, 'requirements', 'REQ-01.md'))
    await expect(callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 评审' }))
      .rejects.toThrow(/还没有正文/)
    writeFileSync(join(spec, 'requirements', 'REQ-01.md'), CONTENT, 'utf8')
    await expect(callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '  ' }))
      .rejects.toThrow(/非空的 report/)
    expect(read(spec, 'REQ-01').reviews).toEqual([])
  })
})

describe('评审轮次门禁', () => {
  const VERSION_AT = '2026-11-17T10:00:00+08:00'
  const REVIEW_AT = '2026-11-17T11:00:00+08:00'

  function requirementOf(
    versions: readonly { n: number; at: string }[],
    reviews: readonly { round: number; at: string; decision?: 'pending' | 'accepted' | 'rejected' }[],
  ) {
    return {
      versions: versions.map(version => ({ ...version })),
      reviews: reviews.map(review => ({
        ...review,
        report: `requirements/REQ-01/reviews/R${String(review.round)}.md`,
      })),
    }
  }

  it('没有评审时放行首轮', () => {
    expect(reviewStaleReason(requirementOf([{ n: 1, at: VERSION_AT }], []))).toBeUndefined()
  })

  it('未决评审且正文没改过时拦截，保留旧口径字样', () => {
    const reason = reviewStaleReason(requirementOf([{ n: 1, at: VERSION_AT }], [{ round: 1, at: REVIEW_AT }]))
    expect(reason).toContain('R1')
    expect(reason).toContain('上一轮评审后正文未改稿')
    // 显式的 pending 与缺省同义
    expect(reviewStaleReason(requirementOf(
      [{ n: 1, at: VERSION_AT }],
      [{ round: 1, at: REVIEW_AT, decision: 'pending' }],
    ))).toContain('上一轮评审后正文未改稿')
    // 旧数据没有版本表可比，同样要求先处置
    expect(reviewStaleReason(requirementOf([], [{ round: 1, at: REVIEW_AT }]))).toContain('上一轮评审后正文未改稿')
  })

  it('未决但正文已改稿时按原语义放行，按 n 与 round 取而不是按数组顺序', () => {
    const fresh = requirementOf([{ n: 2, at: '2026-11-17T12:00:00+08:00' }], [{ round: 1, at: REVIEW_AT }])
    expect(reviewStaleReason(fresh)).toBeUndefined()
    // 最新版本（按 n 取）不晚于最新评审（按 round 取）就拦截
    const stale = requirementOf(
      [{ n: 2, at: VERSION_AT }, { n: 1, at: '2026-11-17T12:00:00+08:00' }],
      [{ round: 2, at: REVIEW_AT }, { round: 1, at: '2026-11-17T09:00:00+08:00' }],
    )
    expect(reviewStaleReason(stale)).toContain('上一轮评审后正文未改稿')
  })

  it('放弃本轮意见后允许复评，不再看正文有没有改', () => {
    expect(reviewStaleReason(requirementOf(
      [{ n: 1, at: VERSION_AT }],
      [{ round: 1, at: REVIEW_AT, decision: 'rejected' }],
    ))).toBeUndefined()
  })

  it('采纳且已有晚于该轮的正文版本时允许复评，采纳但没改稿仍拦截', () => {
    expect(reviewStaleReason(requirementOf(
      [{ n: 2, at: '2026-11-17T12:00:00+08:00' }],
      [{ round: 1, at: REVIEW_AT, decision: 'accepted' }],
    ))).toBeUndefined()
    expect(reviewStaleReason(requirementOf(
      [{ n: 1, at: VERSION_AT }],
      [{ round: 1, at: REVIEW_AT, decision: 'accepted' }],
    ))).toContain('已采纳但正文未改稿')
  })

  it('传 options 时按多岗 flow 放行缺口岗位，单参数与缺 role 仍走严格判定', () => {
    const { spec } = makeRepo()
    writeReviewFlow(spec)
    const requirement = {
      versions: [{ n: 1, at: VERSION_AT }],
      reviews: [{ round: 1, at: REVIEW_AT, report: 'requirements/REQ-01/reviews/R1.md', role: 'maniu-pm' }],
    }

    // manager 还没署名：缺口岗位放行，已评过的 pm 与未传 role 的单参数调用仍拦截。
    expect(reviewStaleReason(requirement, { root: spec, role: 'maniu-manager' })).toBeUndefined()
    expect(reviewStaleReason(requirement, { root: spec, role: 'maniu-pm' })).toContain('上一轮评审后正文未改稿')
    expect(reviewStaleReason(requirement, { root: spec })).toContain('上一轮评审后正文未改稿')
    expect(reviewStaleReason(requirement)).toContain('上一轮评审后正文未改稿')

    // flow.yaml 读不懂时降级为严格判定，未决评审不会因配置错误被放行。
    writeFileSync(flowConfigPath(spec), 'nodes: [', 'utf8')
    expect(reviewStaleReason(requirement, { root: spec, role: 'maniu-manager' })).toContain('上一轮评审后正文未改稿')
  })

  it('没有文件流程配置时即便传了 preset 署名仍走严格判定', () => {
    const { spec } = makeRepo()
    const requirement = {
      versions: [{ n: 1, at: VERSION_AT }],
      reviews: [{ round: 1, at: REVIEW_AT, report: 'requirements/REQ-01/reviews/R1.md' }],
    }
    expect(reviewStaleReason(requirement, { root: spec, role: 'maniu-pm' })).toContain('上一轮评审后正文未改稿')
  })

  it('工具在上一轮评审后没有新版本时拒绝追加，不留报告文件', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 第 1 轮' })

    await expect(callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 重复评审' }))
      .rejects.toThrow(/上一轮评审后正文未改稿/)
    expect(existsSync(requirementReviewPath(spec, 'REQ-01', 2))).toBe(false)
    expect(read(spec, 'REQ-01').reviews.map(review => review.round)).toEqual([1])

    reviseRequirement(spec, 'REQ-01', { content: '# 佣金改造\n\n改稿。', at: '2099-01-01T00:00:00Z' })
    expect((await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 第 2 轮' })).round).toBe(2)
    expect(read(spec, 'REQ-01').reviews[0]).toMatchObject({ decision: 'accepted', applied_version: 2 })
  })

  it('放弃本轮意见后同一份正文也能再评一轮', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 第 1 轮' })
    decideRequirementReview(spec, 'REQ-01', { round: 1, decision: 'rejected', at: '2026-11-17T12:00:00+08:00' })

    expect((await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 第 2 轮' })).round).toBe(2)
    expect(read(spec, 'REQ-01').reviews.map(review => review.decision)).toEqual(['rejected', undefined])
  })

  it('旧需求没有版本表时未决评审拦住第二轮，放弃后放行', async () => {
    const { spec } = makeRepo()
    saveRequirement(spec, Requirement.parse({
      id: 'REQ-01',
      title: '旧需求',
      opened_at: '2026-11-13T09:00:00+08:00',
    }))
    writeFileSync(join(spec, 'requirements', 'REQ-01.md'), CONTENT, 'utf8')

    expect((await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 第 1 轮' })).round).toBe(1)
    await expect(callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 重复评审' }))
      .rejects.toThrow(/上一轮评审后正文未改稿/)
    decideRequirementReview(spec, 'REQ-01', { round: 1, decision: 'rejected', at: '2026-11-17T12:00:00+08:00' })
    expect((await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 第 2 轮' })).round).toBe(2)
  })
})

describe('多岗会审评审门禁', () => {
  async function multiRoleRepo(): Promise<string> {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })
    writeReviewFlow(spec)
    return spec
  }

  it('pm 落 R1 未决后，manager 可接着落 R2', async () => {
    const spec = await multiRoleRepo()
    const first = await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# pm 评审' }, asRole('maniu-pm'))
    expect(first.round).toBe(1)

    const second = await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# manager 评审' }, asRole('maniu-manager'))
    expect(second.round).toBe(2)
    expect(read(spec, 'REQ-01').reviews.map(review => review.role)).toEqual(['maniu-pm', 'maniu-manager'])
  })

  it('pm 未改稿就重复落报告仍被拦', async () => {
    const spec = await multiRoleRepo()
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# pm 评审' }, asRole('maniu-pm'))

    await expect(callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# pm 重复' }, asRole('maniu-pm')))
      .rejects.toThrow(/上一轮评审后正文未改稿/)
    expect(read(spec, 'REQ-01').reviews.map(review => review.round)).toEqual([1])
  })

  it('全岗评齐但未处置时，再评一轮被拦', async () => {
    const spec = await multiRoleRepo()
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# pm 评审' }, asRole('maniu-pm'))
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# manager 评审' }, asRole('maniu-manager'))

    await expect(callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 第三轮' }, asRole('maniu-manager')))
      .rejects.toThrow(/上一轮评审后正文未改稿/)
    expect(read(spec, 'REQ-01').reviews.map(review => review.round)).toEqual([1, 2])
  })

  it('全岗评齐后改稿把两轮一并标采纳，允许下一轮评审', async () => {
    const spec = await multiRoleRepo()
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# pm 评审' }, asRole('maniu-pm'))
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# manager 评审' }, asRole('maniu-manager'))

    const at = '2099-01-01T00:00:00Z'
    reviseRequirement(spec, 'REQ-01', { content: '# 佣金改造\n\n两岗意见已采纳。', at })
    expect(read(spec, 'REQ-01').reviews.map(review => review.decision)).toEqual(['accepted', 'accepted'])

    const next = await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 新一轮' }, asRole('maniu-pm'))
    expect(next.round).toBe(3)
  })
})

describe('需求改稿', () => {
  const REVISED = '# 佣金改造\n\n自营免佣；代发保持原费率。'

  it('新正文覆盖同名文件，旧正文与新正文各留一份快照', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })

    const result = await callTool(spec, 'requirement_revise', { id: 'REQ-01', content: REVISED })
    expect(result).toMatchObject({ requirement_id: 'REQ-01', version: 2, backfilled: false })
    expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')).toBe(REVISED)
    expect(readFileSync(requirementVersionPath(spec, 'REQ-01', 1), 'utf8')).toBe(CONTENT)
    expect(readFileSync(requirementVersionPath(spec, 'REQ-01', 2), 'utf8')).toBe(REVISED)

    const requirement = read(spec, 'REQ-01')
    expect(requirement.state).toBe('draft')
    expect(requirement.versions.map(version => version.n)).toEqual([1, 2])
  })

  it('旧需求没有版本表时先补 v1，再写新版本', async () => {
    const { spec } = makeRepo()
    saveRequirement(spec, Requirement.parse({
      id: 'REQ-01',
      title: '旧需求',
      opened_at: '2026-11-13T09:00:00+08:00',
    }))
    writeFileSync(join(spec, 'requirements', 'REQ-01.md'), CONTENT, 'utf8')

    const result = await callTool(spec, 'requirement_revise', { id: 'REQ-01', content: REVISED })
    expect(result).toMatchObject({ version: 2, backfilled: true })
    expect(readFileSync(requirementVersionPath(spec, 'REQ-01', 1), 'utf8')).toBe(CONTENT)
    expect(readFileSync(requirementVersionPath(spec, 'REQ-01', 2), 'utf8')).toBe(REVISED)
    expect(read(spec, 'REQ-01').versions.map(version => version.n)).toEqual([1, 2])
  })

  it('元数据写失败时还原正文并删掉本次快照', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })

    expect(() => reviseRequirement(spec, 'REQ-01', { content: REVISED, at: '昨天' })).toThrow()
    expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)
    expect(existsSync(requirementVersionPath(spec, 'REQ-01', 2))).toBe(false)
    expect(read(spec, 'REQ-01').versions.map(version => version.n)).toEqual([1])
  })

  it('非起草态拒绝改稿，正文不动', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })
    saveRequirement(spec, { ...read(spec, 'REQ-01'), state: 'confirmed' })

    await expect(callTool(spec, 'requirement_revise', { id: 'REQ-01', content: REVISED }))
      .rejects.toThrow(/只有起草态/)
    expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)
  })

  it('改稿把待处理评审标为采纳并关联新版本，已终态轮次不动', async () => {
    const { spec } = makeRepo()
    await call(spec, { title: '佣金改造', content: CONTENT })
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 第 1 轮' })
    decideRequirementReview(spec, 'REQ-01', {
      round: 1, decision: 'rejected', at: '2026-11-17T12:00:00+08:00', note: '不采纳',
    })
    await callTool(spec, 'requirement_review_draft', { id: 'REQ-01', report: '# 第 2 轮' })

    const at = '2026-11-18T10:00:00+08:00'
    const result = reviseRequirement(spec, 'REQ-01', { content: REVISED, at })

    const reviews = read(spec, 'REQ-01').reviews
    expect(reviews[0]).toMatchObject({ round: 1, decision: 'rejected', decision_note: '不采纳' })
    expect(reviews[0]?.applied_version).toBeUndefined()
    expect(reviews[1]).toMatchObject({
      round: 2, decision: 'accepted', decided_at: at, applied_version: result.version,
    })
    expect(reviews[1]?.report).toBe('requirements/REQ-01/reviews/R2.md')
  })
})

describe('需求落盘回滚', () => {
  it('元数据写失败时删掉刚写的正文与快照，磁盘上不留半截需求', () => {
    const { spec } = makeRepo()

    expect(() => createRequirement(spec, {
      title: '坏需求',
      content: CONTENT,
      opened_at: '昨天',
    })).toThrow()

    expect(existsSync(join(spec, 'requirements', 'REQ-01.md'))).toBe(false)
    expect(existsSync(join(spec, 'requirements', 'REQ-01.yaml'))).toBe(false)
    expect(existsSync(requirementVersionPath(spec, 'REQ-01', 1))).toBe(false)
  })
})
