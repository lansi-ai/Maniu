/**
 * 人机命令 `task_split_ready` 的行为测：只把「需求拆出、已分配岗位」的起草任务
 * 直接推到待开发（contracted）。
 *
 * 四道闸各钉一条：状态不对不写、不是拆分任务不写、没有岗位不写、任务不存在不写。
 * 任何一道不过都只回一句话，任务文件一个字节不动。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createTaskSplitReadyCommand } from '../src/commands/task-split-ready.js'
import { openTask, saveTask, taskPath } from '../src/kernel/task-store.js'
import { Task } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** 一个带 `.spec/tasks` 的临时规格根。 */
function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-split-ready-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  return root
}

interface TaskShape {
  readonly state?: Task['state']
  readonly proposal?: string
  readonly role?: string
}

/** 写一条拆分任务；`proposal` 与 `role` 缺省就给齐全，单测按用例抹掉。 */
function writeTask(root: string, shape: TaskShape = {}): void {
  const task = Task.parse({
    ...openTask({
      id: 'T-02',
      title: '记一笔',
      grade: 'B',
      opened_at: '2026-11-12T09:00:00+08:00',
      ...(shape.proposal === undefined ? {} : { proposal: shape.proposal }),
    }),
    state: shape.state ?? 'drafting',
    ...(shape.role === undefined ? {} : { role: shape.role }),
  })
  saveTask(root, task)
}

function run(root: string, rawInput: string, at = '2026-11-12T10:00:00+08:00') {
  return createTaskSplitReadyCommand(root, () => at).handler({ rawInput })
}

function stateOf(root: string): string {
  return Task.parse(parseYaml(readFileSync(taskPath(root, 'T-02'), 'utf8'))).state
}

describe('task_split_ready', () => {
  it('拆分任务已分配岗位 → 推到 contracted，回执写明需求文档为契约依据', () => {
    const root = makeSpec()
    writeTask(root, { proposal: 'P-01', role: 'architect' })

    const result = run(root, 'T-02')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('待开发')
    expect(result.text).toContain('P-01')
    expect(result.text).toContain('需求文档为契约依据')
    expect(stateOf(root)).toBe('contracted')

    const onDisk = Task.parse(parseYaml(readFileSync(taskPath(root, 'T-02'), 'utf8')))
    expect(onDisk.role).toBe('architect')
    expect(onDisk.proposal).toBe('P-01')
    expect(onDisk.closed_at).toBeNull()
  })

  it('没有岗位 → 拒绝并指向 /task_assign，状态不动', () => {
    const root = makeSpec()
    writeTask(root, { proposal: 'P-01' })

    const result = run(root, 'T-02')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('还没分配岗位')
    expect(result.text).toContain('/task_assign T-02')
    expect(stateOf(root)).toBe('drafting')
  })

  it('没有回指需求方案 → 拒绝并指向契约流程', () => {
    const root = makeSpec()
    writeTask(root, { role: 'architect' })

    const result = run(root, 'T-02')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('不是需求拆分出来的任务')
    expect(result.text).toContain('/contract_sign')
    expect(stateOf(root)).toBe('drafting')
  })

  it('不是起草态 → 拒绝并说清当前状态', () => {
    const root = makeSpec()
    writeTask(root, { state: 'contracted', proposal: 'P-01', role: 'architect' })

    const result = run(root, 'T-02')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('contracted')
    expect(result.text).toContain('只有起草态')
    expect(stateOf(root)).toBe('contracted')
  })

  it('任务文件不存在 → 报路径，不创建文件', () => {
    const root = makeSpec()

    const result = run(root, 'T-02')
    expect(result.kind).toBe('error')
    expect(result.text).toContain(taskPath(root, 'T-02'))
    expect(() => readFileSync(taskPath(root, 'T-02'))).toThrow()
  })
})
