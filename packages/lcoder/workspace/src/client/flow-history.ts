/**
 * 流程面板的「最近动作流水」：读 `.spec/evidence/<任务>/flow.jsonl` 与 `schedule.jsonl`。
 *
 * 两个文件都是只追加的审计事实：`flow.jsonl` 记开工与流程判定，`schedule.jsonl`
 * 记分配判定。这里只读、只合并、只排序，不补写缺失的字段；`flow.jsonl` 还没有时
 * 就只显示 `schedule.jsonl`。文件不存在是常态，不记成故障。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isMissing, messageOf } from './projection.ts'
import type { ProjectionFilesRemote } from './projection.ts'

/** 一次最多显示的流水条数。 */
export const ACTION_LOG_LIMIT = 20

/** 一个证据文件最多读几页（每页 `PAGE_LINES` 行），防止超长日志拖住面板。 */
const MAX_PAGES = 4

/** 一条可展示的动作流水。 */
export interface ActionLogEntry {
  readonly taskId: string
  readonly source: 'flow' | 'schedule'
  readonly at: string | null
  readonly action?: string
  readonly mode?: string
  readonly result?: string
  readonly reason?: string
  readonly verdict?: string
  readonly detail?: string
}

/** 读取结果：条目与逐文件问题。 */
export interface ActionLogLoad {
  readonly entries: readonly ActionLogEntry[]
  readonly problems: readonly string[]
}

/**
 * 读一批任务的动作流水。
 * @param files - 窄化文件面。
 * @param sessionId - 提供相对路径基准的会话。
 * @param taskIds - 要读的任务编号；空数组直接返回空表。
 * @param signal - 取消信号。
 * @returns 按时刻倒序的最近条目与读取问题。
 */
export async function loadActionLog(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  taskIds: readonly string[],
  signal: AbortSignal,
): Promise<ActionLogLoad> {
  const entries: ActionLogEntry[] = []
  const problems: string[] = []

  await Promise.all(taskIds.map(async (taskId) => {
    const dir = `.spec/evidence/${taskId}`
    const flow = await readLog(files, sessionId, `${dir}/flow.jsonl`, signal)
    if (flow.problem !== undefined) problems.push(flow.problem)
    if (flow.text !== null) {
      for (const line of linesOf(flow.text)) {
        const entry = flowEntry(taskId, line)
        if (entry !== null) entries.push(entry)
      }
    }

    const schedule = await readLog(files, sessionId, `${dir}/schedule.jsonl`, signal)
    if (schedule.problem !== undefined) problems.push(schedule.problem)
    if (schedule.text !== null) {
      for (const line of linesOf(schedule.text)) {
        const entry = scheduleEntry(taskId, line)
        if (entry !== null) entries.push(entry)
      }
    }
  }))

  entries.sort((left, right) => {
    const a = left.at ?? ''
    const b = right.at ?? ''
    return a < b ? 1 : a > b ? -1 : 0
  })
  return { entries: entries.slice(0, ACTION_LOG_LIMIT), problems }
}

/** 一个有内容的 JSONL 正文；缺失返回 null 且不算问题。 */
async function readLog(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
): Promise<{ text: string | null; problem?: string }> {
  const chunks: string[] = []
  let offset = 1
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await files.readPage(sessionId, path, signal, offset)
    if (!result.ok) {
      if (isMissing(result.error, path)) return { text: null }
      return { text: null, problem: `${path}: ${messageOf(result.error)}` }
    }
    if (result.value.lines > 0) chunks.push(result.value.text)
    if (result.value.eof || result.value.lines === 0) break
    offset += result.value.lines
  }
  return { text: chunks.length === 0 ? null : chunks.join('\n') }
}

function linesOf(text: string): string[] {
  return text.split('\n').filter(line => line.trim() !== '')
}

function flowEntry(taskId: string, line: string): ActionLogEntry | null {
  const row = parseRecord(line)
  if (row === null) return null
  const action = textOf(row.action)
  if (action === null) return null
  const mode = textOf(row.mode)
  const result = textOf(row.result)
  const reason = textOf(row.reason)
  const detail = textOf(row.detail)
  return {
    taskId,
    source: 'flow',
    at: nullableText(row.at),
    action,
    ...(mode === null ? {} : { mode }),
    ...(result === null ? {} : { result }),
    ...(reason === null ? {} : { reason }),
    ...(detail === null ? {} : { detail }),
  }
}

function scheduleEntry(taskId: string, line: string): ActionLogEntry | null {
  const row = parseRecord(line)
  if (row === null) return null
  const verdict = textOf(row.verdict)
  if (verdict === null) return null
  const reasons = Array.isArray(row.reasons)
    ? row.reasons.filter((item): item is string => typeof item === 'string')
    : []
  return {
    taskId,
    source: 'schedule',
    at: nullableText(row.at),
    verdict,
    ...(reasons.length === 0 ? {} : { detail: reasons.join('；') }),
  }
}

function parseRecord(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
