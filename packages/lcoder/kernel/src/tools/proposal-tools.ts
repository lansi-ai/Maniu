/**
 * 方案工具集：把需求探讨的结论落成 `.spec/proposals/P-01.yaml`。
 *
 * 两条刻意的限制：
 *   1. **`decision` 只有 `draft` 从这里写。** 批准与驳回归人机命令 `/proposal_approve`，
 *      模型能出方案、能比较代价，不能替人拍板——与 `contract_draft` 和 `contract_sign` 的分工同构。
 *   2. **已拍板的方案不改写。** 人的结论落盘后，模型再调只能读到现值；要改方案由人先把
 *      `decision` 退回 `draft`，或另出一条新方案。否则讨论记录会被后续回合悄悄覆盖。
 *
 * 输出统一用 `{ type: 'json' }` + JSON 渲染，理由见 docs/cookbook/adding-a-tool.md。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import type { Proposal, ProposalOption } from '../schema/spec.js'
import { assertProposalId, listProposals, nextProposalId, proposalPath, saveProposal } from '../kernel/proposal-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

/** 落盘后给模型的下一步口径：等用户拍板，批准才拆任务。 */
const PENDING_NOTE = '方案已落盘，决定态是 draft。请把它讲给用户并等他拍板：批准走 /proposal_approve，驳回由人改文件。拍板后再用 task_draft 拆任务，并把 proposal 填成这个编号。'

/** 标题查重键：与任务立项同一口径，空白与大小写不算差异。 */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '')
}

/**
 * 把三条平行数组配成候选方案。
 *
 * 工具的参数面只支持标量数组，装不下「名称 + 怎么做 + 代价」的嵌套对象，所以按位置对齐：
 * 长度不一致就是模型自己说错了，当场抛并报到第几条，不静默截断。
 * @param names - 各条方案的名字。
 * @param summaries - 各条方案怎么做，与 names 同序同长。
 * @param costs - 各条方案的代价，与 names 同序同长。
 * @returns 校验过的候选方案。
 */
function optionsOf(names: readonly string[], summaries: readonly string[], costs: readonly string[]): ProposalOption[] {
  if (names.length === 0 || summaries.length === 0 || costs.length === 0) {
    throw new Error('proposal_draft 需要至少一条方案：option_names、option_summaries、option_costs 三个数组都要非空')
  }
  if (names.length !== summaries.length || names.length !== costs.length) {
    throw new Error(
      `三条 options 数组长度不一致：名称 ${String(names.length)} 条、做法 ${String(summaries.length)} 条、代价 ${String(costs.length)} 条；按位置一一对齐才能读`,
    )
  }
  return names.map((name, index) => {
    const trimmedName = name.trim()
    const summary = summaries[index] ?? ''
    const cost = costs[index] ?? ''
    if (trimmedName === '' || summary === '' || cost === '') {
      throw new Error(`第 ${String(index + 1)} 条方案有空字段：name、summary、cost 三样都要写，方案才有比较价值`)
    }
    return { name: trimmedName, summary, cost }
  })
}

/**
 * 建方案工具。
 * @param rootInput - 规格根解析（按会话工作区）。
 * @returns `proposal_draft` 工具定义。
 */
export function createProposalTools(rootInput: RootInput): ToolDefinition[] {
  return [
    defineTool({
      name: 'proposal_draft',
      description:
        '把需求探讨的结论登记成 `.spec/proposals/P-<编号>.yaml`：问题现状、候选方案（option_names、option_summaries、option_costs 三个数组按位置一一对应，建议 2 到 3 条）、推荐哪一条及理由。决定态固定写 draft——批准与驳回是人的动作，本工具不提供。同标题已存在时只回读不重建；已拍板（approved 或 rejected）的方案不再改写，要改由人先把决定态退回 draft 或另立新方案。',
      parameters: {
        title: { type: 'string', required: true, description: '一句话说清这条方案管什么' },
        problem: { type: 'string', required: true, description: '要办成的事与现状缺口，方案的评判基准' },
        option_names: { type: 'array', items: { type: 'string' }, required: true, description: '各条候选方案的名字' },
        option_summaries: { type: 'array', items: { type: 'string' }, required: true, description: '各条怎么做，与 option_names 同序同长' },
        option_costs: { type: 'array', items: { type: 'string' }, required: true, description: '各条代价，与 option_names 同序同长' },
        recommendation: { type: 'string', required: true, description: '推荐哪一条以及为什么，要能对着 options 读' },
        proposal_id: { type: 'string', description: '指定编号，形如 P-01；省略则取现有 P- 编号之后的下一个空号' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        const title = args.title.trim()
        if (title === '') throw new Error('proposal_draft 需要非空的 title：一句话说清这条方案管什么')

        const problem = args.problem.trim()
        if (problem === '') throw new Error('proposal_draft 需要非空的 problem：不写现状缺口，方案就没法评')

        const recommendation = args.recommendation.trim()
        if (recommendation === '') throw new Error('proposal_draft 需要非空的 recommendation：给方案就得给推荐')

        const options = optionsOf(args.option_names, args.option_summaries, args.option_costs)
        const existing = hasSpecRoot(root) ? listProposals(root) : []

        if (args.proposal_id !== undefined) {
          const id = assertProposalId(args.proposal_id)
          const current = existing.find(proposal => proposal.id === id)
          if (current === undefined) {
            throw new Error(`方案编号 ${id} 还不存在；省略 proposal_id 可自动取下一个空号，或按标题新建`)
          }
          if (current.decision !== 'draft') {
            return {
              proposal_id: current.id,
              path: proposalPath(root, current.id),
              decision: current.decision,
              created: false,
              note: `${current.id} 已由人判为「${current.decision}」，本工具不改写已拍板的方案。要改内容由人把 decision 退回 draft，或另立新方案。`,
            }
          }
          const updated: Proposal = {
            ...current,
            title,
            problem,
            options,
            recommendation,
          }
          const path = saveProposal(root, updated)
          return {
            proposal_id: updated.id,
            path,
            decision: updated.decision,
            created: false,
            note: `已更新 ${updated.id} 的正文，决定态仍是 draft，人的结论没动。${PENDING_NOTE}`,
          }
        }

        const duplicate = existing.find(proposal => titleKey(proposal.title) === titleKey(title))
        if (duplicate !== undefined) {
          return {
            proposal_id: duplicate.id,
            path: proposalPath(root, duplicate.id),
            decision: duplicate.decision,
            created: false,
            note: `已有一个同标题方案 ${duplicate.id}（${duplicate.decision}），没有重复新建。内容要改就带上 proposal_id 更新它。`,
          }
        }

        const proposal: Proposal = {
          id: nextProposalId(existing),
          title,
          problem,
          options,
          recommendation,
          decision: 'draft',
          decided_at: null,
          opened_at: new Date().toISOString(),
        }
        const path = saveProposal(root, proposal)
        return {
          proposal_id: proposal.id,
          path,
          decision: proposal.decision,
          created: true,
          note: PENDING_NOTE,
        }
      },
    }),
  ]
}
