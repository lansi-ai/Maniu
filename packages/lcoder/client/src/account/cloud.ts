/** 云端账号面：只声明界面用到的字段，调用统一走窄 IPC。 */

import type { MessageKey } from '../locale.ts'

/** 云端业务失败；界面按 `code` 分支。 */
export interface CloudErrorInfo {
  readonly code: string
  readonly message: string
  readonly requestId?: string
  readonly retryAfterSeconds?: number
  readonly status?: number
}

/** 一次云端调用的结果。 */
export type CloudResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CloudErrorInfo }

/** 登录用户的展示资料。 */
export interface CloudUser {
  readonly id: string
  readonly displayName: string | null
  readonly phoneMasked: string | null
  readonly status: string
  readonly createdAt?: string
  readonly lastLoginAt?: string | null
}

/** 额度摘要（微美元）。 */
export interface CloudQuota {
  readonly grantedMicroUsd: number
  readonly reservedMicroUsd: number
  readonly spentMicroUsd: number
  readonly availableMicroUsd: number
  readonly currency: string
  readonly updatedAt?: string
}

/** token 预估的不可用原因。 */
export type CloudEstimateReason =
  | 'no_effective_price'
  | 'zero_unit_price'
  | 'zero_balance'
  | 'estimate_overflow'

