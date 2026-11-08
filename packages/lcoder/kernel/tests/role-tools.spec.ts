/**
 * `role_draft` 的行为测：模型只能追加或更新岗位、继承不合法当场拒、内置角色名不可占用。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { loadRoles } from '../src/kernel/role-store.js'
import { createRoleTools } from '../src/tools/role-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-role-tools-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'tasks'), { recursive: true })
  return root
}

function draft(specRoot: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = createRoleTools(specRoot).find(t => t.name === 'role_draft')
  if (tool === undefined) throw new Error('没有 role_draft 工具')
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

describe('role_draft 岗位名册', () => {
  it('追加一个岗位并写进名册', async () => {
    const spec = makeSpec()

    const result = await draft(spec, { id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' })

    expect((result.role as { id: string }).id).toBe('vue-engineer')
    expect(result.roles).toBe(1)
    expect(loadRoles(spec)).toEqual([{ id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' }])
  })

  it('更新已有岗位时保留其它岗位，不删除任何一项', async () => {
    const spec = makeSpec()
    await draft(spec, { id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' })
    await draft(spec, { id: 'python-engineer', name: 'Python 工程师', inherits: 'dev' })

    await draft(spec, { id: 'vue-engineer', name: '前端工程师', inherits: 'pm' })

    expect(loadRoles(spec).map(role => [role.id, role.name, role.inherits])).toEqual([
      ['vue-engineer', '前端工程师', 'pm'],
      ['python-engineer', 'Python 工程师', 'dev'],
    ])
  })

  it('继承不合法或占用内置角色名都当场拒，名册不变', async () => {
    const spec = makeSpec()

    await expect(draft(spec, { id: 'wizard', name: '法师', inherits: 'wizard' })).rejects.toThrow(/内置角色/)
    await expect(draft(spec, { id: 'dev', name: '开发', inherits: 'dev' })).rejects.toThrow(/同名/)

    expect(loadRoles(spec)).toEqual([])
  })
})
