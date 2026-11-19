/**
 * 人机命令 `proposal_approve`：人确认采纳某个方案，把决定态从 `draft` 写成 `approved`。
 *
 * 为什么单独一条命令、不让 `proposal_draft` 顺带写：出方案与拍板是两件事——方案写得再好，
 * 采纳与否是人的决定。与 `contract_draft` 和 `contract_sign` 的分工同构，也让失败分得清。
 * 驳回走 `/proposal_reject`，同样只由人触发。
 *
 * 带 `requirement_change` 载荷的提案在批准时应用成需求落盘：new 调 `createRequirement`
 * （v1 快照 note 记来源），revise 调 `reviseRequirement`（note 记基线版本）；
 * 需求写成功后提案才转 `approved`，提案写失败时回滚需求改动。
 *
 * 与 `contract_sign` 同档：人机命令，不进任何角色或状态的工具面。
 */
import { rmSync, writeFileSync } from 'node:fs'

import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertProposalId, listProposals, loadProposal, proposalPath, saveProposal } from '../kernel/proposal-store.js'
import {
  createRequirement,
  loadRequirement,
  patchRequirementDraft,
  readRequirementDocument,
  requirementDocPath,
  requirementVersionPath,
  reviseRequirement,
  saveRequirement,
} from '../kernel/requirement-store.js'
import type { Proposal, RequirementChange } from '../schema/spec.js'

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
    description: '确认采纳某个方案；带需求变更载荷的提案会把新需求或改稿落盘',
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
  if (proposal.requirement_change !== undefined) {
    return applyChange(root, proposal, proposal.requirement_change, at)
  }
  saveProposal(root, { ...proposal, decision: 'approved', decided_at: at })

  return {
    kind: 'success',
    text: `${id}「${proposal.title}」已批准（${at}）。可以按 recommendation 用 task_draft 拆任务了，拆出来的任务把 proposal 填成 ${id}。`,
  }
}

/**
 * 应用需求变更提案：先把需求落盘，再把提案写成 approved；提案写失败时回滚需求改动。
 * @param root - 规格根。
 * @param proposal - 起草态且带载荷的提案。
 * @param change - 需求变更载荷。
 * @param at - 结论时刻。
 * @returns 命令结果。
 */
function applyChange(root: string, proposal: Proposal, change: RequirementChange, at: string): ProposalApproveResult {
  const approved: Proposal = { ...proposal, decision: 'approved', decided_at: at }
  if (change.mode === 'patch') {
    return applyPatch(root, proposal, change, approved, at)
  }
  if (change.mode === 'new') {
    const note = change.target !== undefined && change.base_version !== undefined
      ? `基于 ${change.target} v${String(change.base_version)}`
      : '对话新建'
    let draft
    try {
      draft = createRequirement(root, { title: proposal.title, content: change.content, opened_at: at, note })
    } catch (error: unknown) {
      return { kind: 'error', text: `${proposal.id} 的新需求落盘失败：${errorMessage(error)}；提案仍是 draft` }
    }
    try {
      saveProposal(root, approved)
    } catch (error: unknown) {
      return rollbackFailure(proposal.id, error, () => {
        rmSync(draft.yamlPath, { force: true })
        rmSync(draft.documentPath, { force: true })
        rmSync(requirementVersionPath(root, draft.requirement.id, 1), { force: true })
      })
    }
    return {
      kind: 'success',
      text: `${proposal.id}「${proposal.title}」已批准：新需求 ${draft.requirement.id} 已落盘（draft，v1，${note}）。接下来走评审与过审。`,
    }
  }

  let before
  try {
    before = loadRequirement(root, change.target)
  } catch (error: unknown) {
    return { kind: 'error', text: `读不到提案目标 ${change.target}：${errorMessage(error)}；提案仍是 draft` }
  }
  if (before.state !== 'draft') {
    return {
      kind: 'error',
      text: `${change.target} 现在在「${before.state}」，只有起草态需求能应用改稿提案；提案仍是 draft`,
    }
  }
  const beforeDoc = readRequirementDocument(root, change.target)
  const note = `对话改稿，基于 v${String(change.base_version)}`
  let revision
  try {
    revision = reviseRequirement(root, change.target, { content: change.content, at, note })
  } catch (error: unknown) {
    return { kind: 'error', text: `${proposal.id} 的改稿落盘失败：${errorMessage(error)}；提案仍是 draft` }
  }
  try {
    saveProposal(root, approved)
  } catch (error: unknown) {
    const maxBefore = before.versions.reduce((max, version) => Math.max(max, version.n), 0)
    return rollbackFailure(proposal.id, error, () => {
      if (beforeDoc !== undefined) writeFileSync(requirementDocPath(root, change.target), beforeDoc, 'utf8')
      for (let n = maxBefore + 1; n <= revision.version; n += 1) {
        rmSync(requirementVersionPath(root, change.target, n), { force: true })
      }
      saveRequirement(root, before)
    })
  }
  return {
    kind: 'success',
    text: `${proposal.id}「${proposal.title}」已批准：${change.target} 已改稿为 v${String(revision.version)}（${note}）。接下来走评审与过审。`,
  }
}

