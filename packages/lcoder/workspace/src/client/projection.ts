/**
 * 文件投影：把磁盘上的规格事实读成三栏能画的行。
 *
 * 数据面不建自己的 Remote 命名空间：任务与规格本来就是 kernel 落在仓库里的
 * YAML（`tasks/*.yaml`、`spec/rules.yaml`），是唯一事实源——「规格为主语」对
 * UI 同样成立，UI 也是规格文件的投影。这里只读、只解析、只展示；状态机判断
 * 仍归 kernel，UI 不做任何决策。读文件走上游现成的 `workspaceFiles` 命名空间，
 * 本模块只依赖一个窄化的文件面（便于测试替换，也让整个包不见其余远程能力）。
 */
import { parse as parseYaml } from 'yaml'
import type {
  WorkspaceDirectoryListing, WorkspaceFileText,
} from '@deepseek-ai/dsh-api-workspace-files/types'
import type { RoleSignals } from '@lcoder/kernel/src/schema/spec.ts'
import type { ShellEnvironment, ShellProjectInfo } from './shell/shell-data.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** 左栏一行任务：YAML 里能直接读到的展示字段。 */
export interface TaskRow {
  readonly id: string
  readonly title: string
  readonly state: string
  readonly grade: string
  /** 任务声明的规则编号；外壳与启动咒语直接使用。 */
  readonly rules: readonly string[]
  /** 收口要求的证据类型；外壳与启动咒语直接使用。 */
  readonly evidence: readonly string[]
  /** 认领这条任务的会话号；`/task_bind` 写过才有，缺省表示无人认领。 */
  readonly session?: string
  /** 这条任务出自哪个方案（`P-01`）；缺省表示不是拆出来的。 */
  readonly proposal?: string
  /** 前置任务编号；空数组表示没有依赖。 */
  readonly dependsOn: readonly string[]
  /** 分配到的岗位 id；`/task_assign` 写过才有，缺省表示未分配。 */
  readonly role?: string
  /** 任务声明的允许路径（`scope.allowed_paths`）；调度按它判落点重叠。 */
  readonly paths: readonly string[]
  /** 任务声明的不可逆动作（`scope.irreversible`）；非空时本地建议恒转人工。 */
  readonly irreversible: readonly string[]
}

/**
 * 岗位名册里的一行。
 *
 * 名册文件缺失时调用方拿到空表——「没有自定岗位」是常态，不是故障。
 * 任务上的岗位 id 在这张表里查不到、又不是内置角色时，界面显示「未知岗位」。
 */
export interface JobRoleRow {
  readonly id: string
  readonly name: string
  readonly inherits: string
  readonly persona?: string
  /** 岗位的可机读信号；只供建议层排序，缺省表示名册没声明。 */
  readonly signals?: RoleSignals
}

/** 中栏一条规格条目。 */
export interface RuleRow {
  readonly id: string
  /** 规格条目所属模块；任务侧的模块信号由它反查。 */
  readonly module: string
  readonly kind: string
  readonly status: string
  readonly text: string
}

/**
 * 一份契约的展示数据。
 *
 * 只展示文件里写着的事实：`signedBy` 是 `sig.by`，`signedAt` 是 `sig.at`。
 * 「签名是否还覆盖当前正文」要复算 sha256，那是宿主的活（`node:crypto` 不进渲染端），
 * 所以外壳不承诺识别签后改动——收口时由 P3 判。
 */
export interface ContractRow {
  readonly id: string
  readonly change: readonly string[]
  readonly notChange: readonly string[]
  readonly acceptance: readonly string[]
  readonly failIf: readonly string[]
  /** 签署人；没有签名时是 null，`agent` 表示这是 AI 自签，界面必须单独标注。 */
  readonly signedBy: 'human' | 'agent' | null
  readonly signedAt: string | null
  /** AI 自签的 preset；人签或缺省时为 undefined。 */
  readonly signedActor?: string
}

