/**
 * 需求拆分：项目经理把已确认的完整需求文档拆成 drafting 任务，只标归属轨。
 *
 * 拆分不再分配岗位：轨说明任务落在哪条交付面，方案讨论按轨邀请技术岗位；
 * 具体岗位留给实施阶段的人机命令 `/task_assign`。分配命令仍在内核里，只是本流程不调用。
 *
 * 拆完的任务停在方案讨论列，由相关角色一起讨论落地方案并逐任务起草契约，用户确认后
 * 才经 `/contract_sign` 与 `/task_contract` 进入待开发（见 `plan-discussion.ts`）。
 * 这里不再用 `/task_split_ready` 跳过契约门禁。
 *
 * 等待靠会话事实：宿主推流的 running 与消息窗口里的助手答复。超时、没拆出任务、
 * 有任务没标轨都如实报失败，不把「发了指令」当成「已拆完」。流程本身不碰 React，
 * 建会话、发送与轮询都从 {@link RequirementSplitPorts} 注入，便于单测。
 */
import type { ShellSessionNotice } from '../model-status.ts'
import type { TrackDescriptor } from '@lcoder/kernel/src/schema/tracks.ts'
import type { ShellMessage, ShellTask } from './shell-data.ts'
import { boundRequirementText, buildRequirementSplitPrompt } from './requirement.ts'
import type { RequirementRef, RequirementSplitSource } from './requirement.ts'
import { lastAssistantText, waitForTurn } from './session-turn.ts'

export { lastAssistantText }

/** 项目经理会话的 preset；`lcoder-pm` 带 task_draft，能写 drafting 任务。 */
export const REQUIREMENT_SPLIT_PM_PRESET = 'lcoder-pm'
/** 一轮会话的等待上限：三分钟足够模型读完需求并写任务；到点按失败报。 */
export const REQUIREMENT_SPLIT_TIMEOUT_MS = 180_000
/** 轮询间隔：只看会话与投影事实，不靠 React 重渲染。 */
export const REQUIREMENT_SPLIT_POLL_MS = 1_000

/** 任务是否回指这条需求；新流程读 `requirement`，旧任务只有 `proposal`。 */
function belongsTo(task: ShellTask, requirement: string): boolean {
  return task.requirement === requirement
    || (task.requirement === undefined && task.proposal === requirement)
}

/**
 * 同一需求下的全部拆分任务，不限状态。
 *
 * 这是「已经拆过」的持久判据：即使这批任务已经进了待开发，重开详情也能读回来，
 * 不会把同一条需求再拆一遍。
 * @param tasks - 当前投影里的任务。
 * @param requirementId - 被拆分的需求编号。
 * @returns 回指该需求的任务，保持投影顺序。
 */
export function splitTasksOf(
  tasks: readonly ShellTask[],
  requirementId: string,
): readonly ShellTask[] {
  return tasks.filter(task => task.id !== requirementId && belongsTo(task, requirementId))
}

/**
 * 需求下仍为 drafting 的拆分任务。
 *
 * 重试只看这一批：已进待开发或更后状态的由 {@link splitTasksOf} 兜住，不再进流程。
 * @param tasks - 当前投影里的任务。
 * @param requirementId - 被拆分的需求编号。
 * @returns 回指该需求的 drafting 任务，保持投影顺序。
 */
export function existingSplitTasks(
  tasks: readonly ShellTask[],
  requirementId: string,
): readonly ShellTask[] {
  return splitTasksOf(tasks, requirementId).filter(task => task.state === 'drafting')
}

/**
 * 拆分后新增的 drafting 任务：回指该需求且拆分前不存在。
 * @param beforeIds - 拆分前投影里的全部任务编号。
 * @param after - 拆分后重读的任务。
 * @param requirementId - 需求编号。
 * @returns 新任务，保持投影顺序。
 */
export function newDraftingTasks(
  beforeIds: readonly string[],
  after: readonly ShellTask[],
  requirementId: string,
): readonly ShellTask[] {
  const before = new Set(beforeIds)
  return after.filter(task => !before.has(task.id) && belongsTo(task, requirementId) && task.state === 'drafting')
}

