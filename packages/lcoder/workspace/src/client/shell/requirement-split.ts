/**
 * 需求拆分与岗位分配的一键流程。
 *
 * 数据流固定为两个人：项目经理只把已确认的完整需求文档拆成 drafting 任务，
 * 研发经理再按领域给这批新任务定岗位。分配仍是人机命令 `/task_assign`，
 * 外壳只负责在研发经理会话里逐条发起，模型没有分配入口。
 *
 * 分配完成后流程到此为止：任务停在方案讨论列，由相关岗位一起讨论落地方案并逐任务
 * 起草契约，用户确认后才经 `/contract_sign` 与 `/task_contract` 进入待开发
 * （见 `plan-discussion.ts`）。这里不再用 `/task_split_ready` 跳过契约门禁。
 *
 * 等待靠会话事实：宿主推流的 running 与消息窗口里的助手答复。超时或没拆出任务
 * 都如实报失败，不把「发了指令」当成「已拆完」。流程本身不碰 React，
 * 建会话、发送、分配与轮询都从 {@link RequirementSplitPorts} 注入，便于单测。
 */
import type { ShellSessionNotice } from '../model-status.ts'
import type { JobRoleRow } from '../projection.ts'
import type { ShellMessage, ShellSignResult, ShellTask } from './shell-data.ts'
import {
  boundRequirementText, buildRequirementSplitPrompt, requirementDocumentPath, taskDigest,
} from './requirement.ts'
import type { RequirementSplitSource } from './requirement.ts'
import { lastAssistantText, waitForTurn } from './session-turn.ts'

export { lastAssistantText }

/** 项目经理会话的 preset；`lcoder-pm` 带 task_draft，能写 drafting 任务。 */
export const REQUIREMENT_SPLIT_PM_PRESET = 'lcoder-pm'
/** 研发经理会话的 preset；`lcoder-manager` 带 role_draft，不能分配。 */
export const REQUIREMENT_SPLIT_MANAGER_PRESET = 'lcoder-manager'
/** 一轮会话的等待上限：三分钟足够模型读完需求并写任务；到点按失败报。 */
export const REQUIREMENT_SPLIT_TIMEOUT_MS = 180_000
/** 轮询间隔：只看会话与投影事实，不靠 React 重渲染。 */
export const REQUIREMENT_SPLIT_POLL_MS = 1_000

/**
 * 同一需求方案下、除需求本体以外的全部拆分任务，不限状态。
 *
 * 这是「已经拆过」的持久判据：即使这批任务已经进了待开发，重开卡片也能读回来，
 * 不会把同一条需求再拆一遍。
 * @param tasks - 当前投影里的任务。
 * @param requirement - 被拆分的需求任务。
 * @returns 同方案、非本体的任务，保持投影顺序；方案缺失时为空。
 */
export function splitTasksOf(
  tasks: readonly ShellTask[],
  requirement: ShellTask,
): readonly ShellTask[] {
  if (requirement.proposal === undefined) return []
  return tasks.filter(task => task.id !== requirement.id && task.proposal === requirement.proposal)
}

/**
 * 需求方案下仍为 drafting 的拆分任务。
 *
 * 重试与补分配只看这一批：已进待开发或更后状态的由 {@link splitTasksOf} 兜住，
 * 不再进流程。
 * @param tasks - 当前投影里的任务。
 * @param requirement - 被拆分的需求任务。
 * @returns 同方案、非本体的 drafting 任务，保持投影顺序。
 */
export function existingSplitTasks(
  tasks: readonly ShellTask[],
  requirement: ShellTask,
): readonly ShellTask[] {
  return splitTasksOf(tasks, requirement).filter(task => task.state === 'drafting')
}

/**
 * 拆分后新增的 drafting 任务：同方案、拆分前不存在。
 * @param beforeIds - 拆分前投影里的全部任务编号。
 * @param after - 拆分后重读的任务。
 * @param proposal - 需求回指的方案编号。
 * @returns 新任务，保持投影顺序；方案缺失时为空。
 */
export function newDraftingTasks(
  beforeIds: readonly string[],
  after: readonly ShellTask[],
  proposal: string | undefined,
): readonly ShellTask[] {
  if (proposal === undefined) return []
  const before = new Set(beforeIds)
  return after.filter(task => !before.has(task.id) && task.proposal === proposal && task.state === 'drafting')
}

/** 映射里的一条分配：任务编号与岗位 id，都已去首尾空白。 */
export interface AssignmentPair {
  readonly task: string
  readonly role: string
}

