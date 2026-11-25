import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTaskDiscardCommand } from '../src/commands/task-discard.js'
import { loadSplitPlan, saveSplitPlan } from '../src/kernel/requirement-store.js'
import { openTask, saveTask, transition } from '../src/kernel/task-store.js'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeSpec(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lcoder-task-discard-'))
  dirs.push(dir)
  const spec = join(dir, '.spec')
  mkdirSync(join(spec, 'tasks'), { recursive: true })
  writeFileSync(join(spec, 'project.yaml'), 'id: demo\nname: Demo\n', 'utf8')
  return spec
}

describe('task_discard 命令', () => {
  it('删除 drafting 任务并同步清理 split-plan.yaml', () => {
    const spec = makeSpec()
    const t1 = openTask({
      id: 'T-06',
      title: '待删任务',
      grade: 'B',
      requirement: 'REQ-01',
      opened_at: '2026-11-25T10:00:00+08:00',
    })
    saveTask(spec, t1)
    saveSplitPlan(spec, {
      requirement: 'REQ-01',
      at: '2026-11-25T10:00:00+08:00',
      tasks: [
        { task: 'T-06', role: 'api-dev' },
        { task: 'T-07', role: 'fe-dev' },
      ],
    })

    const cmd = createTaskDiscardCommand(spec, () => '2026-11-25T10:05:00+08:00')
    const result = cmd.handler({ rawInput: 'T-06' })
    expect(result).toEqual({ kind: 'success', text: '已删除待确认任务 T-06（待删任务）。' })
    expect(existsSync(join(spec, 'tasks', 'T-06.yaml'))).toBe(false)

    const plan = loadSplitPlan(spec, 'REQ-01')
    expect(plan?.tasks.map(entry => entry.task)).toEqual(['T-07'])
  })

  it('非 drafting 状态或被其他任务依赖时拒绝删除', () => {
    const spec = makeSpec()
    const t1 = openTask({ id: 'T-06', title: '前置草稿', grade: 'B', opened_at: '2026-11-25T10:00:00+08:00' })
    const t2 = openTask({
      id: 'T-07',
      title: '后置任务',
      grade: 'B',
      depends_on: ['T-06'],
      opened_at: '2026-11-25T10:01:00+08:00',
    })
    const { task: t3 } = transition(
      openTask({ id: 'T-08', title: '已签约任务', grade: 'B', opened_at: '2026-11-25T10:02:00+08:00' }),
      'contracted',
    )
    saveTask(spec, t1)
    saveTask(spec, t2)
    saveTask(spec, t3)

    const cmd = createTaskDiscardCommand(spec)
    expect(cmd.handler({ rawInput: 'T-06' })).toEqual({
      kind: 'error',
      text: 'T-06 仍被任务 T-07 依赖；请先调整或删除这些后置任务',
    })
    expect(cmd.handler({ rawInput: 'T-08' })).toEqual({
      kind: 'error',
      text: 'T-08 当前处于「contracted」，只有待确认（drafting）状态的任务允许删除',
    })
    expect(cmd.handler({ rawInput: '' })).toEqual({
      kind: 'error',
      text: '需要任务编号，例如 /task_discard T-06',
    })
  })
})
