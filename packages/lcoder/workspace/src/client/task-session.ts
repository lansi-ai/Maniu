/**
 * 任务卡片上的对话状态：任务↔会话的归属判据，以及把已取回的信号折成一张卡片能画的状态。
 *
 * 归属判据是**会话标题等于任务号**。标题由 `session.rename` 写进会话日志，
 * 带 `source: {kind:'user'}`，上游语义把它钉死——自动标题不再覆盖（见
 * `packages/session/session-title`），所以这条链接是持久的，重新打开应用还在。
 * 选它而不选 Task schema：不碰产品数据、不新增写盘者，kernel 仍是 `.spec` 的唯一写者。
 *
 * 状态只由**已经取回的数据**折出来，这里不读盘、不调远程、不订阅：
 * 在跑与等人回答来自 `useSessionStatus` 全局 seat（宿主推流，覆盖每个列出的会话，
 * 不需要 bind 也不需要开历史）；等首个回合与失败来自会话快照，只有本客户端物化过的
 * 会话读得到，读不到就不假装知道。所以判定可以被单测钉死，也让 `Shell.tsx` 里只剩渲染。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 一条会话在这条判据里用到的字段；不引上游类型面，避免把整个会话 seam 拖进外壳。 */
export interface TaskSessionRow {
  readonly sessionId: SessionId
  /** 宿主持久化的会话标题；任务归属只认这一项，等于任务号才算这条任务。宿主还没投影出标题时为 undefined。 */
  readonly title?: string | undefined
  readonly running: boolean
  /** 还没有 `turn/start` 的会话；改名不改变它。 */
  readonly blank: boolean
  /** 宿主给出的最近活动时间（毫秒）；同一任务多条会话时取最新的一条。 */
  readonly updatedAt: number
}

/** 卡片能画的状态。顺序即优先级，`taskCardStatus` 一次折出一个。 */
export type TaskCardStatus =
  | 'unstarted'
  | 'awaitingInteraction'
  | 'running'
  | 'awaitingFirstTurn'
  | 'failed'
  | 'idle'

/** 折状态需要的信号；除 `session` 外都可能是「没取到」，缺省即不参与判定。 */
export interface TaskCardSignals {
  readonly session: TaskSessionRow | null
  /** 宿主推流的 running；缺省时退回会话行上的 running。 */
  readonly hostRunning?: boolean | undefined
  /** 这条会话正等人回答或等审批。 */
  readonly awaitingInteraction?: boolean | undefined
  /** 首条提示已被收下、还没等到 `turn/start`；只有物化过的会话读得到。 */
  readonly awaitingFirstTurn?: boolean | undefined
  /** 准入被拒或这一轮没跑起来；只有物化过的会话读得到。 */
  readonly failed?: boolean | undefined
}

/**
 * 找出属于某个任务的会话：标题恰好等于任务号的那些里最近活动的一条。
 *
 * 只认精确相等，不做前缀匹配——`T-1` 与 `T-10` 会互相误认，而人给会话起的
 * 「DEMO-03 修好了」这类标题本来就不该被当成外键。
 * @param taskId - 任务编号，如 `DEMO-03`。
 * @param sessions - 本工作区里已知的会话行。
 * @returns 归属的会话行，没有则 null。
 */
export function taskSessionOf(taskId: string, sessions: readonly TaskSessionRow[]): TaskSessionRow | null {
  let latest: TaskSessionRow | null = null
  for (const row of sessions) {
    if (row.title !== taskId) continue
    if (latest === null || row.updatedAt > latest.updatedAt) latest = row
  }
  return latest
}

/**
 * 把信号折成卡片状态。
 *
 * 优先级按「用户下一步该做什么」排：等人回答压过在跑（回合本来就停在审批上），
 * 在跑压过等首个回合，两者都没有才谈失败。会话都没建时是未开始，
 * 建了还没起过回合也是未开始。
 * @param signals - 已取回的信号。
 * @returns 卡片要画的那一个状态。
 */
export function taskCardStatus(signals: TaskCardSignals): TaskCardStatus {
  const { session } = signals
  if (session === null) return 'unstarted'
  if (signals.awaitingInteraction === true) return 'awaitingInteraction'
  if (signals.hostRunning ?? session.running) return 'running'
  if (signals.awaitingFirstTurn === true) return 'awaitingFirstTurn'
  if (signals.failed === true) return 'failed'
  if (session.blank) return 'unstarted'
  return 'idle'
}
