/**
 * 需求工具 `requirement_draft` 的行为测：正文与元数据一起落盘，编号只增不覆盖。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import {
  createRequirement,
  requirementReviewPath,
  requirementVersionPath,
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

function callTool(spec: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = createRequirementTools(spec).find(entry => entry.name === name)
  if (tool === undefined) throw new Error(`没有 ${name}`)
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

function call(spec: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return callTool(spec, 'requirement_draft', args)
}

function read(spec: string, id: string): Requirement {
  return Requirement.parse(parseYaml(readFileSync(join(spec, 'requirements', `${id}.yaml`), 'utf8')))
}

const CONTENT = '# 佣金改造\n\n自营订单不该按下限兜底，代发订单保持现状。'

describe('需求工具', () => {
  it('提供起草、评审与改稿三个工具，不含过审能力', () => {
    const names = createRequirementTools(makeRepo().spec).map(entry => entry.name)
    expect(names).toEqual(['requirement_draft', 'requirement_review_draft', 'requirement_revise'])
    expect(names).not.toContain('requirement_approve')
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

    const second = await callTool(spec, 'requirement_review_draft', {
      id: 'REQ-01',
      report: '# 第 2 轮评审\n\n补充后再看。',
    })
    expect(second).toMatchObject({ round: 2 })

    const requirement = read(spec, 'REQ-01')
    expect(requirement.state).toBe('draft')
    expect(requirement.reviews.map(review => review.round)).toEqual([1, 2])
    expect(requirement.reviews[1]?.report).toBe('requirements/REQ-01/reviews/R2.md')
    expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)
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
