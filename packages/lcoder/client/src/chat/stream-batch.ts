/** 流式帧合并：宿主每个增量一帧，逐帧提交会让聊天区与环境层反复重绘。 */

/** 按时提交的帧合并器。 */
export interface FrameBatcher<T> {
  /** 排入一个动作；空闲后的第一帧立即提交，其余合并到下一次定时提交。 */
  push(action: T): void
  /** 立即提交已排队的动作；没有排队时是空操作。 */
  flush(): void
  /** 丢弃排队与定时器；重开会话或卸载时调用。 */
  dispose(): void
}

/** 默认合并间隔：80ms 约合每秒十几次提交，文字仍是连续增长的。 */
export const STREAM_BATCH_MS = 80

/**
 * 建一个按固定间隔提交的帧合并器。空闲后的第一帧立即提交，首字延迟不变；
 * 之后的增量合并到下一次定时提交。
 * @param apply - 一次拿到整批动作的提交函数。
 * @param intervalMs - 两次提交之间的最长间隔。
 * @returns 合并器。
 */
export function createFrameBatcher<T>(
  apply: (actions: readonly T[]) => void,
  intervalMs = STREAM_BATCH_MS,
): FrameBatcher<T> {
  let queue: T[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (queue.length === 0) return
    const actions = queue
    queue = []
    apply(actions)
  }

  return {
    push(action) {
      if (timer === null && queue.length === 0) apply([action])
      else queue.push(action)
      if (timer === null) timer = setTimeout(flush, intervalMs)
    },
    flush,
    dispose() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      queue = []
    },
  }
}
