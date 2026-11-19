/**
 * 人机命令 `requirement_approve`：人确认需求，把状态从 `draft` 写成 `confirmed`。
 *
 * 为什么单独一条命令、不让 `requirement_draft` 顺带写：起草与确认是两件事——正文写得再细，
 * 确认与否是人的决定。与 `contract_sign`、`proposal_approve` 同一档纪律。
 *
 * 过审门槛：至少一轮评审，且所有轮次都已处置（采纳或放弃）——未决轮次要先由人
 * 「采纳并修改需求」或「放弃本轮意见」；当前正文有对应版本快照。有 `.spec/flow.yaml` 时
 * 再加一条——review 节点按配置顺序逐条目消费评审轮：条目的根（内置 preset 的
 * 角色或名册岗位的 inherits）须等于该轮署名 preset 的内置根，一轮只消费给一个
 * 条目；旧式无署名轮不可消费。过审时写 `approved_at` 与
 * `approved_version`，把「人确认的是哪一版正文」钉在 YAML 里。
 *
 * 只做这一条边。发布与关闭各有自己的前置条件，另起两条命令，失败分得清。
 *
 * 与 `contract_sign` 同档：人机命令，不进任何角色或状态的工具面。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { flowConfigPath, loadFlowConfig, missingReviewSignatures } from '../kernel/flow-config.js'
import { approveRequirement, assertRequirementId, loadRequirement, readRequirementDocument, requirementDocPath, requirementPath } from '../kernel/requirement-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface RequirementApproveInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type RequirementApproveResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface RequirementApproveDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: RequirementApproveInvocation) => RequirementApproveResult
}

/**
 * 建 `requirement_approve` 命令定义。
 * @param rootInput - 规格根解析，与工具和其它命令共用同一条会话来源。
 * @param now - 确认时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createRequirementApproveCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): RequirementApproveDefinition {
  return {
    name: 'requirement_approve',
    description: '确认一条起草态需求，把状态从起草改为已确认（要求正文已存在、至少一轮评审且全部已处置；有流程配置时评审节点按根匹配一轮一岗配齐）',
    input: { hint: '<需求编号>' },
    handler: invocation => approve(rootInput, invocation, now),
  }
}

function approve(
  rootInput: RootInput,
  invocation: RequirementApproveInvocation,
  now: () => string,
): RequirementApproveResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要需求编号，例如 /requirement_approve REQ-01' }

  let id: string
  try {
    id = assertRequirementId(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可确认的需求` }
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

  if (requirement.state !== 'draft') {
    return {
      kind: 'error',
      text: `${id} 现在在「${requirement.state}」，只有起草态才需要确认；要改结论由人直接编辑 ${requirementPath(root, id)}`,
    }
  }

  if (readRequirementDocument(root, id) === undefined) {
    return {
      kind: 'error',
      text: `${id} 还没有正文（${requirementDocPath(root, id)} 不存在或为空）；先把正文写进去再确认`,
    }
  }

  if (requirement.reviews.length === 0) {
    return {
      kind: 'error',
      text: `${id} 还没有评审记录；过审前至少要有 1 轮评审（由项目经理用 requirement_review_draft 落报告）`,
    }
  }

  const pending = requirement.reviews
    .filter(review => review.decision === undefined || review.decision === 'pending')
    .sort((left, right) => left.round - right.round)
  if (pending.length > 0) {
    const rounds = pending.map(review => `R${String(review.round)}`).join('、')
    return {
      kind: 'error',
      text: `${id} 尚有未处理的评审（${rounds}），请先「采纳并修改需求」或「放弃本轮意见」后再确认定稿`,
    }
  }

  let flow
  try {
    flow = loadFlowConfig(root)
  } catch (error: unknown) {
    return { kind: 'error', text: `读流程配置失败（${flowConfigPath(root)}）：${errorMessage(error)}` }
  }
  if (flow.source === 'file') {
    const missing = missingReviewSignatures(root, flow.config, requirement.reviews)
    if (missing.length > 0) {
      return {
        kind: 'error',
        text: `${id} 的评审还没配齐：流程配置要求岗位 ${missing.join('、')} 各消费一轮根匹配的署名评审（一轮只算一个岗位），现在还没有；先让对应岗位完成评审再过审`,
      }
    }
  }

  const at = now()
  let approved
  try {
    approved = approveRequirement(root, id, at)
  } catch (error: unknown) {
    return { kind: 'error', text: `${id} 确认失败：${errorMessage(error)}` }
  }

  return {
    kind: 'success',
    text: `${id}「${requirement.title}」已确认（${at}），批准版本 v${String(approved.approvedVersion)}，共 ${String(requirement.reviews.length)} 轮评审。可以按推荐拆任务，拆出来的任务把 requirement 填成 ${id}。`,
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
