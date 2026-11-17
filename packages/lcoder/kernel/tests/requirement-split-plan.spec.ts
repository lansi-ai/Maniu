/**
 * 拆分岗位建议：schema 只放行严格形状，工具只写给已过审需求里仍在起草态的本需求任务，
 * 且只写建议文件——任务状态与 `Task.role` 都不动。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import {
  loadSplitPlan,
  requirementSplitPlanPath,
  saveRequirement,
} from '../src/kernel/requirement-store.js'
import { saveRoles } from '../src/kernel/role-store.js'
import { loadTask, saveTask } from '../src/kernel/task-store.js'
import { Requirement, RequirementSplitPlan, Task } from '../src/schema/spec.js'
import { createRequirementTools } from '../src/tools/requirement-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const AT = '2026-11-17T15:00:00+08:00'

function makeRepo(): { repo: string; spec: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-split-plan-'))
  dirs.push(repo)
  return { repo, spec: join(repo, '.spec') }
}

function confirmRequirement(spec: string, id = 'REQ-01', state: 'draft' | 'confirmed' = 'confirmed'): void {
  saveRequirement(spec, Requirement.parse({
    id,
    title: '佣金改造',
    state,
    opened_at: '2026-11-17T09:00:00+08:00',
  }))
}

function seedTask(spec: string, overrides: Partial<Parameters<typeof saveTask>[1]> & { readonly id: string }): void {
  saveTask(spec, Task.parse({
    title: '任务',
    grade: 'B',
    state: 'drafting',
    requirement: 'REQ-01',
    opened_at: '2026-11-17T10:00:00+08:00',
    ...overrides,
  }))
}

function call(spec: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = createRequirementTools(spec).find(entry => entry.name === 'requirement_split_plan')
  if (tool === undefined) throw new Error('没有 requirement_split_plan')
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

const VALID = {
  requirement: 'REQ-01',
  at: AT,
  tasks: [{ task: 'T-01', role: 'vue', reason: '页面交互' }],
}

describe('拆分计划 schema', () => {
  it('严格放行合法计划，缺字段、空任务表与越界字段都拒', () => {
    expect(RequirementSplitPlan.parse(VALID)).toMatchObject(VALID)
    expect(RequirementSplitPlan.safeParse({ ...VALID, extra: true }).success).toBe(false)
    expect(RequirementSplitPlan.safeParse({ ...VALID, tasks: [] }).success).toBe(false)
    expect(RequirementSplitPlan.safeParse({ ...VALID, at: '昨天' }).success).toBe(false)
    expect(RequirementSplitPlan.safeParse({ ...VALID, tasks: [{ task: 'T-01' }] }).success).toBe(false)
    expect(RequirementSplitPlan.safeParse({ ...VALID, tasks: [{ task: 'T-01', role: 'Vue 工程师' }] }).success).toBe(false)
    expect(RequirementSplitPlan.safeParse({ ...VALID, tasks: [{ task: 'T-01', role: 'vue', reason: '' }] }).success).toBe(false)
  })
})

describe('拆分岗位建议工具', () => {
  it('把逐条建议写进 split-plan.yaml，返回条目且不动任务与需求', async () => {
    const { spec } = makeRepo()
    confirmRequirement(spec)
    saveRoles(spec, [{ id: 'vue', name: 'Vue 工程师', inherits: 'dev' }])
    seedTask(spec, { id: 'T-01', title: '需求页' })
    seedTask(spec, { id: 'T-02', title: '接口', track: 'api' })

    const result = await call(spec, {
      id: 'REQ-01',
      tasks: [
        { task: 'T-01', role: 'vue', reason: '页面交互' },
        { task: 'T-02', role: 'dev' },
      ],
    })

    expect(result).toMatchObject({
      requirement_id: 'REQ-01',
      tasks: [
        { task: 'T-01', role: 'vue', reason: '页面交互' },
        { task: 'T-02', role: 'dev', reason: null },
      ],
    })
    expect(result.at).toEqual(expect.any(String))
    expect(String(result.path)).toBe(requirementSplitPlanPath(spec, 'REQ-01'))
    expect(loadSplitPlan(spec, 'REQ-01')).toMatchObject({
      requirement: 'REQ-01',
      tasks: [{ task: 'T-01', role: 'vue', reason: '页面交互' }, { task: 'T-02', role: 'dev' }],
    })

    const task = loadTask(spec, 'T-01')
    expect(task.state).toBe('drafting')
    expect(task.role).toBeUndefined()
    expect(loadTask(spec, 'T-02').role).toBeUndefined()
  })

  it('再写一次覆盖上一份计划', async () => {
    const { spec } = makeRepo()
    confirmRequirement(spec)
    seedTask(spec, { id: 'T-01' })
    seedTask(spec, { id: 'T-02' })

    await call(spec, { id: 'REQ-01', tasks: [{ task: 'T-01', role: 'dev' }, { task: 'T-02', role: 'dev' }] })
    await call(spec, { id: 'REQ-01', tasks: [{ task: 'T-02', role: 'dev' }] })

    expect(loadSplitPlan(spec, 'REQ-01')?.tasks).toEqual([{ task: 'T-02', role: 'dev' }])
  })

  it('未过审的需求拒绝写计划，一个文件都不写', async () => {
    const { spec } = makeRepo()
    confirmRequirement(spec, 'REQ-01', 'draft')
    seedTask(spec, { id: 'T-01' })

    await expect(call(spec, { id: 'REQ-01', tasks: [{ task: 'T-01', role: 'dev' }] }))
      .rejects.toThrow(/只能写给已过审/)
    expect(existsSync(requirementSplitPlanPath(spec, 'REQ-01'))).toBe(false)
  })

  it('任务不属于该需求或不在起草态都拒，计划文件不落盘', async () => {
    const { spec } = makeRepo()
    confirmRequirement(spec)
    confirmRequirement(spec, 'REQ-02')
    seedTask(spec, { id: 'T-01', requirement: 'REQ-02' })
    seedTask(spec, { id: 'T-02', state: 'contracted' })
    seedTask(spec, { id: 'T-03' })

    await expect(call(spec, { id: 'REQ-01', tasks: [{ task: 'T-01', role: 'dev' }] }))
      .rejects.toThrow(/没有回指需求 REQ-01/)
    await expect(call(spec, { id: 'REQ-01', tasks: [{ task: 'T-02', role: 'dev' }] }))
      .rejects.toThrow(/只有起草态任务/)
    await expect(call(spec, { id: 'REQ-01', tasks: [{ task: 'T-99', role: 'dev' }] }))
      .rejects.toThrow(/不存在/)
    expect(existsSync(requirementSplitPlanPath(spec, 'REQ-01'))).toBe(false)
  })

  it('岗位名册与内置角色都不认识时拒绝；空表与重复任务也拒绝', async () => {
    const { spec } = makeRepo()
    confirmRequirement(spec)
    seedTask(spec, { id: 'T-01' })

    await expect(call(spec, { id: 'REQ-01', tasks: [{ task: 'T-01', role: 'php' }] }))
      .rejects.toThrow(/岗位 php 不认识/)
    await expect(call(spec, { id: 'REQ-01', tasks: [] }))
      .rejects.toThrow(/非空的 tasks/)
    await expect(call(spec, {
      id: 'REQ-01',
      tasks: [{ task: 'T-01', role: 'dev' }, { task: 'T-01', role: 'vue' }],
    })).rejects.toThrow(/重复写了任务 T-01/)
    expect(existsSync(requirementSplitPlanPath(spec, 'REQ-01'))).toBe(false)
  })

  it('文件内容是 schema 可解析的 YAML，理由空白即省略', async () => {
    const { spec } = makeRepo()
    confirmRequirement(spec)
    seedTask(spec, { id: 'T-01' })

    await call(spec, { id: 'REQ-01', tasks: [{ task: 'T-01', role: 'dev', reason: '   ' }] })
    expect(RequirementSplitPlan.parse(parseYaml(readFileSync(requirementSplitPlanPath(spec, 'REQ-01'), 'utf8')))).toMatchObject({
      requirement: 'REQ-01',
      tasks: [{ task: 'T-01', role: 'dev' }],
    })
  })
})