/** 最后一条助手消息的解析结果；缺失与坏 JSON 分开，界面据此给不同的下一步。 */
export type AssignmentMappingParse =
  | { readonly kind: 'ok'; readonly pairs: readonly AssignmentPair[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'bad' }

/** 从文本里取 JSON 候选：原文、代码围栏内容、首尾花括号之间。 */
function jsonCandidates(text: string): readonly string[] {
  const candidates: string[] = [text.trim()]
  const fenced = /```(?:json)?\s*([\s\S]*?)```/giu
  for (let match = fenced.exec(text); match !== null; match = fenced.exec(text)) {
    const body = match[1]?.trim() ?? ''
    if (body !== '') candidates.push(body)
  }
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  return candidates.filter(candidate => candidate !== '')
}

/**
 * 解析研发经理最后一条助手消息里的分配映射。
 *
 * 接受裸 JSON 与 ```json 代码围栏；结构必须是 `{ assignments: [{ task, role }] }`。
 * 没有任何 JSON 形状时给 missing，有 JSON 但读不懂时给 bad——两种情况都不猜分配。
 * @param text - 最后一条非空助手答复；没有答复时为 null。
 * @returns 解析结果。
 */
export function parseAssignmentMapping(text: string | null): AssignmentMappingParse {
  if (text === null || text.trim() === '') return { kind: 'missing' }
  let sawJson = false
  for (const candidate of jsonCandidates(text)) {
    if (!candidate.includes('{')) continue
    sawJson = true
    let value: unknown
    try {
      value = JSON.parse(candidate)
    } catch (error) {
      // 候选读不懂就试下一个；全部失败按坏 JSON 报，不丢给界面半截映射。
      void error
      continue
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const assignments = (value as Record<string, unknown>)['assignments']
    if (!Array.isArray(assignments)) continue
    const pairs: AssignmentPair[] = []
    let valid = true
    for (const entry of assignments) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        valid = false
        break
      }
      const record = entry as Record<string, unknown>
      const task = typeof record['task'] === 'string' ? record['task'].trim() : undefined
      const role = typeof record['role'] === 'string' ? record['role'].trim() : undefined
      if (task === undefined || role === undefined) {
        valid = false
        break
      }
      pairs.push({ task, role })
    }
    if (valid) return { kind: 'ok', pairs }
  }
  return sawJson ? { kind: 'bad' } : { kind: 'missing' }
}

/** 被拒绝的一条分配；理由固定，界面按理由查词典。 */
export type RejectedAssignmentReason = 'unknown-task' | 'empty-role' | 'duplicate'

/** 一条没被采用的分配。 */
export interface RejectedAssignment {
  readonly task: string
  readonly role: string
  readonly reason: RejectedAssignmentReason
}

/** 校验后的分配：可用条目保持映射顺序，被拒条目逐条说明。 */
export interface ValidatedAssignments {
  readonly accepted: readonly AssignmentPair[]
  readonly rejected: readonly RejectedAssignment[]
}

/**
 * 把映射校验到这次新拆出的任务集合上。
 *
 * 只认集合内的任务编号与非空岗位；同一任务出现多次时保留第一条。
 * @param pairs - 解析出的分配。
 * @param taskIds - 这次新拆出的任务编号。
 * @returns 可用与被拒的分配。
 */
export function validateAssignments(
  pairs: readonly AssignmentPair[],
  taskIds: ReadonlySet<string>,
): ValidatedAssignments {
  const accepted: AssignmentPair[] = []
  const rejected: RejectedAssignment[] = []
  const seen = new Set<string>()
  for (const pair of pairs) {
    if (pair.role === '') {
      rejected.push({ ...pair, reason: 'empty-role' })
      continue
    }
    if (!taskIds.has(pair.task)) {
      rejected.push({ ...pair, reason: 'unknown-task' })
      continue
    }
    if (seen.has(pair.task)) {
      rejected.push({ ...pair, reason: 'duplicate' })
      continue
    }
    seen.add(pair.task)
    accepted.push(pair)
  }
  return { accepted, rejected }
}

/** 一次分配命令的结果。 */
export interface AssignmentAttempt {
  readonly taskId: string
  readonly roleId: string
  readonly ok: boolean
  /** 命令回执原文；调用本身抛错时是错误文本。 */
  readonly detail: string
}

