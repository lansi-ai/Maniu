/**
 * 登录门禁的纯判定：哪个入口在什么登录状态下放行。
 *
 * 桌面端去掉了匿名路径：未登录时外壳只渲染全屏登录页，工作台不渲染；
 * 这些入口判定仍保留给「已进入工作台之后云端临时不可用」的情况。
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
  | 'requirementApprove'
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
 * @returns 放行、要求登录或暂不处理；没有匿名放行分支。
 */
export function gateEntry(entry: CloudGateEntry, facts: CloudGateFacts): CloudGateDecision {
  if (facts.cloudUnavailable) return { kind: 'blocked', reason: 'cloud-unavailable' }
  if (facts.loading) return { kind: 'blocked', reason: 'loading' }
  if (facts.signedIn) return { kind: 'allow' }
  return { kind: 'login', reason: entry }
}
