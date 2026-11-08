/**
 * 调度判定内核：把「这条任务该交给哪条会话」算成一份可解释的决策。
 *
 * 三层分工在这一个文件里体现得很清楚：
 *   1. 信号层是纯数据——任务的依赖与关联（方案、规格模块、允许路径）、会话的忙闲与认领历史；
 *   2. 判定层先走硬闸（依赖未完成、worktree 不同、会话在等审批、岗位不匹配），
 *      再按信号打分排候选；候选只有一个时直接定，两个以上并列才把决定权交出去（`needsChoice`）；
 *   3. 输出必须带理由：每个候选都留下命中的信号与被否原因，调用方据此给人看「为什么选它」。
 *
 * 这一层不读写盘、不调远程、不订阅，所以每条规则都能被单测钉死；
 * `Shell.tsx` 只负责拿结果、执行（复用 / 入队 / 新建 / 按住）并渲染理由。
 */
import { isBuiltinRole } from '@lcoder/kernel/src/schema/roles.ts'
import type { BuiltinRoleId } from '@lcoder/kernel/src/schema/roles.ts'

/** 名册里的一条岗位；判闸与写理由只需要 id、显示名与继承的内置角色。 */
export interface SchedulingRole {
  readonly id: string
  readonly name?: string
  readonly inherits: string
}

/** 把一侧的岗位 id 归一成「岗位 id + 继承的内置角色」，或只有内置角色。 */
interface NormalizedRole {
  readonly job?: string
  readonly builtin: BuiltinRoleId
  /** 给人看的名字：名册显示名，或内置角色 id。 */
  readonly label: string
}

/** 默认预设（dev）的 id 不带角色后缀；其余 LCoder preset 形如 `lcoder-<角色>`。 */
const PRESET_PREFIX = 'lcoder'

/**
 * 从会话 preset id 反推内置角色：`lcoder` 是实施，`lcoder-<内置角色>` 直接取后缀。
 * 其它 preset（上游角色）反推不出 LCoder 角色，返回 undefined。
 * @param preset - 会话的 `agentPreset`。
 * @returns 内置角色或 undefined。
 */
export function builtinRoleOfPreset(preset: string | undefined): BuiltinRoleId | undefined {
  if (preset === undefined || preset === '') return undefined
  const name = preset === PRESET_PREFIX
    ? 'dev'
    : preset.startsWith(`${PRESET_PREFIX}-`) ? preset.slice(PRESET_PREFIX.length + 1) : undefined
  return name !== undefined && isBuiltinRole(name) ? name : undefined
}

/**
 * 一条会话的有效岗位。
 *
 * 优先级：已认领任务上的 role → 建会话时人选的岗位 → 会话 preset 反推的内置角色。
 * 认领任务给出多个不一致的岗位时整组忽略，不把会话归给其中任何一条，也不回填一条
 * 猜出来的岗位——一次错派不能污染后续判定。任一步都拿不到就返回 undefined，闸不生效。
 * @param input - 认领任务上的 role、建会话时选的岗位、会话 preset。
 * @returns 有效岗位 id（可能是名册岗位、内置角色或 preset），缺信息为 undefined。
 */
export function effectiveSessionRole(input: {
  readonly claimed: readonly (string | undefined)[]
  readonly chosen?: string | undefined
  readonly preset?: string | undefined
}): string | undefined {
  const claimed = [...new Set(input.claimed.filter((role): role is string => role !== undefined && role !== ''))]
  if (claimed.length === 1) return claimed[0]
  if (input.chosen !== undefined && input.chosen !== '') return input.chosen
  return input.preset === undefined || input.preset === '' ? undefined : input.preset
}

/**
 * 一侧的岗位 id 归一化。名册优先，其次内置角色，最后按 preset 规则反推；
 * 都不认识时返回 undefined——读侧把未知 id 当「缺信息」，闸不生效。
 * @param raw - 任务或会话上的角色 id。
 * @param roles - 项目岗位名册。
 * @returns 归一化后的角色。
 */
function normalizeRole(raw: string | undefined, roles: readonly SchedulingRole[]): NormalizedRole | undefined {
  if (raw === undefined || raw === '') return undefined
  const job = roles.find(role => role.id === raw)
  if (job !== undefined) {
    // 名册写坏的继承不当成合法岗位：两侧缺信息时闸不生效，而不是猜一个天花板。
    return isBuiltinRole(job.inherits)
      ? { job: job.id, builtin: job.inherits, label: job.name ?? job.id }
      : undefined
  }
  if (isBuiltinRole(raw)) return { builtin: raw, label: raw }
  const builtin = builtinRoleOfPreset(raw)
  return builtin === undefined ? undefined : { builtin, label: builtin }
}

/**
 * 严格岗位、实施兑底。
 *
 * 任务侧与会话侧都有可解析的岗位时才判：
 *   - 两侧都是名册岗位：必须同一个岗位；
 *   - 任务侧是名册岗位、会话侧是内置角色：只有会话恰为任务继承的实施（`dev`）才放行；
 *   - 任务侧是内置角色：按内置角色比较（名册岗位用它的继承角色参与）。
 * @param taskRole - 任务侧归一化结果。
 * @param sessionRole - 会话侧归一化结果。
 * @returns 允许复用为 true。
 */
function roleGatePasses(taskRole: NormalizedRole, sessionRole: NormalizedRole): boolean {
  if (taskRole.job !== undefined) {
    if (sessionRole.job !== undefined) return taskRole.job === sessionRole.job
    return sessionRole.builtin === taskRole.builtin && sessionRole.builtin === 'dev'
  }
  return taskRole.builtin === sessionRole.builtin
}

/**
 * 角色不匹配的人话。
 * @param taskRole - 任务侧归一化结果。
 * @param sessionRole - 会话侧归一化结果。
 * @returns 否决理由。
 */
function roleMismatchReason(taskRole: NormalizedRole, sessionRole: NormalizedRole): string {
  if (taskRole.job !== undefined) {
    const fallback = sessionRole.job === undefined ? '；只有实施（dev）可以兜底' : ''
    return `岗位不匹配（任务要求 ${taskRole.label}，会话是 ${sessionRole.label}${fallback}）`
  }
  return `角色不匹配（任务要求 ${taskRole.label}，会话是 ${sessionRole.label}）`
}

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
  /** 这条任务要求的岗位；缺省表示不限。 */
  readonly role?: string
}

/** 会话侧参与判定的信号。 */
export interface SchedulingSession {
  readonly sessionId: string
  /** 这条会话的有效岗位：认领任务上的 role、建会话时选的岗位，或 preset 反推的内置角色。 */
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
 * @param roles - 项目岗位名册；缺省为空表，此时名册岗位按未知 id 处理（闸不生效）。
 * @returns 判定、候选比较与理由。
 */
export function decideScheduling(
  task: SchedulingTask,
  sessions: readonly SchedulingSession[],
  knownStates: Readonly<Record<string, string>>,
  roles: readonly SchedulingRole[] = [],
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
    // 第二层硬闸：严格岗位、实施兜底。任一侧拿不到可解析的岗位就让闸失效，
    // 存量会话因此不会被误拦；两侧都有岗位时按归一化后的岗位对比较。
    const taskRole = normalizeRole(task.role, roles)
    const sessionRole = normalizeRole(session.role, roles)
    if (taskRole !== undefined && sessionRole !== undefined && !roleGatePasses(taskRole, sessionRole)) {
      return { sessionId: session.sessionId, score: 0, signals, rejected: roleMismatchReason(taskRole, sessionRole) }
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