/** 策略能开关的动作；与 kernel schema 的 `AutomationActionName` 同序同名。 */
export const AUTOMATION_ACTIONS = ['draft', 'contract', 'sign', 'implement', 'verify', 'close', 'commit'] as const
/** 一个动作名；从 `AUTOMATION_ACTIONS` 推导，避免两处手抄。 */
export type AutomationActionRow = (typeof AUTOMATION_ACTIONS)[number]

/** 一个动作是自动还是等人触发。 */
export type AutomationModeRow = 'auto' | 'manual'

/** 停止条件；null 表示这一项不设限。 */
export interface AutomationLimitsRow {
  readonly tokenBudget: number | null
  readonly maxMinutes: number | null
  readonly maxConsecutiveFailures: number | null
  readonly maxParallel: number | null
}

/**
 * `.spec/automation.yaml` 的展示数据。
 *
 * 文件缺失时调用方拿到 `null`，按全手动渲染——「没写」不等于「允许自动」。
 * 外部不可逆动作（push、部署、环境变更）不在这张表里，也不该出现在任何策略里。
 */
export interface AutomationPolicyRow {
  readonly actions: Readonly<Record<AutomationActionRow, AutomationModeRow>>
  readonly limits: AutomationLimitsRow
  /** 只对列出的任务生效；空数组表示全部任务。 */
  readonly tasks: readonly string[]
}

/**
 * `.spec/agents.yaml` 的展示数据：两条常驻调度会话的会话号。
 *
 * 文件缺失时调用方拿到 null；编号失效（换机器、删会话）按未绑定处理，
 * 不把「读不到」当成「不存在这条会话」。
 */
export interface AgentsRow {
  readonly schedulerSession?: string
  readonly flowSession?: string
}

/**
 * 一份方案的展示数据。
 *
 * `decision` 是文件里写着的事实：`draft` 等人拍板，`approved` 与 `rejected` 由人机命令或人编辑写下。
 * 外壳不承诺推断「方案被批准后拆了哪些任务」——那要反查 `TaskRow.proposal`，由渲染侧做。
 */
export interface ProposalRow {
  readonly id: string
  readonly title: string
  readonly problem: string
  readonly options: readonly ProposalOptionRow[]
  readonly recommendation: string
  readonly decision: 'draft' | 'approved' | 'rejected' | 'unknown'
  readonly decidedAt: string | null
}

/** 方案里的一条候选。 */
export interface ProposalOptionRow {
  readonly name: string
  readonly summary: string
  readonly cost: string
}

/**
 * 一个联调组：入队成立时写下，成员一起写、一起跑证据、一起验收。
 *
 * 它是调度留给验收侧的承诺，不是任务字段；只在 `.spec/evidence/scheduling/` 里。
 */
export interface SchedulingGroupRow {
  readonly id: string
  /** 组内任务共同排队的会话。 */
  readonly sessionId: string
  readonly members: readonly string[]
  readonly createdAt: string
}

export interface WorkspaceProjection {
  readonly tasks: readonly TaskRow[]
  readonly rules: readonly RuleRow[]
  readonly contracts: readonly ContractRow[]
  readonly proposals: readonly ProposalRow[]
  readonly groups: readonly SchedulingGroupRow[]
  readonly problems: readonly string[]
}

/** 本包需要的窄化文件面：整个包只见这两个调用，其余远程能力不进类型。 */
export interface ProjectionFilesRemote {
  list(sessionId: SessionId, path: string, signal: AbortSignal): Promise<RemoteResult<WorkspaceDirectoryListing>>
  /** 从第 `offset` 行（1 起）读一页；省略按第一页读。 */
  readPage(
    sessionId: SessionId,
    path: string,
    signal: AbortSignal,
    offset?: number,
  ): Promise<RemoteResult<WorkspaceFileText>>
}

/**
 * kernel 约定的布局：`.spec` 目录是规格库根，任务在它下面的 `tasks/`，
 * 规则库在它下面的 `spec/rules.yaml`。
 *
 * 这里必须与 `@lcoder/kernel` 的两处落盘保持一致（`task-store.taskPath` 与
 * `spec-store.saveRules` 都以 `.spec` 为 root）——UI 是这些文件的投影，
 * 路径一旦分叉，画出来的就是另一套事实。
 */
