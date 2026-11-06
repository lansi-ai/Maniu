/**
 * 调度判定内核：把「这条任务该交给哪条会话」算成一份可解释的决策。
 *
 * 三层分工在这一个文件里体现得很清楚：
 *   1. 信号层是纯数据——任务的依赖与关联（方案、规格模块、允许路径）、会话的忙闲与认领历史；
 *   2. 判定层先走硬闸（依赖未完成、会话在等审批、角色不匹配），再按信号打分排候选；
 *      候选只有一个时直接定，两个以上并列才把决定权交出去（`needsChoice`）；
 *   3. 输出必须带理由：每个候选都留下命中的信号与被否原因，调用方据此给人看「为什么选它」。
 *
 * 这一层不读写盘、不调远程、不订阅，所以每条规则都能被单测钉死；
 * `Shell.tsx` 只负责拿结果、执行（复用 / 入队 / 新建 / 按住）并渲染理由。
 */

/** 任务侧参与判定的信号；由调用方从 `TaskRow` 与规格条目里拼出来。 */
export interface SchedulingTask {
  readonly id: string
  readonly state: string
  /** 前置任务编号。 */
  readonly dependsOn: readonly string[]
  /** 出自哪个方案（`P-01`）。 */
  readonly proposal?: string
  /** 本任务触及的规格模块（由 rules 的 module 反查）。 */
  readonly modules: readonly string[]
  /** 任务声明的允许路径；用作「落点重叠」的信号。 */
  readonly paths: readonly string[]
  /** 这条任务要求的角色；缺省表示不限。 */
  readonly role?: string
}

/** 会话侧参与判定的信号。 */
export interface SchedulingSession {
  readonly sessionId: string
  readonly role?: string
  readonly running: boolean
  /** 正在等人回答或等审批。 */
  readonly awaitingInteraction: boolean
  /** 该会话队列里已有的条数。 */
  readonly pending: number
  /** 这条会话当前与历史认领过的任务，供关联性比较。 */
  readonly claims: readonly {
    readonly id: string
    readonly state: string
    readonly proposal?: string
    readonly modules: readonly string[]
    readonly paths: readonly string[]
  }[]
}

/** 判定结果；`wait` 表示被依赖按住，`new` 表示没有可复用的会话。 */
export type SchedulingVerdict = 'reuse' | 'enqueue' | 'new' | 'wait'

/** 一个候选会话的得分与理由；被否的候选也留在列表里，方便人看「为什么不选它」。 */
export interface SchedulingCandidate {
  readonly sessionId: string
  readonly score: number
  /** 命中的信号，措辞直接给人看。 */
  readonly signals: readonly string[]
  /** 被否的原因；有值时这个候选不参与选择。 */
  readonly rejected?: string
}

/** 一次判定的完整结果，含候选比较与整体理由。 */
export interface SchedulingDecision {
  readonly verdict: SchedulingVerdict
  /** 选中的会话；`new` 与 `wait` 时缺省。 */
  readonly chosen?: string
  readonly candidates: readonly SchedulingCandidate[]
  /** 整体理由，按发生顺序；界面的「思考过程」直接逐条展示。 */
  readonly reasons: readonly string[]
  /** 依赖没完成时列出等的是哪几条。 */
  readonly blockedBy: readonly string[]
  /** 两个以上候选并列最高分：保留给上层决定是否让模型再取舍一次。 */
  readonly needsChoice: boolean
}

/** 依赖任务是否算完成：只有 closed 才算。 */
const isDone = (state: string): boolean => state === 'closed'

/**
 * 两条路径集有没有重叠；按前缀比较，`src/` 与 `src/a.ts` 视为重叠。
 * @param left - 一侧的路径集。
 * @param right - 另一侧的路径集。
 * @returns 有重叠为 true。
 */
function pathsOverlap(left: readonly string[], right: readonly string[]): boolean {
  const norm = (value: string): string => value.split('\\').join('/').replace(/\/+$/u, '')
  return left.some(a => right.some((b) => {
    const l = norm(a)
    const r = norm(b)
    return l === r || l.startsWith(`${r}/`) || r.startsWith(`${l}/`)
  }))
}