/** 拆分与分配的汇总：卡片按它画「拆了几条、分配几条、失败明细」。 */
export interface RequirementSplitSummary {
  readonly taskCount: number
  readonly assignedCount: number
  readonly assignments: readonly AssignmentAttempt[]
  readonly rejected: readonly RejectedAssignment[]
  /** 最终仍没有岗位的任务编号。 */
  readonly unassigned: readonly string[]
}

/**
 * 汇总一次流程的最终状态。
 * @param newTasks - 这次处理的任务（可能已带有岗位）。
 * @param attempts - 逐条分配命令的结果。
 * @param rejected - 映射里被拒的条目。
 * @returns 计数、逐条结果与未分配任务。
 */
export function summarizeSplit(
  newTasks: readonly ShellTask[],
  attempts: readonly AssignmentAttempt[],
  rejected: readonly RejectedAssignment[],
): RequirementSplitSummary {
  const succeeded = new Set(attempts.filter(attempt => attempt.ok).map(attempt => attempt.taskId))
  // 被拒条目已经在明细里说明过；同一任务不再重复画一条「仍未分配」。
  const rejectedTasks = new Set(rejected.map(item => item.task))
  const unassigned = newTasks
    .filter(task => task.role === undefined && !succeeded.has(task.id) && !rejectedTasks.has(task.id))
    .map(task => task.id)
  const assignedCount = newTasks
    .filter(task => task.role !== undefined || succeeded.has(task.id))
    .length
  return {
    taskCount: newTasks.length,
    assignedCount,
    assignments: attempts,
    rejected,
    unassigned,
  }
}

/**
 * 项目经理的拆分指令：在 T-138 的拆分正文外补明执行身份、仓库现状判断与基础任务规则。
 *
 * 正文仍以完整需求文档为唯一范围依据；这里只强调只写 `.spec/tasks` 下的
 * drafting 任务、不改需求与方案、不开始实现，并要求先判断仓库是否已有可运行框架：
 * 空仓时第一条必须是「项目基础框架与脚手架」，所有功能任务依赖它；已有框架只补缺口。
 * 岗位分配交给研发经理。
 * @param task - 被拆分的需求任务。
 * @param source - 卡片读到的完整需求文档。
 * @returns 中文指令正文。
 */
export function buildPmSplitPrompt(task: ShellTask, source: RequirementSplitSource): string {
  return [
    buildRequirementSplitPrompt(task, source),
    '',
    '执行身份：你是这条需求的项目经理，负责把已确认的需求拆成开发任务。',
    '- 用户已在界面上确认这份需求并亲自点击「拆分任务」，这就是明确的拆分授权；不要再要求批准方案或重复追问。',
    '- 只产出 .spec/tasks 下的任务文件，state 一律 drafting；只做只读查看，不开始实现，不调用编辑与命令工具。',
    '- 不改需求文档、.spec/project.yaml、已有方案与规格条目，不推进任何任务状态。',
    '- 拆完只回报新建任务的编号、标题与依赖，然后停下；岗位分配由研发经理接手。',
    '',
    '仓库现状与基础任务：',
    '- 拆分前先用 file_list 查看仓库根目录与关键文件，判断它是空仓、只有需求文档，还是已有可运行的项目框架；把这个判断写进回复。',
    '- 空仓或没有可运行框架时，第一条任务必须是「项目基础框架与脚手架」：',
    '  - 范围：技术选型落地（语言、桌面外壳、本地存储形式）、目录与模块骨架、开发与构建与打包命令、基础窗口、数据读写骨架。',
    '  - 验收：双击即可运行、断网可用的最小验证。',
    '  - 依赖：它不依赖任何功能任务；所有功能任务都在 depends_on 里依赖这条基础任务。',
    '  - 字段：同样写清 description 的范围与验收标准、grade、rules、scope.allowed_paths，state 为 drafting；需求里没有对应规则时 rules 留空。',
    '- 仓库已有可运行框架时不重复建设，只按实际缺口补最少的基础任务（如缺少打包脚本、缺少数据层骨架）；没有缺口就不建。',
    '- 「项目基础框架与脚手架」是「可独立验收的业务结果」的唯一例外，按整体验收，不要拆成零散技术步骤。',
  ].join('\n')
}

/** 研发经理的分配输入：本批待分配任务与当前名册。 */
export interface ManagerAssignInput {
  readonly task: ShellTask
  /** 卡片读到的完整需求文档；作为任务范围的唯一依据。 */
  readonly source: RequirementSplitSource
  /** 这一轮要分配的任务，保持投影顺序。 */
  readonly newTasks: readonly ShellTask[]
  /** `.spec/roles.yaml` 当前名册；空数组合法。 */
  readonly roster: readonly JobRoleRow[]
}

