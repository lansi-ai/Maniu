/**
 * 人机命令 `proposal_reject`：人驳回某个方案，把决定态从 `draft` 写成 `rejected`。
 *
 * 只写提案的决定态与结论时刻：带 `requirement_change` 载荷的提案被驳回时需求本体一个字都不动。
 * 与 `/proposal_approve` 同档：人机命令，不进任何角色或状态的工具面。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertProposalId, listProposals, loadProposal, proposalPath, saveProposal } from '../kernel/proposal-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface ProposalRejectInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type ProposalRejectResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface ProposalRejectDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: ProposalRejectInvocation) => ProposalRejectResult
}

/**
 * 建 `proposal_reject` 命令定义。
 * @param rootInput - 规格根解析，与工具和其它命令共用同一条会话来源。
 * @param now - 结论时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createProposalRejectCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): ProposalRejectDefinition {
  return {
    name: 'proposal_reject',
    description: '驳回某个方案；带需求变更载荷的提案被驳回时需求本体不动',
    input: { hint: '<方案编号>' },
    handler: invocation => reject(rootInput, invocation, now),
  }
}

function reject(rootInput: RootInput, invocation: ProposalRejectInvocation, now: () => string): ProposalRejectResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要方案编号，例如 /proposal_reject P-01' }

  let id: string
  try {
    id = assertProposalId(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可驳回的方案` }
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
      text: `${id} 的决定态已经是「${proposal.decision}」，不需要重复驳回；要改结论由人直接编辑 ${proposalPath(root, id)}`,
    }
  }

  const at = now()
  saveProposal(root, { ...proposal, decision: 'rejected', decided_at: at })

  return {
    kind: 'success',
    text: `${id}「${proposal.title}」已驳回（${at}）。需求本体没有改动；要再议由人把决定态退回 draft 或另立新提案。`,
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
