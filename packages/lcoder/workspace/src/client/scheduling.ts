/**
 * 调度判定内核：把「这条任务该交给哪条会话」算成一份可解释的决策。
 *
 * 三层分工在这一个文件里体现得很清楚：
 *   1. 信号层是纯数据——任务的依赖与关联（方案、规格模块、允许路径）、会话的忙闲与认领历史；
 *   2. 判定层先走硬闸（依赖未完成、worktree 不同、会话在等审批、角色不匹配），
 *      再按信号打分排候选；候选只有一个时直接定，两个以上并列才把决定权交出去（`needsChoice`）；
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
  /** 这条任务所在的仓库目录；与会话工作区不同时不许复用或入队。 */
  readonly repoPath: string
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
  /** 这条会话所属的仓库目录；与任务不同时不能复用，也不能入队。 */
  readonly workspacePath: string
  /** 这条会话当前与历史认领过的任务，供关联性比较。 */
  readonly claims: readonly {
    readonly id: string
    readonly state: string
    readonly proposal?: string
    readonly modules: readonly string[]
    readonly paths: readonly string[]
    /** 这条已认领任务的前置；入队前要和本任务比一遍，串行关系不能并成同组。 */
    readonly dependsOn: readonly string[]
  }[]
  /**
   * 已并入这条会话联调组的任务；它们没写 `Task.session`，但同组验收时同样算数。
   * 判入队准入与「已经入组」时都要看这一层。
   */
  readonly groupTasks: readonly {
    readonly id: string
    readonly state: string
    readonly dependsOn: readonly string[]
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
  /**
   * 入队成立后的联调组成员（不含本任务）：这些任务要一起写、一起跑证据、一起验收。
   * 只描述选择，不写盘；落 `.spec/evidence/scheduling/` 由人机命令负责。
   */
  readonly joint?: { readonly members: readonly string[] }
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
 * 两个工作区路径是否指向同一处。
 *
 * Windows 盘符路径大小写不敏感，反斜杠与正斜杠混写也常见；任一侧为空表示
 * 读不到路径，按「不同」处理——宁可不复用，也不把任务排进别的 worktree。
 * @param left - 一侧的工作区路径。
 * @param right - 另一侧的工作区路径。
 * @returns 指向同一处为 true。
 */
export function sameWorkspace(left: string, right: string): boolean {
  const norm = (value: string): string => {
    const slashed = value.split('\\').join('/').replace(/\/+$/u, '')
    return /^[A-Za-z]:\//u.test(slashed) ? slashed.toLowerCase() : slashed
  }
  const l = norm(left)
  const r = norm(right)
  return l !== '' && r !== '' && l === r
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
    // 第一层硬闸之后、打分之前：会话在别的 worktree 时，认领历史再像也不是同一条工作线。
    if (!sameWorkspace(session.workspacePath, task.repoPath)) {
      return {
        sessionId: session.sessionId,
        score: 0,
        signals,
        rejected: `worktree 不同（${session.workspacePath === '' ? '未知' : session.workspacePath}）`,
      }
    }
    signals.push('同一 worktree')
    // 本任务已经认在这条会话上，或已经并进它的联调组：点开始时只需要切回去，
    // 不重新入队、也不再过下面两道闸。
    const ownsTask = session.claims.some(claim => claim.id === task.id)
    const inGroup = session.groupTasks.some(member => member.id === task.id)
    if (ownsTask) {
      signals.push('本任务已认领')
      // 本任务自己就在这条会话上，直接压过任何同方案候选；不再拿它自己给自己算关联。
      score += 10
    } else if (inGroup) {
      signals.push('已在本会话联调组')
      score += 9
    }
    const comparable = session.claims.filter(claim => claim.id !== task.id)
    // 第二层硬闸：角色不匹配不能复用（agentPreset 在首回合后锁定）。
    if (task.role !== undefined && session.role !== undefined && session.role !== task.role) {
      return { sessionId: session.sessionId, score: 0, signals, rejected: `角色不匹配（${session.role}）` }
    }
    if (session.awaitingInteraction && !ownsTask && !inGroup) {
      return { sessionId: session.sessionId, score: 0, signals, rejected: '正在等人回答，塞进去会把上下文搅在一起' }
    }
    // 入队是「两条任务可以一起写完、一起验收」的承诺；只想排个坑的不在这里。
    if (!ownsTask && !inGroup && (session.running || session.pending > 0)) {
      const closed = [...session.claims, ...session.groupTasks].find(member => member.state === 'closed')
      if (closed !== undefined) {
        return {
          sessionId: session.sessionId,
          score: 0,
          signals,
          rejected: `目标会话里 ${closed.id} 已收口，不再并新任务`,
        }
      }
      const serial = [...session.claims, ...session.groupTasks].find(member =>
        (member.state !== 'closed' && member.dependsOn.includes(task.id))
        || (member.state !== 'closed' && task.dependsOn.includes(member.id)))
      if (serial !== undefined) {
        return {
          sessionId: session.sessionId,
          score: 0,
          signals,
          rejected: `与 ${serial.id} 之间还有未完成依赖，不能并入同一组`,
        }
      }
    }
    const claimedProps = comparable.flatMap(claim => (claim.proposal === undefined ? [] : [claim.proposal]))
    if (task.proposal !== undefined && claimedProps.includes(task.proposal)) {
      score += 3
      signals.push(`同一方案 ${task.proposal}`)
    }
    const claimedModules = new Set(comparable.flatMap(claim => claim.modules))
    const sharedModules = task.modules.filter(module => claimedModules.has(module))
    if (sharedModules.length > 0) {
      score += 2
      signals.push(`同一规格模块 ${sharedModules.join('、')}`)
    }
    if (pathsOverlap(task.paths, comparable.flatMap(claim => claim.paths))) {
      score += 1
      signals.push('改动落点重叠')
    }
    if (score === 0) return { sessionId: session.sessionId, score, signals, rejected: '与本任务没有关联信号' }
    if (session.running) signals.push(ownsTask ? '它正在跑这条任务' : '它正在工作，只能排队')
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
  const ownsTask = session?.claims.some(claim => claim.id === task.id) ?? false
  const inGroup = session?.groupTasks.some(member => member.id === task.id) ?? false
  // 本任务已在这条会话里跑或已在它的联调组里：点开始时只切回去，不再塞重复的提示词。
  const busy = !ownsTask && !inGroup && (session?.running === true || (session?.pending ?? 0) > 0)
  const lead = ownsTask ? '切回本任务已认领的会话' : inGroup ? '切回本任务所在的联调组' : '选中'
  reasons.push(`${lead} ${picked.sessionId}（得分 ${String(picked.score)}）：${picked.signals.join('；')}`)
  const members = [...new Set([
    ...(session?.claims.map(claim => claim.id) ?? []),
    ...(session?.groupTasks.map(member => member.id) ?? []),
  ])].filter(id => id !== task.id)
  return {
    verdict: busy ? 'enqueue' : 'reuse',
    chosen: picked.sessionId,
    candidates,
    reasons,
    blockedBy: [],
    needsChoice: top.length > 1,
    ...(busy && members.length > 0 ? { joint: { members } } : {}),
  }
}