/** 一条轨上拆出的任务数。 */
export interface TrackCount {
  readonly track: string
  readonly count: number
}

/** 拆分汇总：新增条数、按轨分布与仍未标轨的任务。 */
export interface RequirementSplitSummary {
  readonly taskCount: number
  readonly tracks: readonly TrackCount[]
  /** 仍没有轨的任务编号；非空时流程按失败报。 */
  readonly untracked: readonly string[]
}

/**
 * 只统计已标轨任务的分布，保持任务在投影里的首次出现顺序。
 * @param tasks - 这次拆出的任务。
 * @returns 轨 id 与条数。
 */
export function trackDistribution(tasks: readonly ShellTask[]): readonly TrackCount[] {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (task.track === undefined) continue
    counts.set(task.track, (counts.get(task.track) ?? 0) + 1)
  }
  return [...counts.entries()].map(([track, count]) => ({ track, count }))
}

/**
 * 汇总一次拆分的最终状态。
 * @param tasks - 这次拆出的任务。
 * @returns 新增条数、按轨分布与未标轨任务编号。
 */
export function summarizeSplit(tasks: readonly ShellTask[]): RequirementSplitSummary {
  return {
    taskCount: tasks.length,
    tracks: trackDistribution(tasks),
    untracked: tasks.filter(task => task.track === undefined).map(task => task.id),
  }
}

/**
 * 项目经理的拆分指令：在基础拆分正文外补明执行身份、调研要求与基础任务规则。
 *
 * 正文仍以完整需求文档为唯一范围依据；这里只强调只写 `.spec/tasks` 下的
 * drafting 任务、不改需求与方案、不开始实现，并要求先调研仓库现状：
 * 空仓时第一条必须是「项目基础框架与脚手架」，所有功能任务依赖它；已有框架只补缺口。
 * 每条任务必须标一条轨；分配留给实施阶段的人。
 * @param requirement - 被拆分的需求：REQ 编号与标题。
 * @param source - 详情读到的完整需求文档。
 * @param tracks - 这次可用的轨；缺省为内置六轨。
 * @returns 中文指令正文。
 */
export function buildPmSplitPrompt(
  requirement: RequirementRef,
  source: RequirementSplitSource,
  tracks?: readonly TrackDescriptor[],
): string {
  return [
    buildRequirementSplitPrompt(requirement, source, tracks),
    '',
    '执行身份：你是这条需求的项目经理，负责把已确认的需求拆成开发任务。',
    '- 用户已在界面上确认这份需求并亲自点击「拆分任务」，这就是明确的拆分授权；不要再要求批准方案或重复追问。',
    '- 只产出 .spec/tasks 下的任务文件，state 一律 drafting；只做只读查看，不开始实现，不调用编辑与命令工具。',
    '- 不改需求文档、.spec/project.yaml、已有方案与规格条目，不推进任何任务状态。',
    '- 拆完只回报新建任务的编号、标题、轨与依赖，然后停下；岗位分配给实施阶段的人。',
    '',
    '仓库现状与基础任务：',
    '- 先用 file_list 查看仓库根目录与关键文件，判断它是空仓、只有需求文档，还是已有可运行的项目框架；把这个判断写进回复。',
    '- 空仓或没有可运行框架时，第一条任务必须是「项目基础框架与脚手架」：',
    '  - 范围：技术选型落地（语言、桌面外壳、本地存储形式）、目录与模块骨架、开发与构建与打包命令、基础窗口、数据读写骨架。',
    '  - 验收：双击即可运行、断网可用的最小验证。',
    '  - 依赖：它不依赖任何功能任务；所有功能任务都在 depends_on 里依赖这条基础任务。',
    '  - 字段：同样写清 description 的范围与验收标准、grade、rules、scope.allowed_paths、track，state 为 drafting；需求里没有对应规则时 rules 留空。',
    '- 仓库已有可运行框架时不重复建设，只按实际缺口补最少的基础任务（如缺少打包脚本、缺少数据层骨架）；没有缺口就不建。',
    '- 「项目基础框架与脚手架」是「可独立验收的业务结果」的唯一例外，按整体验收，不要拆成零散技术步骤。',
  ].join('\n')
}