/** 名册里一组信号的展示文本；三组都空时不出现。 */
function signalsText(row: JobRoleRow): string {
  const groups: readonly (readonly [keyof NonNullable<JobRoleRow['signals']>, string])[] = [
    ['strong', '强特征'],
    ['medium', '弱语义'],
    ['preferredPaths', '落点'],
  ]
  const parts = groups.flatMap(([key, label]) => {
    const values = row.signals?.[key] ?? []
    return values.length === 0 ? [] : [`${label}：${values.join('、')}`]
  })
  return parts.length === 0 ? '' : `；${parts.join('；')}`
}

/** 当前名册的逐行展示；空名册也如实写出来。 */
function rosterLines(roster: readonly JobRoleRow[]): readonly string[] {
  if (roster.length === 0) return ['（名册为空：还没有自定岗位；缺什么岗位就先用 role_draft 起草）']
  return roster.map(row => `- ${row.id}（${row.name}，继承 ${row.inherits}${signalsText(row)}）`)
}

/**
 * 研发经理的分配指令：完整需求文档 + 本批任务 + 当前名册 + 固定的 JSON 映射契约。
 *
 * 最后一条助手消息只输出 JSON，外壳才能逐条发起 `/task_assign`；
 * 基础框架与脚手架任务固定给架构师，其余任务按领域定岗位。
 * 任务状态、代码与需求都不由这个角色改。
 * @param input - 需求、本批任务与当前名册。
 * @returns 中文指令正文。
 */
export function buildManagerAssignPrompt(input: ManagerAssignInput): string {
  const path = requirementDocumentPath(input.task)
  const excerpt = boundRequirementText(input.source.document ?? '')
  const lines = [
    `岗位分配：请为需求 ${input.task.id}（${input.task.title}）这次拆出的开发任务分配岗位。`,
    '',
    `依据：以末尾附上的《项目需求概要》（${path}）为准，按任务涉及的领域定岗位；文档里暂不开发的范围不设岗位。`,
    '',
    '要分配的任务（只给这批任务定岗位）：',
    ...(input.newTasks.length === 0
      ? ['（没有待分配的任务）']
      : input.newTasks.flatMap(task => [
        `- ${task.id}：${task.title}`,
        `  描述摘要：${taskDigest(task)}`,
      ])),
    '',
    '当前岗位名册（.spec/roles.yaml）：',
    ...rosterLines(input.roster),
    '',
    '要求：',
    '- 按领域分配：架构与模块边界给架构师，前端页面给前端岗位，后端接口给后端岗位，测试给测试岗位；能复用名册岗位就复用。',
    '- 缺合适岗位时，先用 role_draft 起草（一个 id、一个显示名、一个必须继承的内置角色，signals 写清强特征、弱语义词与落点前缀），再在映射里用新岗位 id。',
    '- 「项目基础框架与脚手架」任务给架构师：它涉及技术选型、目录骨架、构建与打包。名册里没有架构师或脚手架岗位时，按上一条用 role_draft 起草，继承 architect 或 dev，signals 写清技术选型、脚手架、构建、打包特征。',
    '- 其余任务里的打包与本地存储、界面与交互仍按领域分配，不因为基础任务把功能任务都堆给架构师。',
    '- 只定岗位：不新建任务、不改任务状态、不写代码、不跑命令、不改需求与方案；分配命令由外壳执行。',
    '- 最后一条助手消息只输出一个 JSON 对象，不要解释、不要代码围栏之外的多余文字：',
    '{"assignments":[{"task":"T-02","role":"architect"}]}',
    '- 每条任务恰好出现一次；role 填岗位 id，不要填显示名；任务编号只能取自上面这批，不确定的任务宁可漏掉也不要编造。',
    '',
    `《项目需求概要》正文（${path}）：`,
    '"""',
    excerpt.text,
    '"""',
  ]
  if (excerpt.truncated) {
    lines.push('', `（正文在本指令里按段落截断在上限内；未附上的部分请读取 ${path} 后再分配，不要凭猜测补范围。）`)
  }
  return lines.join('\n')
}

/** 流程当前走到哪一段；卡片按它显示「项目经理拆分中」一类的状态。 */
export type RequirementSplitStage = 'pm' | 'manager' | 'assigning'

/** 一次进度通知；`newTasks` 只在已知拆分结果时出现。 */
export interface RequirementSplitProgress {
  readonly stage: RequirementSplitStage
  readonly newTasks?: readonly ShellTask[]
}