export const SPEC_DIR = '.spec'
export const TASKS_DIR = `${SPEC_DIR}/tasks`
export const CONTRACTS_DIR = `${SPEC_DIR}/contracts`
export const PROPOSALS_DIR = `${SPEC_DIR}/proposals`
export const RULES_FILE = `${SPEC_DIR}/spec/rules.yaml`
export const PROJECT_FILE = `${SPEC_DIR}/project.yaml`
export const LOCAL_FILE = `${SPEC_DIR}/local.yaml`
export const AUTOMATION_FILE = `${SPEC_DIR}/automation.yaml`
export const AGENTS_FILE = `${SPEC_DIR}/agents.yaml`
export const ROLES_FILE = `${SPEC_DIR}/roles.yaml`
export const SCHEDULING_DIR = `${SPEC_DIR}/evidence/scheduling`

/** 单页行数上限：任务与规则 YAML 都是几十行的量级，500 足够且低于宿主默认页。 */
export const PAGE_LINES = 500

/** 字符串字段读取：空串按缺失算。 */
function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** YAML 解析结果的形状守卫：只接受普通对象。 */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 远程失败的人话：RemoteError 自带 message；没有就退到 code，再没有就认了。 */
export function messageOf(failure: { readonly code?: unknown; readonly message?: unknown }): string {
  if (typeof failure.message === 'string' && failure.message !== '') return failure.message
  return typeof failure.code === 'string' ? failure.code : '未知失败'
}

/**
 * 一个任务 YAML 的文本 → 一行展示数据。解析失败或形状不对给 `undefined`：
 * 展示面不猜测，读不懂的文件进 problems，而不是编一行假数据。
 */
export function taskTextToRow(fileName: string, text: string): TaskRow | undefined {
  let fields: Record<string, unknown> | undefined
  try {
    fields = recordOf(parseYaml(text))
  } catch {
    return undefined
  }
  if (fields === undefined) return undefined
  const title = asText(fields.title)
  if (title === undefined) return undefined
  const session = asText(fields.session)
  const proposal = asText(fields.proposal)
  const role = asText(fields.role)
  const scope = recordOf(fields.scope)
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    title,
    state: asText(fields.state) ?? 'unknown',
    grade: asText(fields.grade) ?? '-',
    rules: stringArray(fields.rules),
    evidence: stringArray(fields.evidence_required),
    ...(session === undefined ? {} : { session }),
    ...(proposal === undefined ? {} : { proposal }),
    ...(role === undefined ? {} : { role }),
    dependsOn: stringArray(fields.depends_on),
    paths: stringArray(scope?.allowed_paths),
    irreversible: stringArray(scope?.irreversible),
  }
}

/** 岗位信号：只收三组字符串，读不懂返回 undefined；建议层自己按缺省处理空组。 */
function roleSignalsOf(value: unknown): RoleSignals | undefined {
  const fields = recordOf(value)
  if (fields === undefined) return undefined
  const signals: RoleSignals = {
    strong: stringArray(fields.strong),
    medium: stringArray(fields.medium),
    preferredPaths: stringArray(fields.preferredPaths),
  }
  const total = signals.strong.length + signals.medium.length + signals.preferredPaths.length
  return total === 0 ? undefined : signals
}

/** 字符串数组字段：只收字符串项，其余忽略。 */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 规则库文本 → 展示行。解析失败给空表；缺字段的条目跳过——展示面不替规格库补事实。 */
export function rulesTextToRows(text: string): RuleRow[] {
  let doc: Record<string, unknown> | undefined
  try {
    doc = recordOf(parseYaml(text))
  } catch {
    return []
  }
  const list = doc?.rules
  if (!Array.isArray(list)) return []
  return list.flatMap((entry: unknown) => {
    const fields = recordOf(entry)
    if (fields === undefined) return []
    const id = asText(fields.id)
    const text = asText(fields.text)
    if (id === undefined || text === undefined) return []
    return [{
      id,
      module: asText(fields.module) ?? '',
      kind: asText(fields.kind) ?? 'rule',
      status: asText(fields.status) ?? 'draft',
      text,
    }]
  })
}

