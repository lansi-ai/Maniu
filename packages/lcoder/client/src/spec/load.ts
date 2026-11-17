/** 读 `.spec/` 目录，折成工作台各页共用的投影。 */

import {
  AGENTS_FILE, AUTOMATION_FILE, CONTRACTS_DIR, DELIVERABLES_DIR, LOCAL_FILE, PROJECT_FILE,
  PROPOSALS_DIR, REQUIREMENTS_DIR, ROLES_FILE, RULES_FILE, SCHEDULING_DIR, TASKS_DIR,
} from './files.ts'
import type { SpecFiles } from './files.ts'
import { messageOf } from './files.ts'
import {
  agentsTextToRow, automationTextToRow, contractTextToRow, deliverableTextToRow, groupTextToRow,
  isMissing, localSecretsOf, projectTextToRow, proposalTextToRow, requirementTextToRow,
  rolesTextToRows, rulesTextToRows, splitPlanTextToRow, taskTextToRow,
} from './rows.ts'
import type {
  AgentsRow, AutomationPolicyRow, ContractRow, DeliverableRow, JobRoleRow, ProjectInfoRow,
  ProposalRow, RequirementDocRow, RequirementSplitPlanRow, RuleRow, SchedulingGroupRow, TaskRow,
} from './rows.ts'

/** 工作台一次读取的全部规格事实。 */
export interface SpecProjection {
  readonly tasks: readonly TaskRow[]
  readonly rules: readonly RuleRow[]
  readonly contracts: readonly ContractRow[]
  readonly proposals: readonly ProposalRow[]
  readonly requirements: readonly RequirementDocRow[]
  readonly groups: readonly SchedulingGroupRow[]
  readonly roles: readonly JobRoleRow[]
  readonly project: ProjectInfoRow | null
  readonly secrets: Readonly<Record<string, string>>
  readonly automation: AutomationPolicyRow | null
  readonly agents: AgentsRow | null
  readonly problems: readonly string[]
}

interface LoadedRows<Row> {
  readonly rows: readonly Row[]
  readonly problems: readonly string[]
}

function idOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string') return value.id
  return ''
}

