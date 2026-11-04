/**
 * 人机命令 `task_bind` 的行为测：认领关系只由命令写、一条会话只认领一条任务、
 * 释放后任务文件仍读得懂，且任务状态一律不碰。
 *
 * 这里不启动 Loader——命令面的装配证据按既有做法走桌面端启动（`lcoder/RUN.md`），
 * 本测钉住处理器自己的判定。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createTaskBindCommand } from '../src/commands/task-bind.js'
import type { BindCommandResult } from '../src/commands/task-bind.js'
import { listTasks, openTask, saveTask, taskPath } from '../src/kernel/task-store.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const AT = '2026-11-04T15:00:00+08:00'

/** 一个带 `.spec/tasks/` 的临时规格根，默认两条 drafting 任务。 */
function makeSpec(ids: readonly string[] = ['T-01', 'T-02']): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-bind-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  for (const id of ids) {
    saveTask(root, openTask({ id, title: `${id} 的标题`, grade: 'C', opened_at: AT }))
  }
  return root
}

/** 任务文件当前的字段集合。 */
function fieldsOf(root: string, id: string): Record<string, unknown> {
  return parseYaml(readFileSync(taskPath(root, id), 'utf8')) as Record<string, unknown>
}

/** 在一场会话里执行 `/task_bind <编号>`。 */
function bind(root: string, sessionId: string | undefined, rawInput: string): BindCommandResult {
  return createTaskBindCommand(root).handler(
    sessionId === undefined ? { rawInput } : { rawInput, agent: { session: { header: { id: sessionId } } } },
  )
}

describe('task_bind 认领关系', () => {
  it('把会话号写进任务，状态一个字节都不动', () => {
    const root = makeSpec()

    const result = bind(root, 'session-8676', 'T-01')

    expect(result.kind).toBe('success')
    expect(fieldsOf(root, 'T-01').session).toBe('session-8676')
    expect(fieldsOf(root, 'T-01').state).toBe('drafting')
    expect(result.kind === 'success' && result.text).toContain('已认上 T-01')
  })

  it('同一会话重复认领同一任务不再写盘', () => {
    const root = makeSpec()
    bind(root, 'session-8676', 'T-01')

    const result = bind(root, 'session-8676', 'T-01')

    expect(result.kind === 'success' && result.text).toContain('无需重复绑定')
  })

  it('改绑新任务时释放旧任务，且旧文件仍是一条读得懂的任务', () => {
    const root = makeSpec()
    bind(root, 'session-8676', 'T-01')

    expect(bind(root, 'session-8676', 'T-02').kind).toBe('success')

    expect('session' in fieldsOf(root, 'T-01')).toBe(false)
    expect(fieldsOf(root, 'T-02').session).toBe('session-8676')
    // 释放写成空值会让整张看板读不懂，回落这条路径必须靠 listTasks 证明没有留下脏键。
    expect(listTasks(root).map(task => task.session)).toEqual([undefined, 'session-8676'])
  })

  it('两条会话可以分头认领两条任务', () => {
    const root = makeSpec()

    bind(root, 'session-8676', 'T-01')
    bind(root, 'session-9324', 'T-02')

    expect(listTasks(root).map(task => task.session)).toEqual(['session-8676', 'session-9324'])
  })

  it('没有会话上下文就不认领：这条关系记的就是会话号', () => {
    const root = makeSpec()

    const result = bind(root, undefined, 'T-01')

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.text).toContain('没有会话可认')
    expect('session' in fieldsOf(root, 'T-01')).toBe(false)
  })

  it('编号不合法、任务不存在、仓库没立项都是人话错误', () => {
    const root = makeSpec()
    const empty = mkdtempSync(join(tmpdir(), 'lcoder-bind-empty-'))
    dirs.push(empty)
    const wrongId = bind(root, 'session-8676', 't-01')
    const noSpec = bind(join(empty, '.spec'), 'session-8676', 'T-01')

    expect(bind(root, 'session-8676', '')).toMatchObject({ kind: 'error' })
    expect(bind(root, 'session-8676', 'T-99')).toMatchObject({ kind: 'error' })
    expect(wrongId.kind === 'error' && wrongId.text).toContain('非法的任务编号')
    expect(noSpec.kind === 'error' && noSpec.text).toContain('还没有 .spec 规格库')
  })

  it('tasks 目录里有读不懂的文件时报错，不静默成功', () => {
    const root = makeSpec()
    writeFileSync(taskPath(root, 'T-09'), 'id: [broken\n', 'utf8')

    const result = bind(root, 'session-8676', 'T-09')

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.text).toContain('读不懂')
  })
})
