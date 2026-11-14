/** 动作日志：读 `.spec/evidence/<任务>/flow.jsonl` 与 `schedule.jsonl`。 */

import { isMissing } from '../spec/rows.ts'
import { readWorkspaceText, SPEC_DIR } from '../spec/files.ts'

/** 一次最多显示的条数。 */
const LIMIT = 20

/** 一条动作记录。 */
export interface ActionLogEntry {
  readonly taskId: string
  readonly source: 'flow' | 'schedule'
  readonly at: string
  readonly action: string
  readonly result: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseFlow(taskId: string, line: string): ActionLogEntry | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(value) || typeof value.action !== 'string') return undefined
  return {
    taskId,
    source: 'flow',
    at: textOf(value.at),
    action: value.action,
    result: textOf(value.result) || textOf(value.mode) || '—',
  }
}

function parseSchedule(taskId: string, line: string): ActionLogEntry | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(value) || typeof value.verdict !== 'string') return undefined
  return {
    taskId,
    source: 'schedule',
    at: textOf(value.at),
    action: '调度',
    result: value.verdict,
  }
}

async function readLines(scope: string, path: string): Promise<string[]> {
  const answer = await readWorkspaceText(scope, path)
  if (!answer.ok) {
    if (isMissing(answer.error, path)) return []
    throw new Error(`${path}: ${answer.error.message}`)
  }
  return answer.text.split('\n').filter(line => line.trim() !== '')
}

/**
 * 读一批任务的动作流水。
 * @param scopeSessionId - 提供相对基准的会话。
 * @param taskIds - 任务编号。
 * @returns 按时刻倒序的最近条目与逐文件问题。
 */
export async function loadActionLog(
  scopeSessionId: string,
  taskIds: readonly string[],
): Promise<{ readonly entries: readonly ActionLogEntry[]; readonly problems: readonly string[] }> {
  const entries: ActionLogEntry[] = []
  const problems: string[] = []
  await Promise.all(taskIds.map(async (taskId) => {
    const dir = `${SPEC_DIR}/evidence/${taskId}`
    try {
      for (const [file, parse] of [['flow.jsonl', parseFlow], ['schedule.jsonl', parseSchedule]] as const) {
        for (const line of await readLines(scopeSessionId, `${dir}/${file}`)) {
          const entry = parse(taskId, line)
          if (entry !== undefined) entries.push(entry)
        }
      }
    } catch (cause: unknown) {
      problems.push(cause instanceof Error ? cause.message : String(cause))
    }
  }))
  entries.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))
  return { entries: entries.slice(0, LIMIT), problems }
}
