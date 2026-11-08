/**
 * `.spec/roles.yaml` 的读写口：岗位名册的唯一落盘实现。
 *
 * 三条边界：
 *   1. **缺文件是空名册，不是故障。** 没有自定岗位的项目照常跑；只有写岗位时才创建文件。
 *   2. **同名 id 只能有一个天花板。** schema 在解析时判重，写回前再走一遍 schema。
 *   3. **不删除。** `role_draft` 只能追加或更新一项；删岗位会让已有任务的 `role`
 *      变成未知岗位，这件事留给以后明确的人工流程。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { RolesFile } from '../schema/spec.js'
import type { JobRole } from '../schema/spec.js'
import { isBuiltinRole } from '../schema/roles.js'
import type { BuiltinRoleId } from '../schema/roles.js'

/** 名册相对规格根的位置。 */
export const ROLES_FILE = 'roles.yaml'

/**
 * 名册文件路径。
 * @param root - 规格根（`.spec`）。
 * @returns 名册的绝对或相对路径。
 */
export function rolesPath(root: string): string {
  return join(root, ROLES_FILE)
}

/**
 * 读名册。文件不存在时返回空数组；文件存在但读不懂时抛出。
 * @param root - 规格根（`.spec`）。
 * @returns 岗位清单，按文件顺序。
 */
export function loadRoles(root: string): JobRole[] {
  const path = rolesPath(root)
  if (!existsSync(path)) return []
  const doc: unknown = parseYaml(readFileSync(path, 'utf8'))
  // 空 YAML 文档等价于空名册；写坏的形状仍按 schema 报错。
  return RolesFile.parse(doc ?? {}).roles
}

/**
 * 写名册：先按 schema 校验，再整文件落盘。
 * @param root - 规格根（`.spec`）。
 * @param roles - 完整岗位清单。
 * @returns 写入的路径。
 */
export function saveRoles(root: string, roles: readonly JobRole[]): string {
  const path = rolesPath(root)
  writeFileSync(path, stringifyYaml(RolesFile.parse({ roles })), 'utf8')
  return path
}

/**
 * 岗位解析结果：名册里的自定岗位，或一个内置角色。
 * 名册优先——同 id 不可能与内置角色并存（schema 拒绝），这里只是把优先级写清。
 */
export type RoleResolution =
  | { readonly kind: 'job'; readonly role: JobRole }
  | { readonly kind: 'builtin'; readonly id: BuiltinRoleId }

/**
 * 按 id 解析岗位：名册优先，其次内置角色。
 * @param root - 规格根（`.spec`）。
 * @param id - 任务要分配的岗位 id。
 * @returns 解析结果；两边都不认识时为 undefined。
 */
export function resolveRole(root: string, id: string): RoleResolution | undefined {
  const role = loadRoles(root).find(entry => entry.id === id)
  if (role !== undefined) return { kind: 'job', role }
  return isBuiltinRole(id) ? { kind: 'builtin', id } : undefined
}

/** 追加或更新一项岗位所需的字段。 */
export interface RoleUpsert {
  readonly id: string
  readonly name: string
  readonly inherits: JobRole['inherits']
  readonly persona?: string
}

/**
 * 追加或更新一项岗位，返回写回后的完整名册。
 *
 * 已存在的 id 原地更新字段，顺序不变；新 id 追加到末尾。已有岗位不会因为这次更新
 * 而消失——这是「不允许删除」的落点。
 * @param root - 规格根（`.spec`）。
 * @param input - 要写入的岗位字段。
 * @returns 写盘后的岗位清单与文件路径。
 */
export function upsertRole(root: string, input: RoleUpsert): { readonly roles: JobRole[]; readonly path: string } {
  const current = loadRoles(root)
  const next = current.some(entry => entry.id === input.id)
    ? current.map(entry => (entry.id === input.id ? input : entry))
    : [...current, input]
  const parsed = RolesFile.parse({ roles: next }).roles
  return { roles: parsed, path: saveRoles(root, parsed) }
}
