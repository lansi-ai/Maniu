/**
 * 人机命令 `requirement_release`：人确认需求已经上线，把状态从 `confirmed` 写成 `released`。
 *
 * 发布是「需求真的交付了」的结论，所以不只看状态：必须至少有一条回指它的任务，
 * 且这些任务全部收口。少了任务就是没拆过；还有未关闭任务就是没交付完——两种都如实报出来。
 *
 * 与 `contract_sign` 同档：人机命令，不进任何角色或状态的工具面。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertRequirementId, loadRequirement, requirementPath, saveRequirement } from '../kernel/requirement-store.js'
import { listTasks } from '../kernel/task-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface RequirementReleaseInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type RequirementReleaseResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface RequirementReleaseDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: RequirementReleaseInvocation) => RequirementReleaseResult
}

/**
 * 建 `requirement_release` 命令定义。
 * @param rootInput - 规格根解析，与工具和其它命令共用同一条会话来源。
 * @param now - 发布时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createRequirementReleaseCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): RequirementReleaseDefinition {
  return {
    name: 'requirement_release',
    description: '把已确认需求标为已上线：要求至少一条关联任务且全部收口',
    input: { hint: '<需求编号>' },
    handler: invocation => release(rootInput, invocation, now),
  }
}

function release(
  rootInput: RootInput,
  invocation: RequirementReleaseInvocation,
  now: () => string,
): RequirementReleaseResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要需求编号，例如 /requirement_release REQ-01' }

  let id: string
  try {
    id = assertRequirementId(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可发布的需求` }
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

  if (requirement.state !== 'confirmed') {
    return {
      kind: 'error',
      text: `${id} 现在在「${requirement.state}」，只有已确认的需求才能发布`,
    }
  }

  const related = listTasks(root).filter(task => task.requirement === id)
  if (related.length === 0) {
    return {
      kind: 'error',
      text: `${id} 还没有关联任务；先用 task_draft 拆任务并把 requirement 填成 ${id}`,
    }
  }

  const unclosed = related.filter(task => task.state !== 'closed')
  if (unclosed.length > 0) {
    return {
      kind: 'error',
      text: `${id} 还有未关闭任务：${unclosed.map(task => `${task.id}（${task.state}）`).join('、')}；全部收口后才能发布`,
    }
  }

  const at = now()
  saveRequirement(root, { ...requirement, state: 'released', released_at: at })

  return {
    kind: 'success',
    text: `${id}「${requirement.title}」已标为已上线（${at}），关联任务 ${String(related.length)} 条全部收口。`,
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
