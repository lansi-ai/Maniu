/**
 * 人机命令 `role_upsert`：在「办公室」页面中新增或派生一个项目成员到 `.spec/roles.yaml`。
 *
 * 参数为一行 JSON：`{"id":"pm-jason","name":"项目经理-Jason","inherits":"pm","derived_from":"慢牛项目经理","persona":"..."}`。
 * 若省略 `id` 或需校验，均由 `upsertRole` / `JobRole` schema 严格把关。
 */
import { z } from 'zod'
import { upsertRole } from '../kernel/role-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { BUILTIN_ROLES, isBuiltinRole } from '../schema/roles.js'
import { JobRoleId } from '../schema/spec.js'

/** 一次人机命令调用里 kernel 用到的部分。 */
export interface RoleUpsertInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果。 */
export type RoleUpsertResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义。 */
export interface RoleUpsertDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: RoleUpsertInvocation) => RoleUpsertResult
}

const RoleUpsertPayload = z.object({
  id: JobRoleId,
  name: z.string().trim().min(1),
  inherits: z.string().trim().min(1),
  persona: z.string().trim().optional(),
  derived_from: z.string().trim().optional(),
})

/**
 * 建 `role_upsert` 命令定义。
 * @param rootInput - 规格根解析。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createRoleUpsertCommand(rootInput: RootInput): RoleUpsertDefinition {
  return {
    name: 'role_upsert',
    description: '新增或派生一个项目成员到 .spec/roles.yaml（人机命令）',
    input: { hint: '<JSON>' },
    handler: invocation => runUpsert(rootInput, invocation),
  }
}

function runUpsert(rootInput: RootInput, invocation: RoleUpsertInvocation): RoleUpsertResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要成员 JSON 参数' }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: `成员参数不是合法 JSON：${errorMessage(error)}` }
  }

  const checked = RoleUpsertPayload.safeParse(parsedJson)
  if (!checked.success) {
    return { kind: 'error', text: checked.error.issues[0]?.message ?? '成员参数格式不正确' }
  }

  const { id, name, inherits, persona, derived_from: derivedFrom } = checked.data
  if (isBuiltinRole(id)) {
    return { kind: 'error', text: `成员编号 ${id} 与系统内置角色重名，请换一个编号` }
  }
  if (!isBuiltinRole(inherits)) {
    return { kind: 'error', text: `inherits 只接受内置角色（${BUILTIN_ROLES.join(' / ')}），收到 ${inherits}` }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），无法写入成员` }
  }

  try {
    upsertRole(root, {
      id,
      name,
      inherits,
      ...(persona === undefined || persona === '' ? {} : { persona }),
      ...(derivedFrom === undefined || derivedFrom === '' ? {} : { derived_from: derivedFrom }),
    })
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  return { kind: 'success', text: `已将「${name}」（${id}）加入本项目办公室。` }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
