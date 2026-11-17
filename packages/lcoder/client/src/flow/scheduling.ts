/** 调度建议：按依赖、工作区、岗位与关联信号给出可解释的判定。 */

import type { TaskRow } from '../spec/rows.ts'
import type { SessionSummary } from '../store.ts'

/** 判定结果。 */
export type ScheduleVerdict = 'reuse' | 'enqueue' | 'new' | 'wait'

/** 一个候选会话。 */
export interface ScheduleCandidate {
  readonly sessionId: string
  readonly score: number
  readonly signals: readonly string[]
  readonly rejected?: string
}

/** 一次判定。 */
export interface ScheduleDecision {
  readonly verdict: ScheduleVerdict
  readonly chosen?: string
  readonly reasons: readonly string[]
  readonly blockedBy: readonly string[]
  readonly candidates: readonly ScheduleCandidate[]
}

function normalizePath(value: string): string {
  const slashed = value.split('\\').join('/').replace(/\/+$/u, '')
  return /^[A-Za-z]:\//u.test(slashed) ? slashed.toLowerCase() : slashed
}

function sameWorkspace(left: string, right: string): boolean {
  const l = normalizePath(left)
  const r = normalizePath(right)
  return l !== '' && r !== '' && l === r
}

function pathsOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some(a => right.some((b) => {
    const l = normalizePath(a)
    const r = normalizePath(b)
    return l === r || l.startsWith(`${r}/`) || r.startsWith(`${l}/`)
  }))
}

/** 角色 preset 的前缀；改名前的 `lcoder*` 仍可能留在旧会话的 `agentPreset` 里。 */
const PRESET_PREFIXES = ['maniu', 'lcoder'] as const

/** 从 preset id 反推角色名：裸前缀是实施（`dev`），`<前缀>-<角色>` 取后缀。 */
function presetRoleOf(preset: string): string | undefined {
  for (const prefix of PRESET_PREFIXES) {
    if (preset === prefix) return 'dev'
    if (preset.startsWith(`${prefix}-`)) return preset.slice(prefix.length + 1)
  }
  return undefined
}

function roleAllows(taskRole: string | undefined, sessionPreset: string | undefined): boolean {
  if (taskRole === undefined || sessionPreset === undefined) return true
  const sessionRole = presetRoleOf(sessionPreset) ?? sessionPreset
  return taskRole === sessionRole || sessionRole === 'dev'
}

/**
 * 算一条任务的调度建议。
 * @param task - 任务行。
 * @param tasks - 当前全部任务，用于依赖完成判断与关联比较。
 * @param sessions - 会话列表。
 * @param projectPath - 当前项目路径。
 * @param ruleModules - 规则编号到模块名的映射。
 * @returns 判定、理由与候选。
 */
export function scheduleTask(
  task: TaskRow,
  tasks: readonly TaskRow[],
  sessions: readonly SessionSummary[],
  projectPath: string,
  ruleModules: Readonly<Record<string, string>>,
): ScheduleDecision {
  const known: Record<string, string> = {}
  for (const row of tasks) known[row.id] = row.state
  const blockedBy = task.dependsOn.filter(id => known[id] !== 'closed')
  if (blockedBy.length > 0) {
    return {
      verdict: 'wait',
      reasons: [`前置未完成：${blockedBy.join('、')}；先按住，等它们收口`],
      blockedBy,
      candidates: [],
    }
  }
  const modules = task.rules.flatMap(rule => (ruleModules[rule] === undefined ? [] : [ruleModules[rule]]))
  const candidates: ScheduleCandidate[] = sessions.map((session) => {
    const signals: string[] = []
    if (!sameWorkspace(session.cwd ?? '', projectPath)) {
      return { sessionId: session.sessionId, score: 0, signals, rejected: 'worktree 不同' }
    }
    signals.push('同一 worktree')
    const claims = tasks.filter(row => row.session === session.sessionId && row.id !== task.id)
    const owns = task.session === session.sessionId
    if (owns) {
      signals.push('本任务已认领')
      return { sessionId: session.sessionId, score: 10, signals }
    }
    if (!roleAllows(task.role, session.agentPreset)) {
      return { sessionId: session.sessionId, score: 0, signals, rejected: `岗位不匹配（任务 ${task.role ?? '不限'}，会话 ${session.agentPreset ?? '未知'}）` }
    }
    let score = 0
    if (task.proposal !== undefined && claims.some(claim => claim.proposal === task.proposal)) {
      score += 3
      signals.push(`同一方案 ${task.proposal}`)
    }
    const shared = modules.filter(module => claims.some(claim =>
      claim.rules.some(rule => ruleModules[rule] === module)))
    if (shared.length > 0) {
      score += 2
      signals.push(`同一规格模块 ${shared.join('、')}`)
    }
    if (pathsOverlap(task.paths, claims.flatMap(claim => claim.paths))) {
      score += 1
      signals.push('改动落点重叠')
    }
    if (score === 0) return { sessionId: session.sessionId, score, signals, rejected: '与本任务没有关联信号' }
    if (session.running) signals.push('它正在工作，只能排队')
    return { sessionId: session.sessionId, score, signals }
  })
  const viable = candidates.filter(candidate => candidate.rejected === undefined)
  if (viable.length === 0) {
    return { verdict: 'new', reasons: ['没有可复用的会话：新开一条'], blockedBy: [], candidates }
  }
  const best = Math.max(...viable.map(candidate => candidate.score))
  const top = viable.filter(candidate => candidate.score === best)
  const picked = top[0]
  if (picked === undefined) {
    return { verdict: 'new', reasons: ['没有可复用的会话：新开一条'], blockedBy: [], candidates }
  }
  const busy = picked.score === 10 ? false : (sessions.find(session => session.sessionId === picked.sessionId)?.running ?? false)
  return {
    verdict: busy ? 'enqueue' : 'reuse',
    chosen: picked.sessionId,
    reasons: [`${picked.score === 10 ? '切回本任务已认领的会话' : '选中'} ${picked.sessionId}（得分 ${String(picked.score)}）：${picked.signals.join('；')}`],
    blockedBy: [],
    candidates,
  }
}
