/**
 * 「立项分析」入口的动作判定。
 *
 * 那张按钮一直挂在空看板上——任务为零时它都在——所以第一次点、关掉浮层再点、刷新页面
 * 再点都还看得见。它不能每点一次就再发一遍咒语：判定因此读会话事实，不读浮层开没开，
 * 也不写 localStorage。会话受理过提示词（`blank` 已落、事件窗口里已有消息，或首条提示
 * 已被收下、正等首个回合）就只开浮层。
 */

/** 点一下「立项分析」之后要做的事。 */
export type OnboardingAction =
  | { readonly kind: 'send' }
  | { readonly kind: 'open' }
  | { readonly kind: 'block'; readonly reason: 'no-session' | 'no-model' }

/** 判定所需的会话事实；`undefined` 表示读不到，不冒充「没发过」。 */
export interface OnboardingFacts {
  /** 当前工作区有没有一条能发消息的会话。 */
  readonly hasSession: boolean
  /** 宿主有没有能跑的模型；没有时发出去也不会有回音。 */
  readonly hasModel: boolean
  /** 这条咒语正在发、还没等宿主受理；挡住连点的第二下。 */
  readonly sending: boolean
  /** 会话行上的 `blank`：`false` 表示受理过提示词；`undefined` 表示名册里读不到这一行。 */
  readonly blank: boolean | undefined
  /** 事件窗口里用户发出的消息条数；注入的上下文不算，窗口没物化时是 0，不能单独当「没发过」。 */
  readonly userMessages: number
  /** 首条提示已被收下、还没等到 `turn/start`；只有物化过的会话读得到。 */
  readonly awaitingFirstTurn: boolean | undefined
}

/**
 * 决定点这一下要做的事。
 * @param facts - 当前会话与宿主的事实。
 * @returns `send` 首次点击；`open` 已经发过或正在发；`block` 缺会话或缺模型。
 */
export function onboardingAction(facts: OnboardingFacts): OnboardingAction {
  if (!facts.hasSession) return { kind: 'block', reason: 'no-session' }
  if (!facts.hasModel) return { kind: 'block', reason: 'no-model' }
  const started = facts.blank === false || facts.userMessages > 0 || facts.awaitingFirstTurn === true
  return started || facts.sending ? { kind: 'open' } : { kind: 'send' }
}
