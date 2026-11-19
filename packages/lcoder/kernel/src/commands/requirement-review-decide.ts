/**
 * 人机命令 `requirement_review_decide`：人处置一条需求某轮评审的意见。
 *
 * 评审报告由模型落盘，处置由人拍板：采纳意味着「采纳并修改需求」产出新版本，
 * 放弃意味着本轮意见不再追究。两种决定都写进该轮记录，决定之后才允许发起下一轮评审，
 * 避免报告没改就再评一轮。与 `requirement_approve` 同档：只进命令面，不进任何角色工具面。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertRequirementId, decideRequirementReview, loadRequirement, requirementPath } from '../kernel/requirement-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface RequirementReviewDecideInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type RequirementReviewDecideResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface RequirementReviewDecideDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: RequirementReviewDecideInvocation) => RequirementReviewDecideResult
}

/**
 * 建 `requirement_review_decide` 命令定义。
 * @param rootInput - 规格根解析，与工具和其它命令共用同一条会话来源。
 * @param now - 处置时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createRequirementReviewDecideCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): RequirementReviewDecideDefinition {
  return {
    name: 'requirement_review_decide',
    description: '处置一条需求某轮评审：标记采纳并关联改稿后的正文版本，或放弃本轮意见；决定后才可以发起下一轮评审',
    input: { hint: '<需求编号> <轮次> <accepted|rejected> [备注]' },
    handler: invocation => decide(rootInput, invocation, now),
  }
}

/** 命令参数：需求编号、轮次、决定与可选备注。 */
interface ParsedInput {
  readonly id: string
  readonly round: number
  readonly decision: 'accepted' | 'rejected'
  readonly note?: string
}

function parse(rawInput: string): ParsedInput | string {
  const parts = rawInput.trim().split(/\s+/)
  const idToken = parts[0]
  const roundToken = parts[1]
  const decisionToken = parts[2]
  if (idToken === undefined || roundToken === undefined || decisionToken === undefined) {
    return '需要需求编号、轮次与决定，例如 /requirement_review_decide REQ-01 1 accepted 采纳建议'
  }
  const noteParts = parts.slice(3)
  let id: string
  try {
    id = assertRequirementId(idToken)
  } catch (error: unknown) {
    return errorMessage(error)
  }
  if (!/^\d+$/.test(roundToken) || Number.parseInt(roundToken, 10) <= 0) {
    return `轮次必须是正整数，收到的是「${roundToken}」`
  }
  if (decisionToken !== 'accepted' && decisionToken !== 'rejected') {
    return `决定只能是 accepted 或 rejected，收到的是「${decisionToken}」`
  }
  const note = noteParts.join(' ').trim()
  return {
    id,
    round: Number.parseInt(roundToken, 10),
    decision: decisionToken,
    ...(note === '' ? {} : { note }),
  }
}

function decide(
  rootInput: RootInput,
  invocation: RequirementReviewDecideInvocation,
  now: () => string,
): RequirementReviewDecideResult {
  const parsed = parse(invocation.rawInput)
  if (typeof parsed === 'string') return { kind: 'error', text: parsed }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可处置的评审` }
  }

  let requirement
  try {
    requirement = loadRequirement(root, parsed.id)
  } catch (error: unknown) {
    return {
      kind: 'error',
      text: `读不到需求 ${parsed.id}（${requirementPath(root, parsed.id)}）：${errorMessage(error)}`,
    }
  }

  if (requirement.state !== 'draft') {
    return {
      kind: 'error',
      text: `${parsed.id} 现在在「${requirement.state}」，只有起草态才需要处置评审`,
    }
  }
  if (!requirement.reviews.some(review => review.round === parsed.round)) {
    return {
      kind: 'error',
      text: `${parsed.id} 没有第 ${String(parsed.round)} 轮评审；现有轮次：${requirement.reviews.map(review => `R${String(review.round)}`).join('、') || '无'}`,
    }
  }

  const at = now()
  let result
  try {
    result = decideRequirementReview(root, parsed.id, {
      round: parsed.round,
      decision: parsed.decision,
      at,
      ...(parsed.note === undefined ? {} : { note: parsed.note }),
    })
  } catch (error: unknown) {
    return { kind: 'error', text: `${parsed.id} 处置第 ${String(parsed.round)} 轮评审失败：${errorMessage(error)}` }
  }

  const decisionText = result.decision === 'accepted' ? '采纳' : '放弃'
  return {
    kind: 'success',
    text: `${parsed.id} 第 ${String(result.round)} 轮评审已标为${decisionText}（${at}）${result.appliedVersion === undefined ? '' : `，关联正文 v${String(result.appliedVersion)}`}。${result.decision === 'accepted' ? '正文已按本轮意见改稿，可以发起下一轮评审。' : '本轮意见已放弃，可以发起下一轮评审。'}`,
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
