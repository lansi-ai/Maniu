/**
 * 方案对象的读写与编号分配。
 *
 * 与 `task-store` 同一条口径：编号形态稳定（`P-01`）、写盘前过 schema、按 id 排序读回。
 * `decision` 只有两条写入口——`proposal_draft` 写 `draft`，人机命令 `/proposal_approve` 写
 * `approved` 或 `rejected`。模型能出方案，改不了人的结论，与 `contract_sign` 同一档纪律。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { Proposal } from '../schema/spec.js'
import { listFiles, matchPattern } from '../schema/validate.js'

/** 方案编号的唯一形态：与任务、规格条目同一套稳定编号（P-01 / DEMO-014）。 */
const PROPOSAL_ID = /^[A-Z]+-\d{2,}$/

/**
 * 校验方案编号形态，不合法就抛。
 * @param id - 调用方（模型或 UI）给出的编号。
 * @returns 原样返回校验过的编号。
 */
export function assertProposalId(id: string): string {
  if (!PROPOSAL_ID.test(id)) {
    throw new Error(`非法的方案编号：${id}（应形如 P-01）`)
  }
  return id
}

/**
 * 下一个可用的 `P-<序号>` 编号：取现有 P- 编号的最大序号加一，两位起排。
 * 其它前缀（如 `DEMO-01`）不参与计数，示例数据不会挤占正式编号。
 * @param proposals - 规格里已有的方案。
 * @returns 未被占用的编号。
 */
export function nextProposalId(proposals: readonly Proposal[]): string {
  let max = 0
  for (const proposal of proposals) {
    const digits = /^P-(\d+)$/.exec(proposal.id)?.[1]
    if (digits !== undefined) max = Math.max(max, Number.parseInt(digits, 10))
  }
  return `P-${String(max + 1).padStart(2, '0')}`
}

/**
 * 方案文件的落点。
 * @param root - 规格根。
 * @param id - 方案编号。
 * @returns `proposals/<id>.yaml` 的绝对路径。
 */
export function proposalPath(root: string, id: string): string {
  return join(root, 'proposals', `${id}.yaml`)
}

/**
 * 写一个方案：先过 schema，再落盘。
 * @param root - 规格根。
 * @param proposal - 待写的方案。
 * @returns 落盘路径。
 */
export function saveProposal(root: string, proposal: Proposal): string {
  const path = proposalPath(root, proposal.id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringifyYaml(Proposal.parse(proposal)), 'utf8')
  return path
}

/**
 * 读一个方案。
 * @param root - 规格根。
 * @param id - 方案编号。
 * @returns 解析后的方案；文件不存在或形状不合都会抛。
 */
export function loadProposal(root: string, id: string): Proposal {
  return Proposal.parse(parseYaml(readFileSync(proposalPath(root, id), 'utf8')))
}

/**
 * 列出全部方案。
 * @param root - 规格根。
 * @returns 按编号排序的方案；`proposals/` 不存在时为空数组。
 */
export function listProposals(root: string): Proposal[] {
  return listFiles(root)
    .filter(file => matchPattern('proposals/*.yaml', file))
    .map(file => Proposal.parse(parseYaml(readFileSync(join(root, file), 'utf8'))))
    .sort((a, b) => a.id.localeCompare(b.id))
}
