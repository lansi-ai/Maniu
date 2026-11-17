/**
 * 人设与角色工具白名单的同步测试：装配补丁里每个内置角色 preset 的人设
 * 必须提及该角色被允许使用的全部工具，新增工具后忘记改人设会在这里红。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { ROLE_TOOLS, ROLES, parseRole } from '../src/kernel/surface.js'
import type { RoleId } from '../src/kernel/surface.js'

const PROFILE = readFileSync(new URL('../../../../lcoder/desktop-profile.patch.yml', import.meta.url), 'utf8')

/** 一个 preset 的人设事实：角色、人设前缀与 preset 编号。 */
interface PersonaPair {
  readonly presetId: string
  readonly role: RoleId
  readonly prefix: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 在子树里找 kernel 插件行配置的角色名；找不到返回 undefined。 */
function roleIn(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = roleIn(entry)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (value.name === '@maniu/kernel' && isRecord(value.config) && typeof value.config.role === 'string') {
    return value.config.role
  }
  for (const nested of Object.values(value)) {
    const found = roleIn(nested)
    if (found !== undefined) return found
  }
  return undefined
}

/** 在子树里找 persona 插件行的提示词前缀；找不到返回 undefined。 */
function prefixIn(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = prefixIn(entry)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (value.name === '@deepseek-ai/dsh-persona' && isRecord(value.config) && typeof value.config.prefix === 'string') {
    return value.config.prefix
  }
  for (const nested of Object.values(value)) {
    const found = prefixIn(nested)
    if (found !== undefined) return found
  }
  return undefined
}

/** 遍历整份补丁，收集同时带角色与人设的 preset；人设可能挂在隔离组里，所以按子树找。 */
function collectPairs(value: unknown, out: PersonaPair[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectPairs(entry, out)
    return
  }
  if (!isRecord(value)) return
  if (typeof value.id === 'string' && Array.isArray(value.plugins)) {
    const role = roleIn(value.plugins)
    const prefix = prefixIn(value.plugins)
    const parsed = role === undefined ? null : parseRole(role)
    if (parsed !== null && prefix !== undefined && prefix.trim() !== '') {
      out.push({ presetId: value.id, role: parsed, prefix })
    }
  }
  for (const nested of Object.values(value)) collectPairs(nested, out)
}

describe('人设与工具白名单同步', () => {
  const pairs: PersonaPair[] = []
  collectPairs(parse(PROFILE), pairs)

  it('十个内置角色 preset 各带一份人设', () => {
    expect(pairs.length).toBe(ROLES.length)
    expect([...pairs.map(pair => pair.role)].sort()).toEqual([...ROLES].sort())
  })

  it.each(pairs.map(pair => [pair.presetId, pair] as const))('%s 的人设提及白名单内的全部工具', (_presetId, pair) => {
    for (const tool of ROLE_TOOLS[pair.role]) {
      expect(pair.prefix, `${pair.presetId} 人设缺工具 ${tool}`).toContain(tool)
    }
  })

  it.each(pairs.map(pair => [pair.presetId, pair] as const))('%s 的人设不用天花板比喻', (_presetId, pair) => {
    expect(pair.prefix).not.toContain('天花板')
  })
})
