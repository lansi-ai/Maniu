/**
 * 人机命令 `proposal_approve`：人确认采纳某个方案，把决定态从 `draft` 写成 `approved`。
 *
 * 为什么单独一条命令、不让 `proposal_draft` 顺带写：出方案与拍板是两件事——方案写得再好，
 * 采纳与否是人的决定。与 `contract_draft` 和 `contract_sign` 的分工同构，也让失败分得清。
 *
 * 只做批准这一条。驳回收回由人改 `decision: rejected`——把「驳回」也做成命令，
 * 就等于把方案的决定态从「人写的一个字段」扩成「一张命令表」，收不回来。
 *
 * 与 `contract_sign` 同档：人机命令，不进任何角色或状态的工具面。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertProposalId, listProposals, loadProposal, proposalPath, saveProposal } from '../kernel/proposal-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface ProposalApproveInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type ProposalApproveResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface ProposalApproveDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: ProposalApproveInvocation) => ProposalApproveResult
}

/**
 * 建 `proposal_approve` 命令定义。
 * @param rootInput - 规格根解析，与工具和其它命令共用同一条会话来源。
 * @param now - 结论时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createProposalApproveCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): ProposalApproveDefinition {
  return {
    name: 'proposal_approve',
    description: '确认采纳某个方案，把决定态从起草改为已批准',
    input: { hint: '<方案编号>' },
    handler: invocation => approve(rootInput, invocation, now),
  }
}

function approve(rootInput: RootInput, invocation: ProposalApproveInvocation, now: () => string): ProposalApproveResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要方案编号，例如 /proposal_approve P-01' }

  let id: string
  try {
    id = assertProposalId(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可批准的方案` }
  }

  let proposal
  try {
    proposal = loadProposal(root, id)
  } catch (error: unknown) {
    const known = listProposals(root).map(entry => entry.id)
    return {
      kind: 'error',
      text: `读不到方案 ${id}（${proposalPath(root, id)}）：${errorMessage(error)}${known.length === 0 ? '；这个规格里一条方案都没有' : `；已有方案 ${known.join(', ')}`}`,
    }
  }

  if (proposal.decision !== 'draft') {
    return {
      kind: 'error',
      text: `${id} 的决定态已经是「${proposal.decision}」，不需要重复批准；要改结论由人直接编辑 ${proposalPath(root, id)}`,
    }
  }

  const at = now()
  saveProposal(root, { ...proposal, decision: 'approved', decided_at: at })

  return {
    kind: 'success',
    text: `${id}「${proposal.title}」已批准（${at}）。可以按 recommendation 用 task_draft 拆任务了，拆出来的任务把 proposal 填成 ${id}。`,
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
