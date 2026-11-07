/**
 * 匿名门禁的纯判定：哪个入口在什么登录状态下放行。
 *
 * 判定只看持久事实（登录状态、当前会话是否匿名立项会话），不看弹窗开没开；
 * 重复点击因此只会聚焦登录，不会多发一次领取或云端请求。
 */

/** 需要门禁的入口。 */
export type CloudGateEntry =
  | 'onboarding'
  | 'onboardingFollowup'
  | 'newSession'
  | 'agentSession'
  | 'taskConversation'
  | 'contractSign'
  | 'proposalApprove'
  | 'flowBatch'
  | 'modelSettings'

/** 判定输入。 */
export interface CloudGateFacts {
  /** 是否有用户令牌。 */
  readonly signedIn: boolean
  /** 登录状态仍在读取。 */
  readonly loading: boolean
  /** 云端通道不可用（未装配或 mounts 失败）。 */
  readonly cloudUnavailable: boolean
  /** 当前会话是否由匿名立项令牌驱动。 */
  readonly onboardingSession: boolean
}

/** 判定结果。 */
export type CloudGateDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'login'; readonly reason: CloudGateEntry }
  | { readonly kind: 'blocked'; readonly reason: 'loading' | 'cloud-unavailable' }

/**
 * 判定一个入口。
 * @param entry - 入口标识。
 * @param facts - 登录与云端事实。
 * @returns 放行、弹登录或暂不处理。
 */
export function gateEntry(entry: CloudGateEntry, facts: CloudGateFacts): CloudGateDecision {
  if (facts.cloudUnavailable) return { kind: 'blocked', reason: 'cloud-unavailable' }
  if (entry === 'onboarding') return facts.loading ? { kind: 'blocked', reason: 'loading' } : { kind: 'allow' }
  if (entry === 'onboardingFollowup') {
    if (facts.signedIn) return { kind: 'allow' }
    if (facts.onboardingSession) return { kind: 'allow' }
  }
  if (facts.loading) return { kind: 'blocked', reason: 'loading' }
  if (facts.signedIn) return { kind: 'allow' }
  return { kind: 'login', reason: entry }
}
