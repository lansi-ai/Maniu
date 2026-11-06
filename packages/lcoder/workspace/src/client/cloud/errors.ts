/**
 * 错误码到界面文案的映射。界面只按 `code` 分支，不解析服务端 `message`。
 */
import type { LcoderWorkspaceKey } from '../locales.ts'

/** 已知错误码对应的词典键；未知码走默认分支。 */
const KEY_BY_CODE: Readonly<Record<string, LcoderWorkspaceKey>> = {
  invalid_request: 'shell.cloudErrorInvalidRequest',
  validation_failed: 'shell.cloudErrorValidation',
  unauthorized: 'shell.cloudErrorUnauthorized',
  token_expired: 'shell.cloudErrorTokenExpired',
  invalid_credentials: 'shell.cloudErrorCredentials',
  forbidden: 'shell.cloudErrorForbidden',
  banned: 'shell.cloudErrorBanned',
  quota_exhausted: 'shell.cloudErrorQuota',
  rate_limited: 'shell.cloudErrorRateLimited',
  sms_rate_limited: 'shell.cloudErrorSmsRateLimited',
  guest_ip_limited: 'shell.cloudErrorGuestIpLimited',
  guest_quota_exhausted: 'shell.cloudErrorGuestQuota',
  conflict: 'shell.cloudErrorConflict',
  device_already_granted: 'shell.cloudErrorAlreadyGranted',
  idempotency_conflict: 'shell.cloudErrorIdempotency',
  not_found: 'shell.cloudErrorNotFound',
  payload_too_large: 'shell.cloudErrorTooLarge',
  model_not_allowed: 'shell.cloudErrorModelNotAllowed',
  unsupported_model: 'shell.cloudErrorUnsupportedModel',
  captcha_required: 'shell.cloudErrorCaptcha',
  upstream_unavailable: 'shell.cloudErrorUpstream',
  upstream_timeout: 'shell.cloudErrorUpstreamTimeout',
  internal_error: 'shell.cloudErrorInternal',
  offline: 'shell.cloudOffline',
  needs_login: 'shell.cloudErrorTokenExpired',
  guest_missing: 'shell.cloudErrorGuestMissing',
  guest_expired: 'shell.cloudErrorGuestExpired',
  cloud_unavailable: 'shell.cloudErrorUnavailable',
}

/** 下一步动作；界面据此决定给登录、重试还是自带 Key。 */
export type CloudErrorAction = 'login' | 'retry' | 'own-key' | 'countdown' | 'none'

/**
 * 把错误码翻成词典键。
 * @param code - 云端或客户端补的错误码。
 * @returns 可直接交给 `t` 的键。
 */
export function cloudErrorKey(code: string): LcoderWorkspaceKey {
  return KEY_BY_CODE[code] ?? 'shell.cloudErrorGeneric'
}

/**
 * 这个错误该给什么下一步。
 * @param code - 错误码。
 * @returns 动作类别。
 */
export function cloudErrorAction(code: string): CloudErrorAction {
  if (code === 'invalid_credentials' || code === 'needs_login' || code === 'token_expired'
    || code === 'unauthorized' || code === 'guest_quota_exhausted' || code === 'guest_expired'
    || code === 'guest_missing' || code === 'device_already_granted') return 'login'
  if (code === 'quota_exhausted' || code === 'model_not_allowed') return 'own-key'
  if (code === 'rate_limited' || code === 'sms_rate_limited' || code === 'guest_ip_limited') return 'countdown'
  if (code === 'upstream_unavailable' || code === 'upstream_timeout' || code === 'internal_error'
    || code === 'offline') return 'retry'
  return 'none'
}

/** 错误下一步的词典键；没有建议时返回 undefined。 */
export function cloudNextKey(code: string): LcoderWorkspaceKey | undefined {
  switch (cloudErrorAction(code)) {
    case 'login': return 'shell.cloudNextLogin'
    case 'retry': return 'shell.cloudNextRetry'
    case 'own-key': return 'shell.cloudNextOwnKey'
    case 'countdown': return 'shell.cloudNextCountdown'
    case 'none': return undefined
  }
}

/** 是否属于「重新登录就能继续」的错误。 */
export function needsLoginCode(code: string): boolean {
  return code === 'needs_login' || code === 'token_expired' || code === 'unauthorized'
}