/**
 * 应用「修改当前草稿」提案：只重写正文，不增版本、不覆盖快照、不处置评审、不改状态。
 *
 * 正文必须与提案生成时宿主读到的基线逐字一致；提案生成后才落盘的评审会让报告基线错位，
 * 同样拒绝并要求重新生成。提案批准态写失败时把正文还原到改写前，还原失败如实报告。
 * @param root - 规格根。
 * @param proposal - 起草态且带 patch 载荷的提案。
 * @param change - patch 变更载荷。
 * @param approved - 提案的批准态。
 * @param at - 结论时刻，仅用于回执文案。
 * @returns 命令结果。
 */
function applyPatch(
  root: string,
  proposal: Proposal,
  change: Extract<RequirementChange, { mode: 'patch' }>,
  approved: Proposal,
  at: string,
): ProposalApproveResult {
  let before
  try {
    before = loadRequirement(root, change.target)
  } catch (error: unknown) {
    return { kind: 'error', text: `读不到提案目标 ${change.target}：${errorMessage(error)}；提案仍是 draft` }
  }
  if (before.state !== 'draft') {
    return {
      kind: 'error',
      text: `${change.target} 现在在「${before.state}」，只有起草态需求能应用修改；提案仍是 draft`,
    }
  }
  const laterReview = before.reviews.find(review => Date.parse(review.at) > Date.parse(proposal.opened_at))
  if (laterReview !== undefined) {
    return {
      kind: 'error',
      text: `${proposal.id} 生成后已有第 ${String(laterReview.round)} 轮评审落盘，报告基线可能已变；请重新发起修改生成新提案后再应用，提案仍是 draft`,
    }
  }

  let previous
  try {
    previous = patchRequirementDraft(root, change.target, change.base_content, change.content)
  } catch (error: unknown) {
    return { kind: 'error', text: `${proposal.id} 的修改未应用：${errorMessage(error)}；提案仍是 draft，请重新生成` }
  }
  try {
    saveProposal(root, approved)
  } catch (error: unknown) {
    return rollbackFailure(proposal.id, error, () => {
      writeFileSync(requirementDocPath(root, change.target), previous, 'utf8')
    })
  }
  return {
    kind: 'success',
    text: `${proposal.id}「${proposal.title}」已应用（${at}）：${change.target} 的当前草稿已更新，未生成新版本，也未处置任何评审意见。`,
  }
}

/** 提案批准态写失败时回滚需求改动；回滚也失败就如实报未可信状态，请人核对。 */
function rollbackFailure(id: string, error: unknown, rollback: () => void): ProposalApproveResult {
  try {
    rollback()
  } catch (restoreError: unknown) {
    return {
      kind: 'error',
      text: `${id} 的批准态写失败（${errorMessage(error)}），且需求改动回滚失败（${errorMessage(restoreError)}）；请人工核对 .spec 后再操作`,
    }
  }
  return { kind: 'error', text: `${id} 的批准态写失败：${errorMessage(error)}；需求改动已回滚，提案仍是 draft` }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