/**
 * 算一份调度决策。
 * @param task - 要安排的任务。
 * @param sessions - 本工作区的会话名册。
 * @param knownStates - 任务编号到状态的映射，用于判断依赖是否完成。
 * @returns 判定、候选比较与理由。
 */
export function decideScheduling(
  task: SchedulingTask,
  sessions: readonly SchedulingSession[],
  knownStates: Readonly<Record<string, string>>,
): SchedulingDecision {
  const reasons: string[] = []

  // 第一层硬闸：依赖未完成就按住，不进入会话比较——否则 DSH 的会话队列会在前置没做完时跑它。
  const blockedBy = task.dependsOn.filter(id => !isDone(knownStates[id] ?? 'unknown'))
  if (blockedBy.length > 0) {
    reasons.push(`前置未完成：${blockedBy.join('、')}；先按住，等它们收口`)
    return { verdict: 'wait', candidates: [], reasons, blockedBy, needsChoice: false }
  }
  if (task.dependsOn.length > 0) reasons.push(`前置已完成：${task.dependsOn.join('、')}`)

  const candidates: SchedulingCandidate[] = sessions.map((session) => {
    const signals: string[] = []
    let score = 0
    // 第二层硬闸：角色不匹配不能复用（agentPreset 在首回合后锁定）。
    if (task.role !== undefined && session.role !== undefined && session.role !== task.role) {
      return { sessionId: session.sessionId, score: 0, signals, rejected: `角色不匹配（${session.role}）` }
    }
    if (session.awaitingInteraction) {
      return { sessionId: session.sessionId, score: 0, signals, rejected: '正在等人回答，塞进去会把上下文搅在一起' }
    }
    const claimedProps = session.claims.flatMap(claim => (claim.proposal === undefined ? [] : [claim.proposal]))
    if (task.proposal !== undefined && claimedProps.includes(task.proposal)) {
      score += 3
      signals.push(`同一方案 ${task.proposal}`)
    }
    const claimedModules = new Set(session.claims.flatMap(claim => claim.modules))
    const sharedModules = task.modules.filter(module => claimedModules.has(module))
    if (sharedModules.length > 0) {
      score += 2
      signals.push(`同一规格模块 ${sharedModules.join('、')}`)
    }
    if (pathsOverlap(task.paths, session.claims.flatMap(claim => claim.paths))) {
      score += 1
      signals.push('改动落点重叠')
    }
    if (score === 0) return { sessionId: session.sessionId, score, signals, rejected: '与本任务没有关联信号' }
    if (session.running) signals.push('它正在工作，只能排队')
    else if (session.pending > 0) signals.push(`它队列里还有 ${String(session.pending)} 条`)
    return { sessionId: session.sessionId, score, signals }
  })

  const viable = candidates.filter(candidate => candidate.rejected === undefined)
  if (viable.length === 0) {
    reasons.push('没有可复用的会话：新开一条')
    return { verdict: 'new', candidates, reasons, blockedBy: [], needsChoice: false }
  }
  const best = Math.max(...viable.map(candidate => candidate.score))
  const top = viable.filter(candidate => candidate.score === best)
  const picked = top[0]
  if (picked === undefined) {
    reasons.push('没有可复用的会话：新开一条')
    return { verdict: 'new', candidates, reasons, blockedBy: [], needsChoice: false }
  }
  const session = sessions.find(entry => entry.sessionId === picked.sessionId)
  const busy = session?.running === true || (session?.pending ?? 0) > 0
  reasons.push(`选中 ${picked.sessionId}（得分 ${String(picked.score)}）：${picked.signals.join('；')}`)
  return {
    verdict: busy ? 'enqueue' : 'reuse',
    chosen: picked.sessionId,
    candidates,
    reasons,
    blockedBy: [],
    needsChoice: top.length > 1,
  }
}
