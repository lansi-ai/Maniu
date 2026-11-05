/**
 * 任务卡片上的对话状态：把已经取回的信号折成一张卡片能画的状态。
 *
 * 归属不在这里判——外壳的 `liveSessionOf` 按 `.spec/tasks/<ID>.yaml` 的 `session` 字段
 * 反查还在册的会话，本模块只接一个 `claimed`。这样认领只有一套实现，卡片层是纯显示。
 *
 * 这里不读盘、不调远程、不订阅，只吃已取回的形状，所以判定可以被单测钉死，也让
 * `Shell.tsx` 里只剩渲染。在跑与等人回答来自 `useSessionStatus` 全局 seat（宿主推流，
 * 覆盖每个列出的会话，不需要 bind 也不需要开历史）；等首个回合与失败来自会话快照，
 * 只有本客户端物化过的会话读得到，读不到就不假装知道。
 */

/** 卡片能画的状态。优先级见 `taskCardStatus`。 */
export type TaskCardStatus =
  | 'unstarted'
  | 'awaitingInteraction'
  | 'running'
  | 'awaitingFirstTurn'
  | 'failed'
  | 'idle'

/** 折状态需要的信号；三个可选位「没取到」时不参与判定。 */
export interface TaskCardSignals {
  /** 这条任务被一条还在册的会话认领。 */
  readonly claimed: boolean
  /** 会话在跑；宿主推流优先，取不到时调用方传会话行的值。 */
  readonly running: boolean
  /** 会话还没有 `turn/start`。 */
  readonly blank: boolean
  /** 这条会话正等人回答或等审批。 */
  readonly awaitingInteraction?: boolean | undefined
  /** 首条提示已被收下、还没等到 `turn/start`；只有物化过的会话读得到。 */
  readonly awaitingFirstTurn?: boolean | undefined
  /** 准入被拒或这一轮没跑起来；只有物化过的会话读得到。 */
  readonly failed?: boolean | undefined
}

/**
 * 把信号折成卡片状态。
 *
 * 优先级按「用户下一步该做什么」排：等人回答压过在跑（回合本来就停在审批上），
 * 在跑压过等首个回合，两者都没有才谈失败。没被认领与认领了但还没起过回合都算未开始。
 * @param signals - 已取回的信号。
 * @returns 卡片要画的那一个状态。
 */
export function taskCardStatus(signals: TaskCardSignals): TaskCardStatus {
  if (!signals.claimed) return 'unstarted'
  if (signals.awaitingInteraction === true) return 'awaitingInteraction'
  if (signals.running) return 'running'
  if (signals.awaitingFirstTurn === true) return 'awaitingFirstTurn'
  if (signals.failed === true) return 'failed'
  if (signals.blank) return 'unstarted'
  return 'idle'
}
