/**
 * 需求工具 `requirement_draft` 的行为测：正文与元数据一起落盘，编号只增不覆盖。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createRequirement, saveRequirement } from '../src/kernel/requirement-store.js'
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

function call(spec: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = createRequirementTools(spec).find(entry => entry.name === 'requirement_draft')
  if (tool === undefined) throw new Error('没有 requirement_draft')
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

function read(spec: string, id: string): Requirement {
  return Requirement.parse(parseYaml(readFileSync(join(spec, 'requirements', `${id}.yaml`), 'utf8')))
}

const CONTENT = '# 佣金改造\n\n自营订单不该按下限兜底，代发订单保持现状。'

describe('需求工具', () => {
  it('只提供 requirement_draft 一个工具', () => {
    expect(createRequirementTools(makeRepo().spec).map(entry => entry.name)).toEqual(['requirement_draft'])
  })

  it('首次落盘取 REQ-01：正文与 YAML 都写下，返回两个路径与字数', async () => {
    const { spec } = makeRepo()

    const result = await call(spec, { title: '支持自营与代发两种佣金', content: CONTENT })
    expect(result).toMatchObject({
      requirement_id: 'REQ-01',
      state: 'draft',
      characters: CONTENT.trim().length,
    })
    expect(String(result.path)).toBe(join(spec, 'requirements', 'REQ-01.yaml'))
    expect(String(result.document_path)).toBe(join(spec, 'requirements', 'REQ-01.md'))
    expect(readFileSync(join(spec, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)

    const requirement = read(spec, 'REQ-01')
    expect(requirement).toMatchObject({
      id: 'REQ-01',
      title: '支持自营与代发两种佣金',
      state: 'draft',
      options: [],
    })
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
      'REQ-01.md', 'REQ-01.yaml', 'REQ-02.md', 'REQ-02.yaml',
    ])
  })

  it('requirements 目录缺失时自动建', async () => {
    const { spec } = makeRepo()
    mkdirSync(spec, { recursive: true })

    const result = await call(spec, { title: '新需求', content: CONTENT })
    expect(result).toMatchObject({ requirement_id: 'REQ-01' })
  })
})

describe('需求落盘回滚', () => {
  it('元数据写失败时删掉刚写的正文，磁盘上不留半截需求', () => {
    const { spec } = makeRepo()

    expect(() => createRequirement(spec, {
      title: '坏需求',
      content: CONTENT,
      opened_at: '昨天',
    })).toThrow()

    expect(existsSync(join(spec, 'requirements', 'REQ-01.md'))).toBe(false)
    expect(existsSync(join(spec, 'requirements', 'REQ-01.yaml'))).toBe(false)
  })
})
