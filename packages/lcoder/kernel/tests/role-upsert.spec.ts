import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createRoleUpsertCommand } from '../src/commands/role-upsert.js'
import { loadRoles } from '../src/kernel/role-store.js'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeSpec(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lcoder-role-upsert-'))
  dirs.push(dir)
  const spec = join(dir, '.spec')
  mkdirSync(spec, { recursive: true })
  writeFileSync(join(spec, 'project.yaml'), 'id: demo\nname: Demo\n', 'utf8')
  return spec
}

describe('role_upsert 命令', () => {
  it('新增派生项目成员并把 derived_from 与中文名写入 .spec/roles.yaml', () => {
    const spec = makeSpec()
    const cmd = createRoleUpsertCommand(spec)
    const result = cmd.handler({
      rawInput: JSON.stringify({
        id: 'pm-jason',
        name: '项目经理-Jason',
        inherits: 'pm',
        derived_from: '慢牛项目经理',
        persona: '负责拆解需求与协调排期。',
      }),
    })
    expect(result).toEqual({
      kind: 'success',
      text: '已将「项目经理-Jason」（pm-jason）加入本项目办公室。',
    })

    const roles = loadRoles(spec)
    expect(roles).toEqual([
      {
        id: 'pm-jason',
        name: '项目经理-Jason',
        inherits: 'pm',
        derived_from: '慢牛项目经理',
        persona: '负责拆解需求与协调排期。',
      },
    ])
  })

  it('拒绝与内置角色重名或未知 inherits', () => {
    const spec = makeSpec()
    const cmd = createRoleUpsertCommand(spec)
    expect(cmd.handler({
      rawInput: JSON.stringify({ id: 'dev', name: '开发', inherits: 'dev' }),
    })).toEqual({
      kind: 'error',
      text: '岗位 id 不能与内置角色同名',
    })
    expect(cmd.handler({
      rawInput: JSON.stringify({ id: 'pm-jason', name: 'Jason', inherits: 'unknown-role' }),
    }).kind).toBe('error')
  })
})
