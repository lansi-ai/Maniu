/**
 * LCoder 云端的数据面：跨 Host/Client 的公开形状。
 *
 * 这里只放能过 JSON round trip 的事实；访问令牌、刷新令牌、密码与验证码
 * 从不出现在任何返回值里。错误统一带 `code`，界面按码分支，不解析 `message`。
 */

/** 用户令牌对应的 provider 路由。 */
export const CLOUD_USER_ROUTE = 'lcoder-cloud'

/** 匿名令牌对应的 provider 路由。 */
export const CLOUD_GUEST_ROUTE = 'lcoder-cloud-guest'

/** 云端唯一白名单模型别名。 */
export const CLOUD_MODEL = 'deepseek-flash'

/** 云端凭据存储里的四条引用名。 */
export const CLOUD_ACCESS_REF = 'LCODER_CLOUD_ACCESS_TOKEN'
export const CLOUD_REFRESH_REF = 'LCODER_CLOUD_REFRESH_TOKEN'
export const CLOUD_GUEST_REF = 'LCODER_CLOUD_GUEST_TOKEN'

/** 云端与错误映射里的错误码；新增码走默认分支，不崩。 */
export interface CloudErrorInfo {
  /** 云端 `error.code`，或客户端侧补的 `offline` / `needs_login` / `guest_missing`。 */
  readonly code: string
  /** 面向人的一句话；不含令牌、手机号明文与上游原文。 */
  readonly message: string
  /** 服务端请求号；只用于诊断展示。 */
  readonly requestId?: string
  /** 429/402 的 Retry-After 秒数。 */
  readonly retryAfterSeconds?: number
  /** HTTP 状态码；网络失败时缺省。 */
  readonly status?: number
}

/** 一次云端调用的结果：业务失败也走 `ok: false`，不抛到界面。 */
export type CloudResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CloudErrorInfo }

/** 额度摘要（微美元）。 */
export interface CloudQuota {
  readonly grantedMicroUsd: number
  readonly reservedMicroUsd: number
  readonly spentMicroUsd: number
  readonly availableMicroUsd: number
  readonly currency: string
  readonly updatedAt?: string
}

/** 登录用户的展示资料；不含令牌。 */
export interface CloudUser {
  readonly id: string
  readonly displayName: string | null
  readonly phoneMasked: string | null
  readonly status: string
  readonly createdAt?: string
  readonly lastLoginAt?: string | null
}

/** 云端判定 token 预估不可用的原因；界面按这个分支。 */
export type CloudEstimateReason =
  | 'no_effective_price'
  | 'zero_unit_price'
  | 'zero_balance'
  | 'estimate_overflow'

/** 折算用的价格快照；单位是微美元/百万 token，只读展示。 */
export interface CloudTokenPrice {
  readonly inputMicroUsdPerMtok: number
  readonly cachedInputMicroUsdPerMtok: number
  readonly outputMicroUsdPerMtok: number
}

/**
 * 云端按余额折算的 token 预估；桌面只渲染，不做任何单价换算。
 *
 * `available` 为 false 时 `lowerBoundTokens` / `upperBoundTokens` 为 0，
 * 界面必须显示「不可用」，不能把 0 显示成预估结果。
 */
export interface CloudTokenEstimate {
  readonly available: boolean
  readonly unavailableReason: CloudEstimateReason | null
  readonly model: string
  readonly availableMicroUsd: number
  readonly lowerBoundTokens: number
  readonly upperBoundTokens: number
  /** 云端固定输入输出占比，例如 `8:2`。 */
  readonly inputOutputRatio: string
  readonly price: CloudTokenPrice | null
}

/** 一条用量流水。 */
export interface CloudUsageItem {
  readonly requestId: string
  readonly source: 'user' | 'guest'
  readonly model: string
  readonly promptTokens: number
  readonly cachedTokens: number
  readonly completionTokens: number
  readonly costMicroUsd: number
  readonly absorbedMicroUsd?: number
  readonly status: 'reserved' | 'settled' | 'released' | 'failed'
  readonly createdAt: string
}

/** 一页用量流水；`nextCursor` 为空表示到底了。 */
export interface CloudUsagePage {
  readonly items: readonly CloudUsageItem[]
  readonly nextCursor: string | null
}

/** `/v1/me/usage` 的查询参数。 */
export interface CloudUsageQuery {
  /** 1–100；默认 20。 */
  readonly limit?: number
  readonly cursor?: string
  readonly from?: string
  readonly to?: string
  readonly modelId?: string
}

/** 匿名授权的上限。 */
export interface CloudGuestLimits {
  readonly maxRequests: number
  readonly maxCostMicroUsd: number
  readonly dailyGrantLimit: number
}

/** 匿名授权的当前状态；服务端是唯一事实来源。 */
export interface CloudGuestView {
  readonly grantDate: string
  readonly expiresAt: string
  readonly remainingRequests: number
  readonly remainingCostMicroUsd: number
  readonly limits: CloudGuestLimits
  readonly model: string
  readonly scope: string
  readonly revoked: boolean
  /** 匿名授权的 token 预估；服务端没给时为 null。 */
  readonly estimate: CloudTokenEstimate | null
}

/** 顶栏与门禁需要的完整登录状态。 */
export interface CloudState {
  readonly signedIn: boolean
  readonly needsLogin: boolean
  readonly user: CloudUser | null
  readonly quota: CloudQuota | null
  /** 登录账号的 token 预估；未登录或服务端没给时为 null。 */
  readonly estimate: CloudTokenEstimate | null
  readonly guest: CloudGuestView | null
  /** 本地还留着匿名令牌，但服务端已判过期。 */
  readonly guestExpired: boolean
  /** 最近一次后台刷新失败的原因；成功时清空。 */
  readonly lastError: CloudErrorInfo | null
}

/** 登录/刷新成功后的公开结果。 */
export interface CloudAuthValue {
  readonly user: CloudUser
  readonly quota: CloudQuota
  readonly expiresIn: number
}

/** 发送验证码的结果。 */
export interface CloudSmsValue {
  readonly requestId: string
  readonly resendAfterSeconds: number
  readonly expiresInSeconds: number
}

/** 无返回值操作的成功形状。 */
export interface CloudOkValue {
  readonly ok: boolean
}

/** 发送验证码的入参。 */
export interface CloudSendSmsInput {
  readonly phone: string
  readonly purpose: 'register' | 'login'
  readonly captchaToken?: string
}

/** 注册入参；密码至少 10 位，由界面与服务端共同校验。 */
export interface CloudRegisterInput {
  readonly phone: string
  readonly code: string
  readonly password: string
  readonly displayName?: string
}

/** 验证码登录入参。 */
export interface CloudLoginSmsInput {
  readonly phone: string
  readonly code: string
}

/** 密码登录入参。 */
export interface CloudLoginPasswordInput {
  readonly phone: string
  readonly password: string
}

/** 领取匿名立项的入参；设备指纹由宿主生成，界面不感知。 */
export interface CloudGuestClaimInput {
  readonly clientVersion?: string
  readonly captchaToken?: string
}

/** 切换会话模型路由的入参。 */
export interface CloudRouteInput {
  readonly sessionId: string
  readonly mode: 'user' | 'guest'
}
