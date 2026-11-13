/**
 * 任务回指需求：写盘前查存在，读侧带回编号，旧 proposal 字段原样保留。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { saveRequirement } from '../src/kernel/requirement-store.js'
import { saveProposal } from '../src/kernel/proposal-store.js'
import { Requirement } from '../src/schema/spec.js'
import type { Proposal } from '../src/schema/spec.js'
import { createTaskTools } from '../src/tools/task-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-task-requirement-'))
  dirs.push(repo)
  const spec = join(repo, '.spec')
  mkdirSync(join(spec, 'tasks'), { recursive: true })
  return spec
}

function call(spec: string, toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = createTaskTools(spec).find(entry => entry.name === toolName)
  if (tool === undefined) throw new Error(`没有这个工具：${toolName}`)
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

function writeRequirement(spec: string, id = 'REQ-01'): Requirement {
  const requirement = Requirement.parse({ id, title: '佣金改造', opened_at: '2026-11-13T09:00:00+08:00' })
  saveRequirement(spec, requirement)
  return requirement
}

describe('任务回指需求', () => {
  it('需求不存在就拒绝，并列出已有需求', async () => {
    const spec = makeSpec()
    writeRequirement(spec)

    await expect(call(spec, 'task_draft', { title: '按需求实现', grade: 'B', requirement: 'REQ-09' }))
      .rejects.toThrow(/需求不存在：REQ-09.*REQ-01/)
  })

  it('形态不对的编号直接拒绝', async () => {
    const spec = makeSpec()
    writeRequirement(spec)

    await expect(call(spec, 'task_draft', { title: '按需求实现', grade: 'B', requirement: 'REQ-1' }))
      .rejects.toThrow(/非法的需求编号/)
  })

  it('需求存在就写盘，任务文件带 requirement', async () => {
    const spec = makeSpec()
    writeRequirement(spec)

    const result = await call(spec, 'task_draft', { title: '按需求实现', grade: 'B', requirement: 'REQ-01' })
    expect(result).toMatchObject({ created: true, task_id: 'T-01', requirement: 'REQ-01' })
    expect(readFileSync(join(spec, 'tasks', 'T-01.yaml'), 'utf8')).toContain('requirement: REQ-01')
  })

  it('requirement 与 proposal 可以并存，读侧都带回', async () => {
    const spec = makeSpec()
    writeRequirement(spec)
    const proposal: Proposal = {
      id: 'P-01',
      title: '旧方案',
      problem: '旧流程',
      options: [{ name: '甲', summary: '甲的做法', cost: '甲的代价' }],
      recommendation: '选甲',
      decision: 'approved',
      decided_at: '2026-11-13T09:00:00+08:00',
      opened_at: '2026-11-13T09:00:00+08:00',
    }
    saveProposal(spec, proposal)

    await call(spec, 'task_draft', {
      title: '同时回指', grade: 'B', requirement: 'REQ-01', proposal: 'P-01',
    })

    const detail = await call(spec, 'task_read', { task_id: 'T-01' })
    expect(detail).toMatchObject({ requirement: 'REQ-01', proposal: 'P-01' })

    const list = await call(spec, 'task_read', {})
    expect(list.tasks).toEqual([
      { id: 'T-01', title: '同时回指', state: 'drafting', grade: 'B', proposal: 'P-01', requirement: 'REQ-01' },
    ])
  })

  it('不带 requirement 的任务照旧可建，读侧不带这个键', async () => {
    const spec = makeSpec()

    await call(spec, 'task_draft', { title: '普通任务', grade: 'C' })
    const detail = await call(spec, 'task_read', { task_id: 'T-01' })
    expect(detail).not.toHaveProperty('requirement')
  })
})
