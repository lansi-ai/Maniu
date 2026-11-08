/**
 * 岗位名册的行为测：schema 只拦形状，这里钉住四条边界——合法名册能读、未知继承当场拒、
 * 重复 id 当场拒、缺文件是空名册；另加任务上的 `role` 读写往返与未知 id 容忍。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { loadRoles, resolveRole, rolesPath, saveRoles, upsertRole } from '../src/kernel/role-store.js'
import { listTasks, loadTask, openTask, saveTask } from '../src/kernel/task-store.js'
import { Task } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const AT = '2026-11-08T10:00:00+08:00'

/** 一个带 `.spec/tasks/` 的临时规格根。 */
function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-roles-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  return root
}

describe('岗位名册', () => {
  it('合法名册能读，缺文件是空名册而不是故障', () => {
    const root = makeSpec()
    expect(loadRoles(root)).toEqual([])

    saveRoles(root, [
      { id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev', persona: '先核对交互口径。' },
      { id: 'dotnet-engineer', name: '.NET 工程师', inherits: 'manager' },
    ])

    expect(loadRoles(root)).toEqual([
      { id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev', persona: '先核对交互口径。' },
      { id: 'dotnet-engineer', name: '.NET 工程师', inherits: 'manager' },
    ])
  })

  it('继承一个不认识的内置角色当场拒，且不覆盖原文件', () => {
    const root = makeSpec()
    saveRoles(root, [{ id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' }])

    expect(() => saveRoles(root, [{ id: 'wizard', name: '法师', inherits: 'wizard' } as never])).toThrow()

    expect(loadRoles(root)).toEqual([{ id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' }])
  })

  it('同一个 id 出现两次当场拒：两个天花板就没有唯一答案', () => {
    const root = makeSpec()
    writeFileSync(
      rolesPath(root),
      [
        'roles:',
        '  - id: vue-engineer',
        '    name: Vue 工程师',
        '    inherits: dev',
        '  - id: vue-engineer',
        '    name: 另一个 Vue 工程师',
        '    inherits: review',
        '',
      ].join('\n'),
      'utf8',
    )

    expect(() => loadRoles(root)).toThrow(/岗位 id 重复/)
  })

  it('岗位 id 不能占用内置角色名，名册优先的说法才不会有歧义', () => {
    const root = makeSpec()
    expect(() => saveRoles(root, [{ id: 'dev', name: '开发', inherits: 'dev' }])).toThrow()
  })

  it('解析名册优先、其次内置角色，两边都不认识返回 undefined', () => {
    const root = makeSpec()
    saveRoles(root, [{ id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' }])

    expect(resolveRole(root, 'vue-engineer')?.kind).toBe('job')
    expect(resolveRole(root, 'manager')).toEqual({ kind: 'builtin', id: 'manager' })
    expect(resolveRole(root, 'ghost')).toBeUndefined()
  })

  it('更新一项岗位不丢其它岗位，也不改变顺序', () => {
    const root = makeSpec()
    saveRoles(root, [
      { id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' },
      { id: 'python-engineer', name: 'Python 工程师', inherits: 'dev' },
    ])

    const written = upsertRole(root, { id: 'vue-engineer', name: '前端工程师', inherits: 'pm' })

    expect(written.roles.map(role => [role.id, role.name, role.inherits])).toEqual([
      ['vue-engineer', '前端工程师', 'pm'],
      ['python-engineer', 'Python 工程师', 'dev'],
    ])
  })
})

describe('任务上的角色', () => {
  it('role 写入后能原样读回，状态不变', () => {
    const root = makeSpec()
    saveTask(root, openTask({ id: 'T-01', title: '首页', grade: 'B', opened_at: AT }))

    const task = loadTask(root, 'T-01')
    saveTask(root, Task.parse({ ...task, role: 'vue-engineer' }))

    const stored = loadTask(root, 'T-01')
    expect(stored.role).toBe('vue-engineer')
    expect(stored.state).toBe('drafting')
  })

  it('名册里不存在的 role 照样读得懂：未知岗位由界面显示，不报故障', () => {
    const root = makeSpec()
    saveTask(root, Task.parse({
      id: 'T-01',
      title: '首页',
      grade: 'B',
      state: 'drafting',
      role: 'ghost-role',
      opened_at: AT,
    }))

    expect(listTasks(root).map(task => task.role)).toEqual(['ghost-role'])
    expect(loadTask(root, 'T-01').title).toBe('首页')
    expect(resolveRole(root, 'ghost-role')).toBeUndefined()
  })
})
