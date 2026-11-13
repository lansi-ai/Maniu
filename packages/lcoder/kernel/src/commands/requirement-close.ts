/**
 * 人机命令 `requirement_close`：人取消一条还没上线的需求，把状态写成 `closed`。
 *
 * `closed` 表示「这条需求不做/被放弃」，所以只对 `draft` 与 `confirmed` 开放。
 * `released` 是已上线的终态，不再关闭——否则要么丢掉「上线过」这一事实，
 * 要么得为一个关闭原因扩出一个新字段和一套参数解析。关闭原因如果需要记录，
 * 写在需求正文里，而不是悄悄塞进状态字段。
 *
 * 与 `contract_sign` 同档：人机命令，不进任何角色或状态的工具面。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertRequirementId, loadRequirement, requirementPath, saveRequirement } from '../kernel/requirement-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface RequirementCloseInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type RequirementCloseResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface RequirementCloseDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: RequirementCloseInvocation) => RequirementCloseResult
}

/**
 * 建 `requirement_close` 命令定义。
 * @param rootInput - 规格根解析，与工具和其它命令共用同一条会话来源。
 * @param now - 关闭时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createRequirementCloseCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): RequirementCloseDefinition {
  return {
    name: 'requirement_close',
    description: '取消一条还没上线的需求（起草或已确认），把状态改为已关闭',
    input: { hint: '<需求编号>' },
    handler: invocation => close(rootInput, invocation, now),
  }
}

function close(
  rootInput: RootInput,
  invocation: RequirementCloseInvocation,
  now: () => string,
): RequirementCloseResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要需求编号，例如 /requirement_close REQ-01' }

  let id: string
  try {
    id = assertRequirementId(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可关闭的需求` }
  }

  let requirement
  try {
    requirement = loadRequirement(root, id)
  } catch (error: unknown) {
    return {
      kind: 'error',
      text: `读不到需求 ${id}（${requirementPath(root, id)}）：${errorMessage(error)}`,
    }
  }

  if (requirement.state === 'closed') {
    return { kind: 'error', text: `${id} 已经是「已关闭」，不需要重复关闭` }
  }
  if (requirement.state === 'released') {
    return {
      kind: 'error',
      text: `${id} 已上线，是终态，不再关闭；要记录后续变更请另开一条需求`,
    }
  }

  const at = now()
  saveRequirement(root, { ...requirement, state: 'closed', closed_at: at })

  return {
    kind: 'success',
    text: `${id}「${requirement.title}」已关闭（${at}）。`,
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
