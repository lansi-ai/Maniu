/**
 * Agent 状态大盘的数据面：汇总会话与任务、合并证据目录里的动作日志。
 *
 * 状态只取宿主推流与投影已有的事实：会话忙闲、队列长度、认领关系与更新时间都不在这里
 * 补写或猜测；事件流把每个任务的 `flow.jsonl` 与 `schedule.jsonl` 合并后按时刻倒序截断。
 * 单个任务的日志读失败只记在该任务名下，不影响其它任务与整页。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  parseFlowEntry, parseScheduleEntry, readEvidenceLog,
} from './flow-history.ts'
import type { ActionLogEntry } from './flow-history.ts'
import type { ProjectionFilesRemote } from './projection.ts'
import type { ShellTaskState } from './shell/shell-data.ts'

/** 状态大盘最多显示的事件条数。 */
export const DASHBOARD_EVENT_LIMIT = 30

/** 自动刷新间隔；离开页签后由组件卸载停止。 */
export const DASHBOARD_REFRESH_MS = 15_000

/** 一条会话在大盘上的状态；等待人优先于运行中优先于空闲。 */
export type DashboardSessionState = 'waiting' | 'running' | 'idle'

/** 会话表的一行。 */
export interface DashboardSessionRow {
  readonly sessionId: string
  readonly name: string
  /** 有效岗位的显示名；读不到岗位时是「未分配」或「未知岗位」。 */
  readonly role: string
  readonly status: DashboardSessionState
  /** 当前认领任务；缺省表示未认领。 */
  readonly taskId?: string
  readonly taskTitle?: string
  readonly queue: number
  /** 宿主给出的最近更新时刻（epoch 毫秒）；无此字段时不显示。 */
  readonly updatedAt?: number
  readonly workspace: string
}

/** 汇总条的数据。 */
export interface DashboardSummary {
  readonly total: number
  readonly running: number
  readonly idle: number
  readonly waiting: number
  readonly queueTotal: number
  readonly tasks: Readonly<Record<ShellTaskState, number>>
}

/** 一个任务的日志读取结果。 */
export interface DashboardTaskEvents {
  readonly taskId: string
  readonly entries: readonly ActionLogEntry[]
  /** 该任务的读取问题；只影响这一行的标注。 */
  readonly problem?: string
}

/** 合并后的事件流与逐任务问题。 */
export interface DashboardEventLoad {
  readonly entries: readonly ActionLogEntry[]
  readonly problems: Readonly<Record<string, string>>
}

/**
 * 从宿主状态推出一条会话的状态。
 * @param input - 待处理的交互（等待人）与运行标志。
 * @returns 等待人、运行中或空闲。
 */
export function dashboardStatusOf(input: {
  readonly pendingInteraction?: unknown
  readonly running?: boolean
}): DashboardSessionState {
  if (input.pendingInteraction !== undefined) return 'waiting'
  return input.running === true ? 'running' : 'idle'
}

/**
 * 汇总会话与任务计数。
 * @param sessions - 会话表行。
 * @param tasks - 当前投影里的任务状态。
 * @returns 汇总条数字。
 */
export function summarizeDashboard(
  sessions: readonly DashboardSessionRow[],
  tasks: readonly { readonly state: ShellTaskState }[],
): DashboardSummary {
  const tasksByState: Record<ShellTaskState, number> = {
    drafting: 0,
    contracted: 0,
    implementing: 0,
    verifying: 0,
    closed: 0,
  }
  for (const task of tasks) tasksByState[task.state] += 1
  return {
    total: sessions.length,
    running: sessions.filter(session => session.status === 'running').length,
    idle: sessions.filter(session => session.status === 'idle').length,
    waiting: sessions.filter(session => session.status === 'waiting').length,
    queueTotal: sessions.reduce((sum, session) => sum + session.queue, 0),
    tasks: tasksByState,
  }
}

/**
 * 把各任务的日志条目合并、按时刻倒序截断，并收拢逐任务问题。
 * 没有时刻的条目排在最后；同一时刻保持输入顺序。
 * @param inputs - 每个任务的条目与读取问题。
 * @param limit - 最多保留的条数。
 * @returns 事件流与按任务编号索引的问题。
 */
export function mergeDashboardEvents(
  inputs: readonly DashboardTaskEvents[],
  limit: number = DASHBOARD_EVENT_LIMIT,
): DashboardEventLoad {
  const entries = inputs.flatMap(input => [...input.entries])
  entries.sort((left, right) => {
    const a = left.at ?? ''
    const b = right.at ?? ''
    return a < b ? 1 : a > b ? -1 : 0
  })
  const problems: Record<string, string> = {}
  for (const input of inputs) {
    if (input.problem !== undefined && input.problem !== '') problems[input.taskId] = input.problem
  }
  return { entries: entries.slice(0, limit), problems }
}

/**
 * 读一批任务的动作日志并合并。
 *
 * 单个任务的任一文件读取抛错时，只把该任务的条目清空并记下问题；
 * 其它任务照常返回，整页不被挡住。
 * @param files - 窄化文件面。
 * @param sessionId - 提供相对路径基准的会话。
 * @param taskIds - 要读的任务编号。
 * @param signal - 取消信号。
 * @returns 合并后的事件流与逐任务问题。
 */
export async function loadDashboardEvents(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  taskIds: readonly string[],
  signal: AbortSignal,
): Promise<DashboardEventLoad> {
  const groups: DashboardTaskEvents[] = []
  await Promise.all(taskIds.map(async (taskId) => {
    const dir = `.spec/evidence/${taskId}`
    const entries: ActionLogEntry[] = []
    const problems: string[] = []
    try {
      const flow = await readEvidenceLog(files, sessionId, `${dir}/flow.jsonl`, signal)
      if (flow.problem !== undefined) problems.push(flow.problem)
      if (flow.text !== null) {
        for (const line of flow.text.split('\n')) {
          const entry = parseFlowEntry(taskId, line)
          if (entry !== null) entries.push(entry)
        }
      }
      const schedule = await readEvidenceLog(files, sessionId, `${dir}/schedule.jsonl`, signal)
      if (schedule.problem !== undefined) problems.push(schedule.problem)
      if (schedule.text !== null) {
        for (const line of schedule.text.split('\n')) {
          const entry = parseScheduleEntry(taskId, line)
          if (entry !== null) entries.push(entry)
        }
      }
    } catch (error: unknown) {
      entries.length = 0
      problems.push(`${dir}: ${String(error)}`)
    }
    groups.push({
      taskId,
      entries,
      ...(problems.length === 0 ? {} : { problem: problems.join('；') }),
    })
  }))
  return mergeDashboardEvents(groups)
}

/**
 * 最近更新时刻的展示文本；没有宿主字段时显示横线，不编造。
 * @param updatedAt - 宿主给出的 epoch 毫秒。
 * @returns `YYYY-MM-DD HH:mm` 或 `—`。
 */
export function updatedAtLabel(updatedAt: number | undefined): string {
  if (updatedAt === undefined || updatedAt <= 0) return '—'
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
