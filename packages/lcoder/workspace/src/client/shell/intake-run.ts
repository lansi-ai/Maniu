/**
 * 思考态与结束态之间的沉降窗口。
 *
 * 一轮结束到下一轮开始之间 `running` 会短暂为 false；直接按它画「已结束」会让状态行闪一下。
 * {@link useIntakeRunActive} 在看见开跑之后停下来时保留约两秒思考态：窗口内出现新消息
 * 或 `running` 回升就重新计时，只有持续无运行、无待答问题超过窗口才交回结束态。
 * 计时器归本次 hook 所有；关闭向导、离开思考阶段或卸载时随 effect 清理。
 */
import { useEffect, useState } from 'react'

/** 结束态沉降窗口：盖得住回合之间的空档，也不会把真结束拖太久。 */
export const INTAKE_SETTLE_MS = 2000

/** 判断这一轮是否仍按思考中展示所需的事实。 */
export interface IntakeRunFacts {
  /** 宿主推流里这一轮是否在跑，含「首条提示已收下、还在等首个回合」。 */
  readonly running: boolean
  /** 当前待答问题数；有待答问题不算结束。 */
  readonly questionCount: number
  /** 活动序号：消息条数一类只随新事件增长的值，用来重置沉降窗口。 */
  readonly activity: number
}

/** 沉降窗口的可测状态。 */
export interface IntakeRunState {
  /** 窗口起点；null 表示当前没有在计窗口。 */
  readonly since: number | null
  /** 起点对应的活动序号。 */
  readonly activity: number
  /** 界面这一次该显示思考中（true）还是已结束（false）。 */
  readonly active: boolean
}

/**
 * 起始状态：按当前事实直接显示，不替挂载前就已停下的旧回合补窗口。
 * @param facts - 这一轮的运行、提问与活动事实。
 * @returns 初值；已经停下的回合直接是结束态。
 */
export function initialIntakeRunState(facts: IntakeRunFacts): IntakeRunState {
  return { since: null, activity: facts.activity, active: facts.running || facts.questionCount > 0 }
}

/**
 * 用一条新事实推进沉降窗口。
 *
 * 在跑或有待答问题时立即回到思考态并清掉窗口；停下来时，只有此前确实显示过思考态
 * 或活动序号又变了才开窗，其余情况保持已结束。
 * @param previous - 上一次状态。
 * @param facts - 新一轮事实。
 * @param now - 当前时刻（毫秒）。
 * @param settleMs - 沉降窗口长度；到点后交回结束态。
 * @returns 推进后的状态；没有任何变化时返回原对象。
 */
export function nextIntakeRunState(
  previous: IntakeRunState,
  facts: IntakeRunFacts,
  now: number,
  settleMs: number = INTAKE_SETTLE_MS,
): IntakeRunState {
  if (facts.running || facts.questionCount > 0) {
    if (previous.active && previous.since === null && previous.activity === facts.activity) return previous
    return { since: null, activity: facts.activity, active: true }
  }
  const sameActivity = previous.activity === facts.activity
  if (previous.since !== null && sameActivity) {
    const active = now - previous.since < settleMs
    return active === previous.active ? previous : { ...previous, active }
  }
  if (previous.active || !sameActivity) return { since: now, activity: facts.activity, active: true }
  return previous
}

/** {@link useIntakeRunActive} 的输入：事实之外再加一个阶段开关。 */
export interface IntakeRunInput extends IntakeRunFacts {
  /** 只有思考阶段为 true；其余阶段立即交回未运行并清掉计时。 */
  readonly enabled: boolean
}

/**
 * 把 `running` 事实转成界面上该不该显示「思考中」。
 *
 * 阶段切换、关闭向导或卸载时 effect 清理计时器，重新进入按新事实重算。
 * @param input - 这一轮的运行、提问、活动与阶段开关。
 * @param settleMs - 沉降窗口长度。
 * @returns 界面展示的「是否在跑」。
 */
export function useIntakeRunActive(input: IntakeRunInput, settleMs: number = INTAKE_SETTLE_MS): boolean {
  const [state, setState] = useState<IntakeRunState>(() => initialIntakeRunState(input))

  useEffect(() => {
    if (!input.enabled) {
      setState(current => current.since === null && !current.active && current.activity === input.activity
        ? current
        : { since: null, activity: input.activity, active: false })
      return
    }
    const now = Date.now()
    const next = nextIntakeRunState(state, input, now, settleMs)
    if (next !== state) setState(next)
    if (!next.active || next.since === null) return
    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.since === null) return current
        const active = Date.now() - current.since < settleMs
        return active === current.active ? current : { ...current, active }
      })
    }, Math.max(0, settleMs - (now - next.since)))
    return () => { window.clearTimeout(timer) }
  }, [input.enabled, input.running, input.questionCount, input.activity, settleMs, state])

  return state.active
}
