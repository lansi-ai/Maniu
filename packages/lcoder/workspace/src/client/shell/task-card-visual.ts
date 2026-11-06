/**
 * Task card visual state.
 *
 * 两种「需要你」才描边：`running` 用主色跑马灯，`awaitingInteraction` 用警示色跑马灯——
 * 等人回答或等审批比在跑更需要被看见，所以它也得有动效，但不能比在跑更抢眼，用低对比的
 * 警示色。其余状态保持普通卡片。映射放在一个函数里，外壳与它的测试按同一份判定走。
 */
import type { TaskCardStatus } from '../task-session.ts'
import css from './Shell.module.css'

/**
 * 这条卡片该用哪种描边。
 * @param status - 由宿主推流与会话快照折出来的卡片状态。
 * @returns 描边类名；不需要描边时 undefined。
 */
export function runningCardClass(status: TaskCardStatus): string | undefined {
  if (status === 'running') return css.taskCardRunning
  return status === 'awaitingInteraction' ? css.taskCardAwaiting : undefined
}