/** 流程当前走到哪一段；卡片按它显示「项目经理拆分中」一类的状态。 */
export type RequirementSplitStage = 'pm'

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
  | 'untracked'

/** 流程失败：停在哪一段、为什么、已拆出的任务仍保留。 */
export interface RequirementSplitFailure {
  readonly kind: 'failed'
  readonly stage: RequirementSplitStage
  readonly reason: RequirementSplitFailureReason
  /** 宿主给的具体原因；没有时为 undefined。 */
  readonly detail?: string
  /** 未标轨的任务编号；`untracked` 时出现。 */
  readonly untracked?: readonly string[]
  readonly newTasks: readonly ShellTask[]
}

/** 流程结果：完成、失败或调用方取消。 */
export type RequirementSplitOutcome =
  | {
    readonly kind: 'done'
    /** 项目经理会话；重试（已有任务）时没有。 */
    readonly pmSession?: string
    readonly newTasks: readonly ShellTask[]
    readonly summary: RequirementSplitSummary
  }
  | RequirementSplitFailure
  | { readonly kind: 'cancelled' }

/** 流程输入：需求、可用轨与拆前快照。 */
export interface RequirementSplitPlan {
  readonly requirement: RequirementRef
  readonly source: RequirementSplitSource
  /** 这次可用的轨：内置六轨加项目追加轨。 */
  readonly tracks: readonly TrackDescriptor[]
  /**
   * 已拆出的任务；非空时跳过项目经理，不再拆第二遍。
   * 这些任务必须已经带轨，否则流程按 `untracked` 失败。
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
  loadTasks(): Promise<readonly ShellTask[]>
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
  reason: RequirementSplitFailureReason,
  newTasks: readonly ShellTask[],
  detail?: string,
  untracked?: readonly string[],
): RequirementSplitFailure {
  return {
    kind: 'failed',
    stage: 'pm',
    reason,
    newTasks,
    ...(detail === undefined ? {} : { detail }),
    ...(untracked === undefined ? {} : { untracked }),
  }
}

/**
 * 跑完一键拆分：项目经理拆任务并逐条标轨。
 *
 * `existingTasks` 非空时不再建会话、不再拆第二遍——重试与刷新后重开都靠这条。
 * 任何一段失败都返回原因与已拆出的任务，调用方保留卡片让用户重试。
 * @param plan - 需求、可用轨、本批任务与超时。
 * @param ports - 建会话、发送、读会话与轮询的注入面。
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
  if (excerpt.text === '') return failure('no-document', [])

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
        return failure('create', [], String(error))
      }
      try {
        await ports.sendPrompt(pmSession, buildPmSplitPrompt(plan.requirement, plan.source, plan.tracks))
      } catch (error: unknown) {
        return failure('send', [], String(error))
      }
      const waited = await waitForTurn({
        ports,
        sessionId: pmSession,
        timeoutMs,
        pollMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (waited.kind === 'cancelled') return { kind: 'cancelled' }
      if (waited.kind === 'timeout') return failure('timeout', [])
      if (waited.kind === 'failed') return failure('session-failed', [], waited.detail)
      const after = await ports.loadTasks()
      newTasks = newDraftingTasks(plan.beforeTaskIds, after, plan.requirement.id)
      if (newTasks.length === 0) return failure('empty', [])
    }

    // 拆分只标轨：有任务没标轨就不算拆完，交给用户补齐或重新拆分。
    const summary = summarizeSplit(newTasks)
    if (summary.untracked.length > 0) {
      return failure('untracked', newTasks, undefined, summary.untracked)
    }
    return {
      kind: 'done',
      ...(pmSession === undefined ? {} : { pmSession }),
      newTasks,
      summary,
    }
  } finally {
    for (const release of releases) release()
  }
}