/** 失败原因；界面按它查词典，不直接显示这段 code。 */
export type RequirementSplitFailureReason =
  | 'no-document'
  | 'create'
  | 'send'
  | 'timeout'
  | 'empty'
  | 'session-failed'
  | 'missing-mapping'
  | 'bad-mapping'
  | 'no-valid-assignment'

/** 流程失败：停在哪一段、为什么、已拆出的任务仍保留。 */
export interface RequirementSplitFailure {
  readonly kind: 'failed'
  readonly stage: 'pm' | 'manager'
  readonly reason: RequirementSplitFailureReason
  /** 宿主给的具体原因；没有时为 undefined。 */
  readonly detail?: string
  readonly newTasks: readonly ShellTask[]
}

/** 流程结果：完成、失败或调用方取消。 */
export type RequirementSplitOutcome =
  | {
    readonly kind: 'done'
    /** 项目经理会话；重试直接进研发经理时没有。 */
    readonly pmSession?: string
    /** 研发经理会话；这批任务都已分配岗位时没有。 */
    readonly managerSession?: string
    readonly newTasks: readonly ShellTask[]
    readonly summary: RequirementSplitSummary
  }
  | RequirementSplitFailure
  | { readonly kind: 'cancelled' }

/** 流程输入：需求、本批任务与拆前快照。 */
export interface RequirementSplitPlan {
  readonly task: ShellTask
  readonly source: RequirementSplitSource
  /** `.spec/roles.yaml` 的当前名册；进研发经理前会再读一次。 */
  readonly roster: readonly JobRoleRow[]
  /**
   * 已拆出的任务；非空时跳过项目经理，只补分配。
   * 其中已带岗位的任务不再进研发经理的清单。
   */
  readonly existingTasks?: readonly ShellTask[]
  /** 拆分前投影里的全部任务编号，用来过滤新任务。 */
  readonly beforeTaskIds: readonly string[]
  readonly timeoutMs?: number
  readonly pollMs?: number
}

/** 流程的外部动作；全部注入，便于不启 React 也能测整条链路。 */
export interface RequirementSplitPorts {
  /** 按角色 preset 新建会话，返回会话号。 */
  createSession(preset: string): Promise<string>
  sendPrompt(sessionId: string, text: string): Promise<void>
  /** 持有会话引用，返回释放函数；不持有就读不到消息。 */
  holdSession(sessionId: string): () => void
  readMessages(sessionId: string): readonly ShellMessage[]
  readNotice(sessionId: string): ShellSessionNotice | null
  /** 宿主推流的运行位；读不到时为 undefined。 */
  isRunning(sessionId: string): boolean | undefined
  assignTask(sessionId: string, taskId: string, roleId: string): Promise<ShellSignResult>
  loadTasks(): Promise<readonly ShellTask[]>
  loadRoster(): Promise<readonly JobRoleRow[]>
  now(): number
  sleep(ms: number): Promise<void>
}

/** 等待调用方的额外输入。 */
export interface RequirementSplitOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: RequirementSplitProgress) => void
}

/** 失败结果的构造口；新增任务原样带回，重试时不必再拆一遍。 */
function failure(
  stage: 'pm' | 'manager',
  reason: RequirementSplitFailureReason,
  newTasks: readonly ShellTask[],
  detail?: string,
): RequirementSplitFailure {
  return { kind: 'failed', stage, reason, newTasks, ...(detail === undefined ? {} : { detail }) }
}

/**
 * 跑完一键拆分：项目经理拆任务 → 研发经理给岗位 → 外壳逐条执行分配命令。
 *
 * `existingTasks` 非空时跳过项目经理，只补分配——重试与刷新后重开都靠这条，
 * 不会重复建项目经理会话或重复拆任务。任何一段失败都返回原因与已拆出的任务，
 * 调用方保留卡片让用户重试。
 * @param plan - 需求、本批任务、拆前快照与超时。
 * @param ports - 建会话、发送、读会话、分配与轮询的注入面。
 * @param options - 取消信号与进度回调。
 * @returns 完成、失败或取消。
 */