/**
 * 一份契约 YAML 的文本 → 展示行。签名缺省按未签署处理；
 * 读不懂的文件返回 undefined，由调用方记进 problems，不编造一份契约。
 */
export function contractTextToRow(fileName: string, text: string): ContractRow | undefined {
  let fields: Record<string, unknown> | undefined
  try {
    fields = recordOf(parseYaml(text))
  } catch {
    return undefined
  }
  if (fields === undefined) return undefined
  const change = stringArray(fields.change)
  const acceptance = stringArray(fields.acceptance)
  if (change.length === 0 || acceptance.length === 0) return undefined
  const sig = recordOf(fields.sig)
  const by = sig?.by
  const actor = asText(sig?.actor)
  const signedBy = by === 'human' || by === 'agent' ? by : null
  return {
    id: asText(fields.id) ?? fileName.replace(/\.contract\.yaml$/, ''),
    change,
    notChange: stringArray(fields.not_change),
    acceptance,
    failIf: stringArray(fields.fail_if),
    signedBy,
    signedAt: sig === undefined ? null : (asText(sig.at) ?? null),
    ...(signedBy === 'agent' && actor !== undefined ? { signedActor: actor } : {}),
  }
}

/**
 * 自动化策略 YAML 的文本 → 展示行。读不懂（不是对象）返回 undefined；
 * 单个字段不认识时按缺省收敛：动作按手动、停止条件按不设限，展示面不替策略补授权。
 * @param text - 文件正文。
 * @returns 可展示的策略，读不懂为 undefined。
 */
export function automationTextToRow(text: string): AutomationPolicyRow | undefined {
  let doc: Record<string, unknown> | undefined
  try {
    doc = recordOf(parseYaml(text))
  } catch {
    return undefined
  }
  if (doc === undefined) return undefined

  const actions = recordOf(doc.actions)
  const limits = recordOf(doc.limits)
  const mode = (name: AutomationActionRow): AutomationModeRow =>
    actions?.[name] === 'auto' ? 'auto' : 'manual'
  return {
    actions: {
      draft: mode('draft'),
      contract: mode('contract'),
      sign: mode('sign'),
      implement: mode('implement'),
      verify: mode('verify'),
      close: mode('close'),
      commit: mode('commit'),
    },
    limits: {
      tokenBudget: positiveInt(limits?.token_budget),
      maxMinutes: positiveInt(limits?.max_minutes),
      maxConsecutiveFailures: nonNegativeInt(limits?.max_consecutive_failures),
      maxParallel: positiveInt(limits?.max_parallel),
    },
    tasks: stringArray(doc.tasks),
  }
}

/** 正整数或 null；其余一律当未设置。 */
function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** 非负整数或 null；连续失败次数允许 0（第一次失败就停）。 */
function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * 一个联调组 YAML 的文本 → 展示行。缺会话、成员或建立时刻就读不懂，返回 undefined
 * 由调用方记进 problems；展示面不替证据目录补事实。
 * @param fileName - 文件名，缺 id 时用它兜底。
 * @param text - 文件正文。
 * @returns 可展示的联调组，读不懂为 undefined。
 */
export function groupTextToRow(fileName: string, text: string): SchedulingGroupRow | undefined {
  let fields: Record<string, unknown> | undefined
  try {
    fields = recordOf(parseYaml(text))
  } catch {
    return undefined
  }
  if (fields === undefined) return undefined
  const sessionId = asText(fields.session)
  const createdAt = asText(fields.created_at)
  const members = stringArray(fields.members)
  if (sessionId === undefined || createdAt === undefined || members.length === 0) return undefined
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    sessionId,
    members,
    createdAt,
  }
}

/**
 * 一份方案 YAML 的文本 → 展示行。缺 title、problem 或 recommendation 任一项就读不懂这份方案，
 * 返回 undefined 由调用方记进 problems；决定态不认识时给 `unknown`，不假装它是草稿。
 */
