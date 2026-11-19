/**
 * 需求变更提案工具 `requirement_propose` 的行为测：只写提案，需求本体一个字都不动。
 *
 * 与 `proposal_draft` 同档纪律：模型能出提案，落需求本体与拍板都归人机命令。
 * schema 侧钉住载荷形态：revise 必须带 target 与 base_version，new 的依据成对出现，旧提案照常解析。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createRequirement, saveRequirement, loadRequirement } from '../src/kernel/requirement-store.js'
import { loadProposal } from '../src/kernel/proposal-store.js'
import { Proposal, Requirement, RequirementChange } from '../src/schema/spec.js'
import { createRequirementTools } from '../src/tools/requirement-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeRepo(): { repo: string; spec: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-propose-'))
  dirs.push(repo)
  return { repo, spec: join(repo, '.spec') }
}

function call(spec: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = createRequirementTools(spec).find(entry => entry.name === 'requirement_propose')
  if (tool === undefined) throw new Error('没有 requirement_propose')
  const execute = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return execute(args, {}) as Promise<Record<string, unknown>>
}

const CONTENT = '# 佣金改造\n\n## 目标\n\n自营订单免佣。\n\n## 验收\n\n- 自营订单佣金为 0。'
const ANALYSIS = '与 REQ-01 不冲突；影响面集中在佣金结算；建议优先级高。'

function seedRequirement(spec: string, state: 'draft' | 'confirmed' = 'draft'): void {
  createRequirement(spec, { title: '佣金改造', content: CONTENT, opened_at: '2026-11-17T10:00:00+08:00' })
  if (state === 'confirmed') {
    saveRequirement(spec, { ...loadRequirement(spec, 'REQ-01'), state: 'confirmed' })
  }
}

describe('需求变更提案工具', () => {
  it('new 提案落盘带 requirement_change 载荷，需求本体不写', async () => {
    const { spec } = makeRepo()

    const result = await call(spec, { mode: 'new', content: CONTENT, analysis: ANALYSIS })
    expect(result).toMatchObject({ proposal_id: 'P-01', mode: 'new', target: null, base_version: null, decision: 'draft' })
    expect(String(result.note)).toContain('/proposal_approve')
    expect(String(result.note)).toContain('需求本体没有写')

    const proposal = loadProposal(spec, 'P-01')
    expect(proposal.decision).toBe('draft')
    expect(proposal.title).toBe('佣金改造')
    expect(proposal.requirement_change).toEqual({ mode: 'new', content: CONTENT, analysis: ANALYSIS })
    expect(existsSync(join(spec, 'requirements'))).toBe(false)
  })

  it('new 提案可记录依据：target 与 base_version 成对写进载荷，确认态需求也能作依据', async () => {
    const { spec } = makeRepo()
    seedRequirement(spec, 'confirmed')

    const result = await call(spec, { mode: 'new', target: 'REQ-01', base_version: 1, content: CONTENT, analysis: ANALYSIS })
    expect(result).toMatchObject({ mode: 'new', target: 'REQ-01', base_version: 1 })
    expect(loadProposal(spec, 'P-01').requirement_change).toMatchObject({ mode: 'new', target: 'REQ-01', base_version: 1 })
    expect(loadRequirement(spec, 'REQ-01').state).toBe('confirmed')
  })

  it('new 的依据必须成对且真实存在：缺一个、目标不存在或版本不存在都拒绝', async () => {
    const { spec } = makeRepo()
    seedRequirement(spec)

    await expect(call(spec, { mode: 'new', target: 'REQ-01', content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/成对/)
    await expect(call(spec, { mode: 'new', base_version: 1, content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/成对/)
    await expect(call(spec, { mode: 'new', target: 'REQ-09', base_version: 1, content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/读不到依据需求 REQ-09/)
    await expect(call(spec, { mode: 'new', target: 'REQ-01', base_version: 5, content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/没有版本 v5/)
    expect(existsSync(join(spec, 'proposals'))).toBe(false)
  })

  it('revise 提案落盘：目标与基线写进载荷，需求正文与版本表不动', async () => {
    const { spec } = makeRepo()
    seedRequirement(spec)
    const before = readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')

    const revised = '# 佣金改造\n\n自营免佣；代发保持原费率。'
    const result = await call(spec, { mode: 'revise', target: 'REQ-01', base_version: 1, content: revised, analysis: ANALYSIS })
    expect(result).toMatchObject({ proposal_id: 'P-01', mode: 'revise', target: 'REQ-01', base_version: 1, decision: 'draft' })

    const proposal = loadProposal(spec, 'P-01')
    expect(proposal.requirement_change).toEqual({ mode: 'revise', target: 'REQ-01', base_version: 1, content: revised, analysis: ANALYSIS })
    expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')).toBe(before)
    expect(loadRequirement(spec, 'REQ-01').versions.map(version => version.n)).toEqual([1])
  })

  it('revise 校验：缺 target、缺 base_version、目标不存在、非起草态、版本不存在各回一句人话', async () => {
    const { spec } = makeRepo()
    seedRequirement(spec)

    await expect(call(spec, { mode: 'revise', content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/需要 target/)
    await expect(call(spec, { mode: 'revise', target: 'REQ-01', content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/需要 base_version/)
    await expect(call(spec, { mode: 'revise', target: 'REQ-09', base_version: 1, content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/读不到需求 REQ-09/)
    await expect(call(spec, { mode: 'revise', target: 'REQ-01', base_version: 9, content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/没有版本 v9/)

    saveRequirement(spec, { ...loadRequirement(spec, 'REQ-01'), state: 'confirmed' })
    await expect(call(spec, { mode: 'revise', target: 'REQ-01', base_version: 1, content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/只有起草态需求能改稿/)
    expect(existsSync(join(spec, 'proposals'))).toBe(false)
  })

  it('旧需求没有版本表时正文存在即认 v1 基线，与改稿补录同一口径', async () => {
    const { spec } = makeRepo()
    saveRequirement(spec, Requirement.parse({ id: 'REQ-01', title: '旧需求', opened_at: '2026-11-13T09:00:00+08:00' }))
    writeFileSync(join(spec, 'requirements', 'REQ-01.md'), CONTENT, 'utf8')

    await expect(call(spec, { mode: 'revise', target: 'REQ-01', base_version: 1, content: CONTENT, analysis: ANALYSIS }))
      .resolves.toMatchObject({ mode: 'revise', base_version: 1 })
    await expect(call(spec, { mode: 'revise', target: 'REQ-01', base_version: 2, content: CONTENT, analysis: ANALYSIS }))
      .rejects.toThrow(/没有版本 v2/)
  })

  it('正文或分析空白就拒，一个文件都不写', async () => {
    const { spec } = makeRepo()

    await expect(call(spec, { mode: 'new', content: '  \n ', analysis: ANALYSIS })).rejects.toThrow(/非空的 content/)
    await expect(call(spec, { mode: 'new', content: CONTENT, analysis: '   ' })).rejects.toThrow(/非空的 analysis/)
    expect(existsSync(join(spec, 'proposals'))).toBe(false)
  })

  it('编号只增不覆盖：已有 P-01 时下一条取 P-02；标题取正文第一个标题行', async () => {
    const { spec } = makeRepo()
    mkdirSync(join(spec, 'proposals'), { recursive: true })
    writeFileSync(join(spec, 'proposals', 'P-01.yaml'), [
      'id: P-01',
      'title: 既有方案',
      'problem: 现状缺口。',
      'options:',
      '  - name: 做法',
      '    summary: 怎么做',
      '    cost: 代价',
      'recommendation: 推荐做法。',
      'opened_at: 2026-11-17T09:00:00+08:00',
      '',
    ].join('\n'), 'utf8')

    const result = await call(spec, { mode: 'new', content: '没有标题的正文第一行\n\n其余内容。', analysis: ANALYSIS })
    expect(result).toMatchObject({ proposal_id: 'P-02' })
    expect(loadProposal(spec, 'P-02').title).toBe('没有标题的正文第一行')
  })
})

describe('草稿修改提案工具 requirement_patch_propose', () => {
  function patchCall(spec: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const tool = createRequirementTools(spec).find(entry => entry.name === 'requirement_patch_propose')
    if (tool === undefined) throw new Error('没有 requirement_patch_propose')
    const execute = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
    return execute(args, {}) as Promise<Record<string, unknown>>
  }

  it('绑定宿主读到的当前正文作基线，不写需求本体、不要求版本号', async () => {
    const { spec } = makeRepo()
    seedRequirement(spec)
    const before = readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')

    const result = await patchCall(spec, {
      target: 'REQ-01',
      content: '# 已改\n\n按用户说明改好的正文。',
      analysis: '按说明改了验收口径。',
    })
    expect(result).toMatchObject({ proposal_id: 'P-01', mode: 'patch', target: 'REQ-01', decision: 'draft' })
    expect(String(result.note)).toContain('应用修改')
    expect(String(result.note)).toContain('不增加版本号')

    const proposal = loadProposal(spec, 'P-01')
    expect(proposal.requirement_change).toEqual({
      mode: 'patch',
      target: 'REQ-01',
      base_content: before,
      content: '# 已改\n\n按用户说明改好的正文。',
      analysis: '按说明改了验收口径。',
    })
    expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')).toBe(before)
    expect(loadRequirement(spec, 'REQ-01').versions.map(version => version.n)).toEqual([1])
    expect(loadRequirement(spec, 'REQ-01').reviews).toEqual([])
  })

  it('待处置评审与已有评审结论的草稿同样能生成修改提案，评审记录不决定能否生成', async () => {
    const { spec } = makeRepo()
    seedRequirement(spec)
    const withReview = {
      ...loadRequirement(spec, 'REQ-01'),
      reviews: [
        { round: 1, at: '2026-11-18T10:00:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', decision: 'pending' as const },
        { round: 2, at: '2026-11-18T11:00:00+08:00', report: 'requirements/REQ-01/reviews/R2.md', decision: 'rejected' as const },
      ],
    }
    saveRequirement(spec, withReview)

    await expect(patchCall(spec, {
      target: 'REQ-01', content: '# 已改', analysis: '按说明改。',
    })).resolves.toMatchObject({ mode: 'patch' })
    expect(loadProposal(spec, 'P-01').requirement_change?.mode).toBe('patch')
  })

  it('连续改稿：第二次提案以第一次应用后的正文为基线，不拿旧快照当底稿', async () => {
    const { spec } = makeRepo()
    seedRequirement(spec)
    const first = '# 第一次改稿\n\n第一版正文。'
    await patchCall(spec, { target: 'REQ-01', content: first, analysis: '第一次改。' })
    writeFileSync(join(spec, 'requirements', 'REQ-01.md'), first, 'utf8')

    await patchCall(spec, { target: 'REQ-01', content: '# 第二次改稿\n\n第二版正文。', analysis: '第二次改。' })
    const second = loadProposal(spec, 'P-02')
    expect(second.requirement_change).toMatchObject({ mode: 'patch', target: 'REQ-01', base_content: first })
    expect(second.requirement_change?.content).toBe('# 第二次改稿\n\n第二版正文。')
  })

  it('缺 target、目标非草稿、没有正文或空输入都拒绝，不写提案', async () => {
    const { spec } = makeRepo()
    seedRequirement(spec)

    await expect(patchCall(spec, { content: '# x', analysis: ANALYSIS })).rejects.toThrow(/target/)
    await expect(patchCall(spec, { target: 'REQ-01', content: '  ', analysis: ANALYSIS })).rejects.toThrow(/非空的 content/)
    await expect(patchCall(spec, { target: 'REQ-01', content: '# x', analysis: ' ' })).rejects.toThrow(/非空的 analysis/)
    saveRequirement(spec, { ...loadRequirement(spec, 'REQ-01'), state: 'confirmed' })
    await expect(patchCall(spec, { target: 'REQ-01', content: '# x', analysis: ANALYSIS })).rejects.toThrow(/只有起草态/)
    expect(existsSync(join(spec, 'proposals'))).toBe(false)
  })
})

describe('需求变更载荷 schema', () => {
  it('revise 缺 target 或 base_version 判非法；new 的依据必须成对', () => {
    expect(RequirementChange.safeParse({ mode: 'revise', content: CONTENT, analysis: ANALYSIS }).success).toBe(false)
    expect(RequirementChange.safeParse({ mode: 'revise', target: 'REQ-01', content: CONTENT, analysis: ANALYSIS }).success).toBe(false)
    expect(RequirementChange.safeParse({ mode: 'revise', target: 'REQ-01', base_version: 1, content: CONTENT, analysis: ANALYSIS }).success).toBe(true)
    expect(RequirementChange.safeParse({ mode: 'new', target: 'REQ-01', content: CONTENT, analysis: ANALYSIS }).success).toBe(false)
    expect(RequirementChange.safeParse({ mode: 'new', base_version: 1, content: CONTENT, analysis: ANALYSIS }).success).toBe(false)
    expect(RequirementChange.safeParse({ mode: 'new', content: CONTENT, analysis: ANALYSIS }).success).toBe(true)
    expect(RequirementChange.safeParse({ mode: 'new', content: '', analysis: ANALYSIS }).success).toBe(false)
  })

  it('patch 必须带 target 与生成时读到的基线正文，缺一判非法；旧 new/revise 载荷照常解析', () => {
    expect(RequirementChange.safeParse({ mode: 'patch', target: 'REQ-01', base_content: '# 旧', content: '# 新', analysis: ANALYSIS }).success).toBe(true)
    expect(RequirementChange.safeParse({ mode: 'patch', target: 'REQ-01', content: '# 新', analysis: ANALYSIS }).success).toBe(false)
    expect(RequirementChange.safeParse({ mode: 'patch', base_content: '# 旧', content: '# 新', analysis: ANALYSIS }).success).toBe(false)
    expect(RequirementChange.safeParse({ mode: 'revise', target: 'REQ-01', base_version: 1, content: CONTENT, analysis: ANALYSIS }).success).toBe(true)
    expect(RequirementChange.safeParse({ mode: 'new', content: CONTENT, analysis: ANALYSIS }).success).toBe(true)
  })

  it('旧提案 YAML 没有 requirement_change 照常解析，新字段缺省', () => {
    const proposal = Proposal.parse(parseYaml([
      'id: P-01',
      'title: 既有方案',
      'problem: 现状缺口。',
      'options:',
      '  - name: 做法',
      '    summary: 怎么做',
      '    cost: 代价',
      'recommendation: 推荐做法。',
      'opened_at: 2026-11-17T09:00:00+08:00',
      '',
    ].join('\n')))
    expect(proposal.requirement_change).toBeUndefined()
    expect(proposal.decision).toBe('draft')
  })
})