/** 云端折好的 token 预估。 */
export interface CloudTokenEstimate {
  readonly available: boolean
  readonly unavailableReason: CloudEstimateReason | null
  readonly model: string
  readonly availableMicroUsd: number
  readonly lowerBoundTokens: number
  readonly upperBoundTokens: number
  readonly inputOutputRatio: string
  readonly price: {
    readonly inputMicroUsdPerMtok: number
    readonly cachedInputMicroUsdPerMtok: number
    readonly outputMicroUsdPerMtok: number
  } | null
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

/** 一页用量流水。 */
export interface CloudUsagePage {
  readonly items: readonly CloudUsageItem[]
  readonly nextCursor: string | null
}

/** 登录门禁与顶栏需要的状态。 */
export interface CloudState {
  readonly signedIn: boolean
  readonly needsLogin: boolean
  readonly user: CloudUser | null
  readonly quota: CloudQuota | null
  readonly estimate: CloudTokenEstimate | null
  readonly lastError: CloudErrorInfo | null
}

/** 登录/注册入参。 */
export interface SmsInput {
  readonly phone: string
  readonly purpose: 'register' | 'login'
}

/** 验证码登录入参。 */
export interface LoginSmsInput {
  readonly phone: string
  readonly code: string
}

/** 密码登录入参。 */
export interface LoginPasswordInput {
  readonly phone: string
  readonly password: string
}

/** 注册入参。 */
export interface RegisterInput {
  readonly phone: string
  readonly code: string
  readonly password: string
}

/** 发送验证码后的有效期。 */
export interface SmsValue {
  readonly resendAfterSeconds: number
  readonly expiresInSeconds: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 把宿主的错误字段收成界面文案需要的形状。
 * @param value - `RemoteResult.error` 或 `CloudResult.error`。
 * @returns 结构化失败。
 */
export function errorOf(value: unknown): CloudErrorInfo {
  if (!isRecord(value)) return { code: 'cloud_unavailable', message: '云端调用失败' }
  return {
    code: typeof value.code === 'string' ? value.code : 'cloud_unavailable',
    message: typeof value.message === 'string' ? value.message : '云端调用失败',
    ...text(value.requestId) === undefined ? {} : { requestId: value.requestId as string },
    ...numberOrUndefined(value.retryAfterSeconds) === undefined ? {} : { retryAfterSeconds: value.retryAfterSeconds as number },
    ...numberOrUndefined(value.status) === undefined ? {} : { status: value.status as number },
  }
}

function quotaOf(value: unknown): CloudQuota | null {
  if (!isRecord(value)) return null
  const granted = numberOrUndefined(value.grantedMicroUsd)
  if (granted === undefined) return null
  return {
    grantedMicroUsd: granted,
    reservedMicroUsd: numberOrUndefined(value.reservedMicroUsd) ?? 0,
    spentMicroUsd: numberOrUndefined(value.spentMicroUsd) ?? 0,
    availableMicroUsd: numberOrUndefined(value.availableMicroUsd) ?? 0,
    currency: typeof value.currency === 'string' ? value.currency : 'USD',
    ...text(value.updatedAt) === undefined ? {} : { updatedAt: value.updatedAt as string },
  }
}

function userOf(value: unknown): CloudUser | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  return {
    id: value.id,
    displayName: typeof value.displayName === 'string' ? value.displayName : null,
    phoneMasked: typeof value.phoneMasked === 'string' ? value.phoneMasked : null,
    status: typeof value.status === 'string' ? value.status : 'unknown',
    ...text(value.createdAt) === undefined ? {} : { createdAt: value.createdAt as string },
    ...value.lastLoginAt === null || typeof value.lastLoginAt === 'string'
      ? { lastLoginAt: value.lastLoginAt }
      : {},
  }
}

function estimateOf(value: unknown): CloudTokenEstimate | null {
  if (!isRecord(value) || typeof value.available !== 'boolean') return null
  const price = isRecord(value.price)
    ? {
      inputMicroUsdPerMtok: numberOrUndefined(value.price.inputMicroUsdPerMtok) ?? 0,
      cachedInputMicroUsdPerMtok: numberOrUndefined(value.price.cachedInputMicroUsdPerMtok) ?? 0,
      outputMicroUsdPerMtok: numberOrUndefined(value.price.outputMicroUsdPerMtok) ?? 0,
    }
    : null
  const reason = value.unavailableReason
  return {
    available: value.available,
    unavailableReason: reason === 'no_effective_price' || reason === 'zero_unit_price'
      || reason === 'zero_balance' || reason === 'estimate_overflow' ? reason : null,
    model: typeof value.model === 'string' ? value.model : '',
    availableMicroUsd: numberOrUndefined(value.availableMicroUsd) ?? 0,
    lowerBoundTokens: numberOrUndefined(value.lowerBoundTokens) ?? 0,
    upperBoundTokens: numberOrUndefined(value.upperBoundTokens) ?? 0,
    inputOutputRatio: typeof value.inputOutputRatio === 'string' ? value.inputOutputRatio : '',
    price,
  }
}

/**
 * 解析宿主返回的登录状态。
 * @param value - `CloudState` 的线上字段。
 * @returns 界面可用的状态；关键字段缺失时为 undefined。
 */
export function stateOf(value: unknown): CloudState | undefined {
  if (!isRecord(value) || typeof value.signedIn !== 'boolean') return undefined
  return {
    signedIn: value.signedIn,
    needsLogin: value.needsLogin === true,
    user: userOf(value.user),
    quota: quotaOf(value.quota),
    estimate: estimateOf(value.estimate),
    lastError: value.lastError === null || value.lastError === undefined ? null : errorOf(value.lastError),
  }
}

/** 用量流水页解析。 */
export function usagePageOf(value: unknown): CloudUsagePage | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined
  const items = value.items.flatMap((entry): CloudUsageItem[] => {
    if (!isRecord(entry) || typeof entry.requestId !== 'string') return []
    const status = entry.status
    return [{
      requestId: entry.requestId,
      source: entry.source === 'guest' ? 'guest' : 'user',
      model: typeof entry.model === 'string' ? entry.model : '',
      promptTokens: numberOrUndefined(entry.promptTokens) ?? 0,
      cachedTokens: numberOrUndefined(entry.cachedTokens) ?? 0,
      completionTokens: numberOrUndefined(entry.completionTokens) ?? 0,
      costMicroUsd: numberOrUndefined(entry.costMicroUsd) ?? 0,
      ...numberOrUndefined(entry.absorbedMicroUsd) === undefined ? {} : { absorbedMicroUsd: entry.absorbedMicroUsd as number },
      status: status === 'reserved' || status === 'settled' || status === 'released' || status === 'failed'
        ? status : 'settled',
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
    }]
  })
  return { items, nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null }
}