export function proposalTextToRow(fileName: string, text: string): ProposalRow | undefined {
  let fields: Record<string, unknown> | undefined
  try {
    fields = recordOf(parseYaml(text))
  } catch {
    return undefined
  }
  if (fields === undefined) return undefined
  const title = asText(fields.title)
  const problem = asText(fields.problem)
  const recommendation = asText(fields.recommendation)
  if (title === undefined || problem === undefined || recommendation === undefined) return undefined

  const options = (Array.isArray(fields.options) ? fields.options : []).map((entry) => {
    const record = recordOf(entry)
    return {
      name: asText(record?.name) ?? '',
      summary: asText(record?.summary) ?? '',
      cost: asText(record?.cost) ?? '',
    }
  }).filter(option => option.name !== '')

  const decision = asText(fields.decision)
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    title,
    problem,
    options,
    recommendation,
    decision: decision === 'draft' || decision === 'approved' || decision === 'rejected' ? decision : 'unknown',
    decidedAt: asText(fields.decided_at) ?? null,
  }
}

/**
 * 读取一个会话的文件投影。三路读取互不阻塞；任何一路失败只记说明，
 * 不让整份投影落空——三栏宁可缺一角，不要全白。
 */
export async function loadWorkspaceProjection(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<WorkspaceProjection> {
  const [tasks, rules, contracts, proposals, groups] = await Promise.all([
    loadTasks(files, sessionId, signal),
    loadRules(files, sessionId, signal),
    loadContracts(files, sessionId, signal),
    loadProposals(files, sessionId, signal),
    loadGroups(files, sessionId, signal),
  ])
  return {
    tasks: tasks.rows,
    rules: rules.rows,
    contracts: contracts.rows,
    proposals: proposals.rows,
    groups: groups.rows,
    problems: [...tasks.problems, ...rules.problems, ...contracts.problems, ...proposals.problems, ...groups.problems],
  }
}

/**
 * 读 `.spec/evidence/scheduling/` 下的联调组。目录不存在是常态（还没入过队），不算故障。
 */
async function loadGroups(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<{ rows: SchedulingGroupRow[]; problems: string[] }> {
  const rows: SchedulingGroupRow[] = []
  const problems: string[] = []

  const listed = await files.list(sessionId, SCHEDULING_DIR, signal)
  if (!listed.ok) {
    if (!isMissing(listed.error, SCHEDULING_DIR)) {
      problems.push(`${SCHEDULING_DIR}/: ${messageOf(listed.error)}`)
    }
    return { rows, problems }
  }

  const names = listed.value.entries
    .filter(entry => entry.type === 'file' && entry.name.endsWith('.yaml'))
    .map(entry => entry.name)

  await Promise.all(names.map(async (name) => {
    const page = await files.readPage(sessionId, `${SCHEDULING_DIR}/${name}`, signal)
    if (!page.ok) {
      problems.push(`${SCHEDULING_DIR}/${name}: ${messageOf(page.error)}`)
      return
    }
    const row = groupTextToRow(name, page.value.text)
    if (row === undefined) {
      problems.push(`${SCHEDULING_DIR}/${name}: 不是能读的联调组文件`)
      return
    }
    rows.push(row)
  }))

  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { rows, problems }
}

async function loadTasks(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<{ rows: TaskRow[]; problems: string[] }> {
  const rows: TaskRow[] = []
  const problems: string[] = []

  const listed = await files.list(sessionId, TASKS_DIR, signal)
  if (!listed.ok) {
    // 目录还不存在是常态（没有任务的仓库），不算故障；其余失败才值得说。
    if (!isMissing(listed.error, TASKS_DIR)) {
      problems.push(`${TASKS_DIR}/: ${messageOf(listed.error)}`)
    }
    return { rows, problems }
  }

  const names = listed.value.entries
    .filter(entry => entry.type === 'file' && entry.name.endsWith('.yaml'))
    .map(entry => entry.name)

  await Promise.all(names.map(async (name) => {
    const page = await files.readPage(sessionId, `${TASKS_DIR}/${name}`, signal)
    if (!page.ok) {
      problems.push(`${TASKS_DIR}/${name}: ${messageOf(page.error)}`)
      return
    }
    const row = taskTextToRow(name, page.value.text)
    if (row === undefined) {
      problems.push(`${TASKS_DIR}/${name}: 不是能读的任务文件`)
      return
    }
    rows.push(row)
  }))

  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { rows, problems }
}

async function loadRules(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<{ rows: RuleRow[]; problems: string[] }> {
  const page = await files.readPage(sessionId, RULES_FILE, signal)
  if (!page.ok) {
    const problems = isMissing(page.error, RULES_FILE) ? [] : [`${RULES_FILE}: ${messageOf(page.error)}`]
    return { rows: [], problems }
  }
  return { rows: rulesTextToRows(page.value.text), problems: [] }
}

/**
 * 读 `.spec/contracts/` 下的契约。目录不存在是常态（还没起草），不算故障。
 */
async function loadContracts(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<{ rows: ContractRow[]; problems: string[] }> {
  const rows: ContractRow[] = []
  const problems: string[] = []

  const listed = await files.list(sessionId, CONTRACTS_DIR, signal)
  if (!listed.ok) {
    if (!isMissing(listed.error, CONTRACTS_DIR)) {
      problems.push(`${CONTRACTS_DIR}/: ${messageOf(listed.error)}`)
    }
    return { rows, problems }
  }

  const names = listed.value.entries
    .filter(entry => entry.type === 'file' && entry.name.endsWith('.contract.yaml'))
    .map(entry => entry.name)

  await Promise.all(names.map(async (name) => {
    const page = await files.readPage(sessionId, `${CONTRACTS_DIR}/${name}`, signal)
    if (!page.ok) {
      problems.push(`${CONTRACTS_DIR}/${name}: ${messageOf(page.error)}`)
      return
    }
    const row = contractTextToRow(name, page.value.text)
    if (row === undefined) {
      problems.push(`${CONTRACTS_DIR}/${name}: 不是能读的契约文件`)
      return
    }
    rows.push(row)
  }))

  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { rows, problems }
}

/**
 * 读 `.spec/proposals/` 下的方案。目录不存在是常态（还没出过方案），不算故障。
 */
async function loadProposals(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<{ rows: ProposalRow[]; problems: string[] }> {
  const rows: ProposalRow[] = []
  const problems: string[] = []

  const listed = await files.list(sessionId, PROPOSALS_DIR, signal)
  if (!listed.ok) {
    if (!isMissing(listed.error, PROPOSALS_DIR)) {
      problems.push(`${PROPOSALS_DIR}/: ${messageOf(listed.error)}`)
    }
    return { rows, problems }
  }

  const names = listed.value.entries
    .filter(entry => entry.type === 'file' && entry.name.endsWith('.yaml'))
    .map(entry => entry.name)

  await Promise.all(names.map(async (name) => {
    const page = await files.readPage(sessionId, `${PROPOSALS_DIR}/${name}`, signal)
    if (!page.ok) {
      problems.push(`${PROPOSALS_DIR}/${name}: ${messageOf(page.error)}`)
      return
    }
    const row = proposalTextToRow(name, page.value.text)
    if (row === undefined) {
      problems.push(`${PROPOSALS_DIR}/${name}: 不是能读的方案文件`)
      return
    }
    rows.push(row)
  }))

  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { rows, problems }
}

/** `.spec/automation.yaml` 的读取结果；文件缺失不算错误。 */
export interface AutomationPolicyLoad {
  /** 文件缺失时为 null，调用方按全手动渲染。 */
  readonly policy: AutomationPolicyRow | null
  readonly problems: readonly string[]
}

/**
 * 读 `.spec/automation.yaml`。文件不存在是常态（没开自动化），不算故障。
 * @param files - 窄化文件面。
 * @param sessionId - 提供相对路径基准的会话。
 * @param signal - 取消信号。
 * @returns 策略展示行与逐文件问题；缺文件时 `policy` 为 null。
 */
export async function loadAutomationPolicy(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<AutomationPolicyLoad> {
  const page = await files.readPage(sessionId, AUTOMATION_FILE, signal)
  if (!page.ok) {
    return isMissing(page.error, AUTOMATION_FILE)
      ? { policy: null, problems: [] }
      : { policy: null, problems: [`${AUTOMATION_FILE}: ${messageOf(page.error)}`] }
  }
  const policy = automationTextToRow(page.value.text)
  return policy === undefined
    ? { policy: null, problems: [`${AUTOMATION_FILE}: 不是能读的自动化策略`] }
    : { policy, problems: [] }
}

/** `.spec/agents.yaml` 的读取结果；文件缺失不算错误。 */
export interface AgentsLoad {
  /** 文件缺失时为 null；读不懂时为 null 并带 problems。 */
  readonly agents: AgentsRow | null
  readonly problems: readonly string[]
}

/**
 * 读 `.spec/agents.yaml`。文件不存在是常态（还没开过调度会话），不算故障。
 * @param files - 窄化文件面。
 * @param sessionId - 提供相对路径基准的会话。
 * @param signal - 取消信号。
 * @returns 两个常驻会话号与逐文件问题；缺文件时 `agents` 为 null。
 */
export async function loadAgentsRegistry(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<AgentsLoad> {
  const page = await files.readPage(sessionId, AGENTS_FILE, signal)
  if (!page.ok) {
    return isMissing(page.error, AGENTS_FILE)
      ? { agents: null, problems: [] }
      : { agents: null, problems: [`${AGENTS_FILE}: ${messageOf(page.error)}`] }
  }

  let doc: Record<string, unknown> | undefined
  try {
    doc = recordOf(parseYaml(page.value.text))
  } catch {
    doc = undefined
  }
  if (doc === undefined) return { agents: null, problems: [`${AGENTS_FILE}: 不是能读的 YAML`] }

  const schedulerSession = asText(doc.schedulerSession)
  const flowSession = asText(doc.flowSession)
  return {
    agents: {
      ...(schedulerSession === undefined ? {} : { schedulerSession }),
      ...(flowSession === undefined ? {} : { flowSession }),
    },
    problems: [],
  }
}

/** `.spec/roles.yaml` 的读取结果；文件缺失不算错误。 */
export interface RolesLoad {
  /** 名册里的岗位；文件缺失或为空时是空数组。 */
  readonly roles: readonly JobRoleRow[]
  readonly problems: readonly string[]
}

/**
 * 读 `.spec/roles.yaml`。文件不存在是常态（还没有自定岗位），不算故障。
 * @param files - 窄化文件面。
 * @param sessionId - 提供相对路径基准的会话。
 * @param signal - 取消信号。
 * @returns 岗位行与逐文件问题；缺文件时 `roles` 为空数组。
 */
export async function loadRolesRegistry(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<RolesLoad> {
  const page = await files.readPage(sessionId, ROLES_FILE, signal)
  if (!page.ok) {
    return isMissing(page.error, ROLES_FILE)
      ? { roles: [], problems: [] }
      : { roles: [], problems: [`${ROLES_FILE}: ${messageOf(page.error)}`] }
  }

  let doc: Record<string, unknown> | undefined
  try {
    doc = recordOf(parseYaml(page.value.text))
  } catch {
    doc = undefined
  }
  if (doc === undefined) return { roles: [], problems: [`${ROLES_FILE}: 不是能读的 YAML`] }

  const list = Array.isArray(doc.roles) ? doc.roles : []
  const roles: JobRoleRow[] = list.flatMap((entry: unknown) => {
    const fields = recordOf(entry)
    const id = asText(fields?.id)
    const name = asText(fields?.name)
    const inherits = asText(fields?.inherits)
    if (id === undefined || name === undefined || inherits === undefined) return []
    const persona = asText(fields?.persona)
    const signals = roleSignalsOf(fields?.signals)
    return [{
      id,
      name,
      inherits,
      ...(persona === undefined ? {} : { persona }),
      ...(signals === undefined ? {} : { signals }),
    }]
  })
  return { roles, problems: [] }
}

/** `.spec/project.yaml` 的读取结果；文件缺失不算错误。 */
export interface ProjectInfoLoad {
  readonly info: ShellProjectInfo | null
  readonly problems: readonly string[]
}

/**
 * 读 `.spec/project.yaml`。密码字段只保留引用名；解析值由调用方从
 * `.spec/local.yaml` 或环境变量补齐。
 * @param files - 窄化文件面。
 * @param sessionId - 提供相对路径基准的会话。
 * @param signal - 取消信号。
 * @returns 项目信息与逐文件问题。
 */
export async function loadProjectInfo(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<ProjectInfoLoad> {
  const page = await files.readPage(sessionId, PROJECT_FILE, signal)
  if (!page.ok) {
    return isMissing(page.error, PROJECT_FILE)
      ? { info: null, problems: [] }
      : { info: null, problems: [`${PROJECT_FILE}: ${messageOf(page.error)}`] }
  }

  let doc: Record<string, unknown> | undefined
  try {
    doc = recordOf(parseYaml(page.value.text))
  } catch {
    doc = undefined
  }
  if (doc === undefined) return { info: null, problems: [`${PROJECT_FILE}: 不是能读的 YAML`] }

  const kind = doc.kind === 'web' || doc.kind === 'desktop' || doc.kind === 'library' ? doc.kind : 'library'
  const repo = recordOf(doc.repo)
  const docs = recordOf(doc.docs)
  const environmentRecords = recordOf(doc.environments) ?? {}
  const environments: ShellEnvironment[] = Object.entries(environmentRecords).flatMap(([id, raw]) => {
    const env = recordOf(raw)
    if (env === undefined) return []
    const database = recordOf(env.database)
    const server = asText(env.server)
    const note = asText(env.note)
    const port = database?.port
    return [{
      id,
      label: id,
      ...(server === undefined ? {} : { server }),
      ...(note === undefined ? {} : { note }),
      ...(database === undefined
        ? {}
        : {
          database: {
            host: asText(database.host) ?? '',
            ...(typeof port === 'string'
              ? { port }
              : typeof port === 'number' ? { port: String(port) } : {}),
            name: asText(database.name) ?? '',
            user: asText(database.user) ?? '',
            passwordRef: asText(database.passwordRef) ?? '',
          },
        }),
    }]
  })

  return {
    info: {
      kind,
      repoUrl: asText(repo?.url) ?? '',
      branch: asText(repo?.branch) ?? '—',
      docs: {
        product: asText(docs?.product) ?? '',
        architecture: asText(docs?.architecture) ?? '',
        tests: asText(docs?.tests) ?? '',
      },
      environments,
    },
    problems: [],
  }
}

/**
 * 读本机 `.spec/local.yaml` 里的敏感值。文件不存在返回空表；
 * 这个值只留在浏览器内存里，不写日志、不进模型请求。
 * @param files - 窄化文件面。
 * @param sessionId - 提供相对路径基准的会话。
 * @param signal - 取消信号。
 * @returns `passwordRef` → 本机值的映射。
 */
export async function loadLocalSecrets(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const page = await files.readPage(sessionId, LOCAL_FILE, signal)
  if (!page.ok) return {}

  let doc: Record<string, unknown> | undefined
  try {
    doc = recordOf(parseYaml(page.value.text))
  } catch {
    return {}
  }
  if (doc === undefined) return {}

  const source = recordOf(doc.secrets) ?? doc
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string') out[name] = value
  }
  return out
}

/**
 * 判断一次失败是不是「目标还不存在」。投影把它当作空集而不是故障：
 * 没写过规格的仓库是起点，不是错误。判定走 code 与 message 双保险——
 * 不同文件后端对缺失路径的报错形状不完全一致。
 */
export function isMissing(error: { readonly code?: unknown; readonly message?: unknown }, path: string): boolean {
  const code = typeof error.code === 'string' ? error.code : ''
  if (code.includes('not-found') || code.includes('ENOENT')) return true
  const message = typeof error.message === 'string' ? error.message : ''
  return message.includes(path) && (message.includes('ENOENT') || message.includes('does not exist') || message.includes('不存在'))
}
