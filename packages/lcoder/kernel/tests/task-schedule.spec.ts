/**
 * 人机命令 `task_schedule` 的行为测：判定以追加行落进任务证据目录、坏输入不写盘。
 *
 * 这里不启动 Loader——命令面的装配证据按既有做法走桌面端启动，本测钉住处理器自己的判定。
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createTaskScheduleCommand } from '../src/commands/task-schedule.js'
import type { ScheduleCommandResult } from '../src/commands/task-schedule.js'
import { openTask, saveTask } from '../src/kernel/task-store.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const AT = '2026-11-06T10:00:00.000Z'

function makeSpec(ids: readonly string[] = ['T-01']): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-schedule-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  for (const id of ids) saveTask(root, openTask({ id, title: `${id} 的标题`, grade: 'C', opened_at: AT }))
  return root
}

function run(root: string, rawInput: string, sessionId = 'session-a'): ScheduleCommandResult {
  return createTaskScheduleCommand(root, () => AT).handler({
    rawInput,
    agent: { session: { header: { id: sessionId } } },
  })
}

describe('task_schedule 记录调度判定', () => {
  it('把判定追加成一行 JSON，带上时刻与执行会话', () => {
    const root = makeSpec()
    const payload = JSON.stringify({ verdict: 'enqueue', chosen: 'session-b', queuePosition: 2 })

    const result = run(root, `T-01 ${payload}`)

    expect(result.kind).toBe('success')
    const line = readFileSync(join(root, 'evidence', 'T-01', 'schedule.jsonl'), 'utf8').trim()
    expect(JSON.parse(line)).toEqual({
      at: AT,
      by: 'session-a',
      verdict: 'enqueue',
      chosen: 'session-b',
      queuePosition: 2,
    })
  })

  it('多次判定按行追加，不覆盖前一条', () => {
    const root = makeSpec()

    run(root, `T-01 ${JSON.stringify({ verdict: 'wait', blockedBy: ['T-00'] })}`)
    run(root, `T-01 ${JSON.stringify({ verdict: 'reuse', chosen: 'session-a' })}`)

    const lines = readFileSync(join(root, 'evidence', 'T-01', 'schedule.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] ?? '{}') as Record<string, unknown>).toMatchObject({ verdict: 'wait' })
    expect(JSON.parse(lines[1] ?? '{}') as Record<string, unknown>).toMatchObject({ verdict: 'reuse' })
  })

  it('任务不存在时不落盘', () => {
    const root = makeSpec()

    const result = run(root, `T-09 ${JSON.stringify({ verdict: 'new' })}`)

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.text).toContain('读不到任务 T-09')
  })

  it('判定值不认识或 JSON 坏了都拒绝', () => {
    const root = makeSpec()

    expect(run(root, 'T-01 {"verdict":"steal"}').kind).toBe('error')
    expect(run(root, 'T-01 {oops').kind).toBe('error')
    expect(run(root, 'T-01').kind).toBe('error')
    expect(run(root, 'T-01 []').kind).toBe('error')
  })

  it('enqueue 带联调组时写出组文件，同一会话再入队只并成员', () => {
    const root = makeSpec(['T-01', 'T-02'])

    const first = run(root, `T-01 ${JSON.stringify({
      verdict: 'enqueue',
      chosen: 'session-b',
      queuePosition: 1,
      joint: { sessionId: 'session-b', members: ['T-01', 'T-02'] },
    })}`)
    expect(first.kind).toBe('success')
    const groupPath = join(root, 'evidence', 'scheduling', 'group-1.yaml')
    expect(parseYaml(readFileSync(groupPath, 'utf8'))).toMatchObject({
      id: 'group-1',
      session: 'session-b',
      members: ['T-01', 'T-02'],
      created_at: AT,
      updated_at: AT,
    })

    run(root, `T-01 ${JSON.stringify({
      verdict: 'enqueue',
      chosen: 'session-b',
      joint: { sessionId: 'session-b', members: ['T-01', 'T-02'] },
    })}`)
    expect(readdirSync(join(root, 'evidence', 'scheduling')).filter(name => name.endsWith('.yaml')))
      .toEqual(['group-1.yaml'])
    expect(parseYaml(readFileSync(groupPath, 'utf8')) as Record<string, unknown>)
      .toMatchObject({ members: ['T-01', 'T-02'] })
  })

  it('联调组只允许 enqueue，成员必须存在', () => {
    const root = makeSpec(['T-01', 'T-02'])

    expect(run(root, `T-01 ${JSON.stringify({
      verdict: 'reuse', joint: { sessionId: 's', members: ['T-01'] },
    })}`).kind).toBe('error')
    expect(run(root, `T-01 ${JSON.stringify({
      verdict: 'enqueue', joint: { sessionId: 's', members: ['T-09'] },
    })}`).kind).toBe('error')
    expect(run(root, `T-01 ${JSON.stringify({
      verdict: 'enqueue', joint: { sessionId: 's', members: [] },
    })}`).kind).toBe('error')
  })

  it('没有 .spec 时如实报缺，不建证据目录', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lcoder-schedule-empty-'))
    dirs.push(repo)

    const result = run(join(repo, '.spec'), 'T-01 {"verdict":"new"}')

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.text).toContain('还没有 .spec')
  })
})