/**
 * 调一次云端方法并拆开两层信封（RemoteResult 与 CloudResult）。
 * @param method - `lcoderCloud` 下的方法名。
 * @param args - 线上命名参数。
 * @returns 云端结果；传输失败也收成同一个结果类型。
 */
async function call<T>(method: string, args: object): Promise<CloudResult<T>> {
  let answer
  try {
    answer = await window.lcoder.call('lcoderCloud', method, args)
  } catch (error: unknown) {
    return { ok: false, error: { code: 'cloud_unavailable', message: error instanceof Error ? error.message : String(error) } }
  }
  if (!answer.ok) return { ok: false, error: errorOf(answer.error) }
  const value = answer.value
  if (!isRecord(value)) return { ok: false, error: { code: 'cloud_invalid_response', message: '云端返回了无法识别的结果' } }
  if (value.ok === false) return { ok: false, error: errorOf(value.error) }
  return { ok: true, value: value.value as T }
}

/** 界面使用的云端面。 */
export const cloudFace = {
  /**
   * 读登录状态。
   * @returns 状态或业务失败。
   */
  state: (): Promise<CloudResult<CloudState>> => call<CloudState>('state', {}),
  /**
   * 发验证码。
   * @param input - 手机号与用途。
   * @returns 重发间隔与有效期。
   */
  sendSms: (input: SmsInput): Promise<CloudResult<SmsValue>> => call<SmsValue>('sendSms', { input }),
  /**
   * 验证码登录。
   * @param input - 手机号与验证码。
   * @returns 登录成功后的账号结果。
   */
  loginSms: (input: LoginSmsInput): Promise<CloudResult<unknown>> => call('loginSms', { input }),
  /**
   * 密码登录。
   * @param input - 手机号与密码。
   * @returns 登录成功后的账号结果。
   */
  loginPassword: (input: LoginPasswordInput): Promise<CloudResult<unknown>> => call('loginPassword', { input }),
  /**
   * 注册并登录。
   * @param input - 手机号、验证码与密码。
   * @returns 登录成功后的账号结果。
   */
  register: (input: RegisterInput): Promise<CloudResult<unknown>> => call('register', { input }),
  /**
   * 刷新令牌与额度。
   * @returns 刷新后的账号结果。
   */
  refresh: (): Promise<CloudResult<unknown>> => call('refresh', {}),
  /**
   * 退出登录。
   * @returns 回执。
   */
  logout: (): Promise<CloudResult<unknown>> => call('logout', {}),
  /**
   * 读一页用量流水。
   * @param query - 分页参数。
   * @returns 流水页。
   */
  usage: (query: { limit?: number; cursor?: string }): Promise<CloudResult<CloudUsagePage>> =>
    call<CloudUsagePage>('usage', { query }),
}

/**
 * 错误码对应的登录文案键。
 * @param code - 云端错误码。
 * @returns 可直接交给 `t` 的键。
 */
export function cloudErrorKey(code: string): MessageKey {
  switch (code) {
    case 'cloud_unavailable':
    case 'offline':
      return 'login.errorNetwork'
    case 'invalid_credentials':
      return 'login.errorCredentials'
    case 'invalid_code':
    case 'validation_failed':
    case 'invalid_request':
      return 'login.errorCode'
    case 'rate_limited':
    case 'guest_ip_limited':
      return 'login.errorRate'
    case 'sms_rate_limited':
      return 'login.errorSmsRate'
    case 'quota_exhausted':
    case 'model_not_allowed':
      return 'login.errorQuota'
    case 'banned':
      return 'login.errorBanned'
    case 'conflict':
    case 'idempotency_conflict':
      return 'login.errorConflict'
    case 'upstream_unavailable':
    case 'upstream_timeout':
    case 'internal_error':
      return 'login.errorUpstream'
    default:
      return 'login.errorGeneric'
  }
}
