/**
 * 任务卡片上的对话状态：任务↔会话的归属判据，以及把已取回的信号折成一张卡片能画的状态。
 *
 * 归属判据是 `.spec/tasks/<ID>.yaml` 的 `session` 字段——规格库里的这个值是唯一权威，
 * 卡片只投影它，字段没写就是未绑定。写入方（建会话并认领）不在本包：外壳不碰规格库，
 * kernel 仍是唯一的写盘者。
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
  readonly running: boolean
  /** 还没有 `turn/start` 的会话。 */
  readonly blank: boolean
}

/** 卡片能画的状态。顺序即优先级，`taskCardStatus` 一次折出一个。 */
export type TaskCardStatus =
  | 'unstarted'
  | 'awaitingInteraction'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'awaitingFirstTurn'
  | 'failed'
  | 'idle'

/** 一条任务排进了哪条会话、排在第几位。 */
export interface TaskQueueMark {
  readonly sessionId: string
  /** 入队那一刻前面已有的条数加一。 */
  readonly position: number
}

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
  /** 还没收口的前置任务；非空即按住，不进入执行。 */
  readonly blockedBy?: readonly string[] | undefined
  /** 这条任务已写入的队列位置；只有外壳记得到，没有就是未入队。 */
  readonly queued?: TaskQueueMark | null | undefined
}

/**
 * 按规格库里的 `session` 字段认领这条任务的会话。
 *
 * 只认标识精确相等的那条：`T-1` 绑不到 `T-10` 的会话。
 * 字段没写、或写着的会话不在本工作区名册里时返回 null——卡片因此说「未开始」，
 * 而不是拿别的会话的状态冒充这条任务的状态。
 * @param boundSessionId - `.spec/tasks/<ID>.yaml` 的 `session` 字段值；未绑定为 undefined。
 * @param sessions - 本工作区里已知的会话行。
 * @returns 归属的会话行，没有则 null。
 */
export function claimTaskSession(
  boundSessionId: string | undefined,
  sessions: readonly TaskSessionRow[],
): TaskSessionRow | null {
  if (boundSessionId === undefined || boundSessionId === '') return null
  return sessions.find(row => row.sessionId === boundSessionId) ?? null
}

/**
 * 把信号折成卡片状态。
 *
 * 优先级按「用户下一步该做什么」排：等人回答压过一切；已排进队列的提示压过
 * 会话在跑，因为跑的是它前面的那条，卡片说的是本任务；等前置收口再压过
 * 等首个回合与失败。会话都没建时是未开始，建了还没起过回合也是未开始。
 * @param signals - 已取回的信号。
 * @returns 卡片要画的那一个状态。
 */
export function taskCardStatus(signals: TaskCardSignals): TaskCardStatus {
  const { session } = signals
  if (session !== null && signals.awaitingInteraction === true) return 'awaitingInteraction'
  // 入队不写认领，所以排在「没有会话」之前：卡片说的是它排进了哪条会话的队列。
  if (signals.queued !== null && signals.queued !== undefined) return 'queued'
  if (session === null) {
    return (signals.blockedBy?.length ?? 0) > 0 ? 'waiting' : 'unstarted'
  }
  if (signals.hostRunning ?? session.running) return 'running'
  if ((signals.blockedBy?.length ?? 0) > 0) return 'waiting'
  if (signals.awaitingFirstTurn === true) return 'awaitingFirstTurn'
  if (signals.failed === true) return 'failed'
  if (session.blank) return 'unstarted'
  return 'idle'
}
