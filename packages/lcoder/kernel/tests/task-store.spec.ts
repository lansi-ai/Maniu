import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  IllegalTransitionError,
  canTransition,
  listTasks,
  loadTask,
  openTask,
  saveTask,
  transition,
} from '../src/kernel/task-store.js'
import type { TaskState } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const AT = '2026-11-02T15:00:00+08:00'

function newTask() {
  return openTask({ id: 'T-014', title: '佣金支持 0', grade: 'B', opened_at: AT })
}

/** 沿一串状态走到底，中间非法就直接抛。 */
function walk(states: TaskState[]) {
  let t = newTask()
  for (const s of states) t = transition(t, s, AT).task
  return t
}

describe('任务状态机', () => {
  it('主线链路可走通', () => {
    const t = walk(['contracted', 'implementing', 'verifying', 'closed'])
    expect(t.state).toBe('closed')
    expect(t.closed_at).toBe(AT)
  })

  it('开新任务一律从 drafting 起，closed_at 为 null', () => {
    const t = newTask()
    expect(t.state).toBe('drafting')
    expect(t.closed_at).toBeNull()
    expect(t.scope).toEqual({ irreversible: [], allowed_paths: [] })
  })

  it('跳跃转移被拒（drafting 不能直接到 verifying）', () => {
    const t = newTask()
    expect(() => transition(t, 'verifying', AT)).toThrow(IllegalTransitionError)
    try {
      transition(t, 'verifying', AT)
    } catch (err) {
      const e = err as IllegalTransitionError
      expect(e.from).toBe('drafting')
      expect(e.to).toBe('verifying')
      expect(e.taskId).toBe('T-014')
    }
  })

  it('closed 是终态，没有任何出边', () => {
    const t = walk(['contracted', 'implementing', 'verifying', 'closed'])
    for (const s of ['drafting', 'contracted', 'implementing', 'verifying', 'closed'] as const) {
      expect(canTransition('closed', s)).toBe(false)
    }
    expect(() => transition(t, 'implementing', AT)).toThrow(IllegalTransitionError)
  })

  it('退回边是合法的：验收不过回 implementing，契约变更回 contracted', () => {
    const v = walk(['contracted', 'implementing', 'verifying'])
    expect(transition(v, 'implementing', AT).task.state).toBe('implementing')

    const i = walk(['contracted', 'implementing'])
    expect(transition(i, 'contracted', AT).task.state).toBe('contracted')
  })

  it('transition 不改入参（状态漂移的主要来源就是这个）', () => {
    const before = newTask()
    const snapshot = structuredClone(before)
    const { task: after } = transition(before, 'contracted', AT)

    expect(before).toEqual(snapshot)
    expect(after).not.toBe(before)
    expect(after.state).toBe('contracted')
  })

  it('每次转移产出一条可写日志的事件', () => {
    const { event } = transition(newTask(), 'contracted', AT)
    expect(event).toEqual({
      type: 'task/transition',
      task_id: 'T-014',
      from: 'drafting',
      to: 'contracted',
      at: AT,
    })
  })

  it('落盘后读回内容一致', () => {
    const root = mkdtempSync(join(tmpdir(), 'lcoder-task-'))
    dirs.push(root)

    const t = walk(['contracted', 'implementing'])
    saveTask(root, t)

    const back = loadTask(root, 'T-014')
    expect(back).toEqual(t)
    expect(listTasks(root).map(x => x.id)).toEqual(['T-014'])
  })
})