function sorted<Row>(rows: readonly Row[]): Row[] {
  return [...rows].sort((left, right) => {
    const a = idOf(left)
    const b = idOf(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}

async function readText(
  files: SpecFiles,
  path: string,
): Promise<{ readonly text: string } | { readonly missing: true } | { readonly problem: string }> {
  const page = await files.readPage(path)
  if (page.ok) return { text: page.text }
  if (isMissing(page.error, path)) return { missing: true }
  return { problem: `${path}: ${messageOf(page.error)}` }
}

/**
 * 读一个 YAML 目录。
 * @param files - 文件面。
 * @param dir - 目录。
 * @param suffix - 只读的文件后缀。
 * @param parse - 文本 → 行。
 * @param signal - 取消信号。
 * @returns 行与逐文件问题。
 */
async function loadDir<Row>(
  files: SpecFiles,
  dir: string,
  suffix: string,
  parse: (fileName: string, text: string) => Row | undefined,
  signal: AbortSignal,
): Promise<LoadedRows<Row>> {
  const rows: Row[] = []
  const problems: string[] = []
  const listed = await files.list(dir)
  if (!listed.ok) {
    if (!isMissing(listed.error, dir)) problems.push(`${dir}/: ${messageOf(listed.error)}`)
    return { rows, problems }
  }
  const names = listed.entries
    .filter(entry => entry.type === 'file' && entry.name.endsWith(suffix))
    .map(entry => entry.name)
  await Promise.all(names.map(async (name) => {
    if (signal.aborted) return
    const page = await files.readPage(`${dir}/${name}`)
    if (!page.ok) {
      problems.push(`${dir}/${name}: ${messageOf(page.error)}`)
      return
    }
    const row = parse(name, page.text)
    if (row === undefined) problems.push(`${dir}/${name}: 不是能读的文件`)
    else rows.push(row)
  }))
  return { rows: sorted(rows), problems }
}

async function loadRequirements(files: SpecFiles, signal: AbortSignal): Promise<LoadedRows<RequirementDocRow>> {
  const rows: RequirementDocRow[] = []
  const problems: string[] = []
  const listed = await files.list(REQUIREMENTS_DIR)
  if (!listed.ok) {
    if (!isMissing(listed.error, REQUIREMENTS_DIR)) problems.push(`${REQUIREMENTS_DIR}/: ${messageOf(listed.error)}`)
    return { rows, problems }
  }
  const names = listed.entries.filter(entry => entry.type === 'file').map(entry => entry.name)
  const documents = new Map(names.filter(name => name.endsWith('.md')).map(name => [name.replace(/\.md$/, ''), name]))
  const documentText = async (name: string): Promise<string> => {
    const page = await files.readPage(`${REQUIREMENTS_DIR}/${name}`)
    if (!page.ok) {
      problems.push(`${REQUIREMENTS_DIR}/${name}: ${messageOf(page.error)}`)
      return ''
    }
    return page.text
  }
  const withMeta = new Set<string>()
  await Promise.all(names.filter(name => name.endsWith('.yaml')).map(async (name) => {
    if (signal.aborted) return
    const page = await files.readPage(`${REQUIREMENTS_DIR}/${name}`)
    if (!page.ok) {
      problems.push(`${REQUIREMENTS_DIR}/${name}: ${messageOf(page.error)}`)
      return
    }
    const meta = requirementTextToRow(name, page.text)
    if (meta === undefined) {
      problems.push(`${REQUIREMENTS_DIR}/${name}: 不是能读的需求文件`)
      return
    }
    withMeta.add(meta.id)
    const document = documents.get(meta.id)
    const text = document === undefined ? '' : await documentText(document)
    const answer = await readText(files, `${REQUIREMENTS_DIR}/${meta.id}/split-plan.yaml`)
    let splitPlan: RequirementSplitPlanRow | undefined
    if ('text' in answer) {
      splitPlan = splitPlanTextToRow(answer.text)
      if (splitPlan === undefined) {
        problems.push(`${REQUIREMENTS_DIR}/${meta.id}/split-plan.yaml: 不是能读的拆分计划`)
      }
    } else if ('problem' in answer) {
      problems.push(answer.problem)
    }
    rows.push({ ...meta, text, ...(splitPlan === undefined ? {} : { splitPlan }) })
  }))
  await Promise.all([...documents.entries()]
    .filter(([id]) => !withMeta.has(id))
    .map(async ([, name]) => {
      const text = await documentText(name)
      if (text.trim() === '') return
      rows.push({ id: name.replace(/\.md$/, ''), text, options: [], versions: [], reviews: [] })
    }))
  return { rows: sorted(rows), problems }
}

async function readFileRow<Row>(
  files: SpecFiles,
  path: string,
  parse: (text: string) => Row | undefined,
): Promise<{ readonly row: Row | null; readonly problems: readonly string[] }> {
  const answer = await readText(files, path)
  if ('missing' in answer) return { row: null, problems: [] }
  if ('problem' in answer) return { row: null, problems: [answer.problem] }
  const row = parse(answer.text)
  return row === undefined
    ? { row: null, problems: [`${path}: 不是能读的 YAML`] }
    : { row, problems: [] }
}

/**
 * 读一份完整投影。任何一路失败只记问题，不让整份投影落空。
 * @param files - 文件面。
 * @param signal - 取消信号。
 * @returns 工作台投影。
 */
export async function loadSpecProjection(files: SpecFiles, signal: AbortSignal): Promise<SpecProjection> {
  const [tasks, rules, contracts, proposals, requirements, deliverables, groups, roles] = await Promise.all([
    loadDir(files, TASKS_DIR, '.yaml', taskTextToRow, signal),
    readFileRow(files, RULES_FILE, rulesTextToRows),
    loadDir(files, CONTRACTS_DIR, '.contract.yaml', contractTextToRow, signal),
    loadDir(files, PROPOSALS_DIR, '.yaml', proposalTextToRow, signal),
    loadRequirements(files, signal),
    loadDir(files, DELIVERABLES_DIR, '.yaml', deliverableTextToRow, signal),
    loadDir(files, SCHEDULING_DIR, '.yaml', groupTextToRow, signal),
    readFileRow(files, ROLES_FILE, rolesTextToRows),
  ])
  const [project, secrets, automation, agents] = await Promise.all([
    readFileRow(files, PROJECT_FILE, projectTextToRow),
    readFileRow(files, LOCAL_FILE, localSecretsOf),
    readFileRow(files, AUTOMATION_FILE, automationTextToRow),
    readFileRow(files, AGENTS_FILE, agentsTextToRow),
  ])
  const deliverableByTask = new Map(deliverables.rows.map(row => [row.task, row]))
  return {
    tasks: tasks.rows.map((row) => {
      const deliverable = deliverableByTask.get(row.id)
      return deliverable === undefined ? row : { ...row, deliverable }
    }),
    rules: rules.row ?? [],
    contracts: contracts.rows,
    proposals: proposals.rows,
    requirements: requirements.rows,
    groups: groups.rows,
    roles: roles.row ?? [],
    project: project.row,
    secrets: secrets.row ?? {},
    automation: automation.row,
    agents: agents.row,
    problems: [
      ...tasks.problems, ...rules.problems, ...contracts.problems, ...proposals.problems,
      ...requirements.problems, ...deliverables.problems, ...groups.problems, ...roles.problems,
      ...project.problems, ...secrets.problems, ...automation.problems, ...agents.problems,
    ],
  }
}

/** 空投影：还没选项目时各页拿它画空态。 */
export const emptyProjection: SpecProjection = {
  tasks: [],
  rules: [],
  contracts: [],
  proposals: [],
  requirements: [],
  groups: [],
  roles: [],
  project: null,
  secrets: {},
  automation: null,
  agents: null,
  problems: [],
}

/** 任务 id → 交付索引，供详情页补展示。 */
export function deliverableOf(projection: SpecProjection, taskId: string): DeliverableRow | undefined {
  return projection.tasks.find(task => task.id === taskId)?.deliverable
}
