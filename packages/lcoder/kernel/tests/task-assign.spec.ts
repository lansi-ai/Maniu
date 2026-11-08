/**
 * 人机命令 `task_assign` 的行为测：正常分配写回 `role`、任务不存在与岗位不存在都是人话错误，
 * 且任务状态在任何一支上都不被改动。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createTaskAssignCommand } from '../src/commands/task-assign.js'
import type { AssignCommandResult } from '../src/commands/task-assign.js'
import { saveRoles } from '../src/kernel/role-store.js'
import { openTask, saveTask, taskPath } from '../src/kernel/task-store.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const AT = '2026-11-08T10:00:00+08:00'

/** 一个带一条任务与一份名册的临时规格根。 */
function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-assign-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  saveTask(root, openTask({ id: 'T-01', title: '结算页', grade: 'B', opened_at: AT }))
  saveRoles(root, [
    { id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' },
    { id: 'python-engineer', name: 'Python 工程师', inherits: 'dev' },
  ])
  return root
}

function fieldsOf(root: string, id: string): Record<string, unknown> {
  return parseYaml(readFileSync(taskPath(root, id), 'utf8')) as Record<string, unknown>
}

function assign(root: string, rawInput: string): AssignCommandResult {
  return createTaskAssignCommand(root).handler({ rawInput })
}

describe('task_assign 分配岗位', () => {
  it('把岗位 id 写回任务，状态不动，回执点名岗位与继承角色', () => {
    const root = makeSpec()

    const result = assign(root, 'T-01 vue-engineer')

    expect(result.kind).toBe('success')
    expect(result.kind === 'success' && result.text).toContain('Vue 工程师')
    expect(result.kind === 'success' && result.text).toContain('继承角色 dev')
    expect(fieldsOf(root, 'T-01').role).toBe('vue-engineer')
    expect(fieldsOf(root, 'T-01').state).toBe('drafting')
  })

  it('重复分配同一个岗位是幂等的，不重写文件', () => {
    const root = makeSpec()
    assign(root, 'T-01 vue-engineer')

    const again = assign(root, 'T-01 vue-engineer')

    expect(again.kind === 'success' && again.text).toContain('无需重复分配')
  })

  it('内置角色也能分配', () => {
    const root = makeSpec()

    const result = assign(root, 'T-01 manager')

    expect(result.kind).toBe('success')
    expect(fieldsOf(root, 'T-01').role).toBe('manager')
  })

  it('任务不存在是人话错误，不写任何任务', () => {
    const root = makeSpec()

    const result = assign(root, 'T-99 vue-engineer')

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.text).toContain('找不到 T-99')
    expect('role' in fieldsOf(root, 'T-01')).toBe(false)
  })

  it('岗位不存在时拒绝，并指出名册与内置角色都没有这个名字', () => {
    const root = makeSpec()

    const result = assign(root, 'T-01 ghost-role')

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.text).toContain('岗位 ghost-role 不认识')
    expect(result.kind === 'error' && result.text).toContain('内置角色')
    expect('role' in fieldsOf(root, 'T-01')).toBe(false)
  })

  it('缺参数与非法任务编号都当场说清', () => {
    const root = makeSpec()

    expect(assign(root, '')).toMatchObject({ kind: 'error' })
    expect(assign(root, 'T-01')).toMatchObject({ kind: 'error' })
    expect(assign(root, 't-01 vue-engineer')).toMatchObject({ kind: 'error' })
  })
})