export async function runRequirementSplit(
  plan: RequirementSplitPlan,
  ports: RequirementSplitPorts,
  options: RequirementSplitOptions = {},
): Promise<RequirementSplitOutcome> {
  const timeoutMs = plan.timeoutMs ?? REQUIREMENT_SPLIT_TIMEOUT_MS
  const pollMs = plan.pollMs ?? REQUIREMENT_SPLIT_POLL_MS
  const excerpt = boundRequirementText(plan.source.document ?? '')
  if (excerpt.text === '') return failure('pm', 'no-document', [])

  const releases: (() => void)[] = []
  const open = async (preset: string): Promise<string> => {
    const sessionId = await ports.createSession(preset)
    releases.push(ports.holdSession(sessionId))
    return sessionId
  }

  try {
    let pmSession: string | undefined
    let newTasks: readonly ShellTask[] = plan.existingTasks ?? []
    if (newTasks.length === 0) {
      options.onProgress?.({ stage: 'pm' })
      try {
        pmSession = await open(REQUIREMENT_SPLIT_PM_PRESET)
      } catch (error: unknown) {
        return failure('pm', 'create', [], String(error))
      }
      try {
        await ports.sendPrompt(pmSession, buildPmSplitPrompt(plan.task, plan.source))
      } catch (error: unknown) {
        return failure('pm', 'send', [], String(error))
      }
      const waited = await waitForTurn({
        ports,
        sessionId: pmSession,
        timeoutMs,
        pollMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (waited.kind === 'cancelled') return { kind: 'cancelled' }
      if (waited.kind === 'timeout') return failure('pm', 'timeout', [])
      if (waited.kind === 'failed') return failure('pm', 'session-failed', [], waited.detail)
      const after = await ports.loadTasks()
      newTasks = newDraftingTasks(plan.beforeTaskIds, after, plan.task.proposal)
      if (newTasks.length === 0) return failure('pm', 'empty', [])
    }

    // 分配只补没有岗位的任务：重试时已经分配过的任务不再进研发经理的清单。
    const toAssign = newTasks.filter(task => task.role === undefined && task.state === 'drafting')
    let managerSession: string | undefined
    let attempts: readonly AssignmentAttempt[] = []
    let rejected: readonly RejectedAssignment[] = []
    if (toAssign.length > 0) {
      options.onProgress?.({ stage: 'manager', newTasks })
      let roster = plan.roster
      try {
        roster = await ports.loadRoster()
      } catch (error: unknown) {
        // 名册读不出来就沿用打开卡片时的投影；不让一次读盘失败挡住分配。
        void error
      }
      try {
        managerSession = await open(REQUIREMENT_SPLIT_MANAGER_PRESET)
      } catch (error: unknown) {
        return failure('manager', 'create', newTasks, String(error))
      }
      try {
        await ports.sendPrompt(managerSession, buildManagerAssignPrompt({
          task: plan.task, source: plan.source, newTasks: toAssign, roster,
        }))
      } catch (error: unknown) {
        return failure('manager', 'send', newTasks, String(error))
      }
      const waited = await waitForTurn({
        ports,
        sessionId: managerSession,
        timeoutMs,
        pollMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (waited.kind === 'cancelled') return { kind: 'cancelled' }
      if (waited.kind === 'timeout') return failure('manager', 'timeout', newTasks)
      if (waited.kind === 'failed') return failure('manager', 'session-failed', newTasks, waited.detail)

      const parsed = parseAssignmentMapping(lastAssistantText(waited.messages))
      if (parsed.kind === 'missing') return failure('manager', 'missing-mapping', newTasks)
      if (parsed.kind === 'bad') return failure('manager', 'bad-mapping', newTasks)
      const validated = validateAssignments(parsed.pairs, new Set(toAssign.map(task => task.id)))
      if (validated.accepted.length === 0) {
        return failure('manager', 'no-valid-assignment', newTasks)
      }

      options.onProgress?.({ stage: 'assigning', newTasks })
      const assigned: AssignmentAttempt[] = []
      for (const pair of validated.accepted) {
        try {
          const result = await ports.assignTask(managerSession, pair.task, pair.role)
          assigned.push({ taskId: pair.task, roleId: pair.role, ok: result.ok, detail: result.text })
        } catch (error: unknown) {
          assigned.push({ taskId: pair.task, roleId: pair.role, ok: false, detail: String(error) })
        }
      }
      attempts = assigned
      rejected = validated.rejected
    }

    // 分配完成后流程到此为止：任务留在方案讨论列，由契约门禁决定何时进待开发。
    return {
      kind: 'done',
      ...(pmSession === undefined ? {} : { pmSession }),
      ...(managerSession === undefined ? {} : { managerSession }),
      newTasks,
      summary: summarizeSplit(newTasks, attempts, rejected),
    }
  } finally {
    for (const release of releases) release()
  }
}
