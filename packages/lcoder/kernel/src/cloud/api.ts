/**
 * 云端 HTTP 面：只负责把请求发出去、把错误码折成 {@link CloudApiError}。
 *
 * 令牌刷新、单飞、401 重试与凭据落盘都在 `tokens.ts` / `guest.ts`；这一层
 * 不缓存令牌、不重试业务请求，方便单测直接断言线上字段。
 */
import type {
  CloudGuestClaimInput, CloudGuestLimits, CloudGuestView, CloudLoginPasswordInput, CloudLoginSmsInput,
  CloudQuota, CloudRegisterInput, CloudSendSmsInput, CloudSmsValue, CloudUser,
} from './types.ts'

/** 云端错误体里的字段；未知形状按状态码兜底。 */
interface ErrorBody {
  readonly error?: {
    readonly code?: unknown
    readonly message?: unknown
    readonly requestId?: unknown
  }
}

/** 云端错误：带可直接展示的 code、requestId 与 Retry-After。 */
export class CloudApiError extends Error {
  /**
   * @param info - 错误码与诊断字段。
   */
  constructor(readonly info: import('./types.ts').CloudErrorInfo) {
    super(info.message)
    this.name = 'CloudApiError'
  }
}

/** 登录/刷新返回的完整会话；令牌只在本对象里出现，不跨 Remote。 */
export interface CloudAuthSession {
  readonly accessToken: string
  readonly tokenType: string
  readonly expiresIn: number
  readonly refreshToken: string
  readonly refreshExpiresAt: string
  readonly user: CloudUser & { readonly quota: CloudQuota }
}

/** `/v1/me` 的返回。 */
export interface CloudMeValue {
  readonly user: CloudUser
  readonly quota: CloudQuota
}

/** 匿名授权的签发结果；令牌只进凭据存储。 */
export interface CloudGuestSession {
  readonly guestToken: string
  readonly tokenType: string
  readonly expiresAt: string
  readonly grantDate: string
  readonly limits: CloudGuestLimits
  readonly model: string
  readonly scope: string
}

/** 一次请求的选项。 */
interface RequestOptions {
  readonly method?: 'GET' | 'POST'
  readonly body?: unknown
  readonly token?: string | undefined
  readonly timeoutMs?: number
  readonly idempotencyKey?: string
}

/** 按状态码兜底的错误码；服务端给了 `error.code` 时以它为准。 */
function fallbackCode(status: number): string {
  switch (status) {
    case 400: return 'invalid_request'
    case 401: return 'unauthorized'
    case 402: return 'quota_exhausted'
    case 403: return 'forbidden'
    case 404: return 'not_found'
    case 409: return 'conflict'
    case 413: return 'payload_too_large'
    case 422: return 'validation_failed'
    case 429: return 'rate_limited'
    case 500: return 'internal_error'
    case 502: return 'upstream_unavailable'
    case 504: return 'upstream_timeout'
    default: return status >= 500 ? 'internal_error' : 'invalid_request'
  }
}

/** 读字符串字段，空串按缺失。 */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 读有限数字字段。 */
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 解析 Retry-After（秒）；不是正数就不带。 */
function retryAfterOf(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')
  if (raw === null) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** 把一次失败响应折成 {@link CloudApiError}。 */
function failureOf(response: Response, body: unknown): CloudApiError {
  const parsed = (typeof body === 'object' && body !== null ? body : {}) as ErrorBody
  const code = textOf(parsed.error?.code) ?? fallbackCode(response.status)
  const message = textOf(parsed.error?.message) ?? `云端返回 ${String(response.status)}（${code}）`
  const requestId = textOf(parsed.error?.requestId)
  const retryAfterSeconds = retryAfterOf(response)
  return new CloudApiError({
    code,
    message,
    ...requestId === undefined ? {} : { requestId },
    ...retryAfterSeconds === undefined ? {} : { retryAfterSeconds },
    status: response.status,
  })
}

/** 登录、令牌与匿名授权需要的最小 HTTP 面；单测可直接给替身。 */
export interface CloudAuthApi {
  sendSms(input: CloudSendSmsInput): Promise<CloudSmsValue>
  register(input: CloudRegisterInput, deviceFingerprint: string): Promise<CloudAuthSession>
  loginSms(input: CloudLoginSmsInput, deviceFingerprint: string): Promise<CloudAuthSession>
  loginPassword(input: CloudLoginPasswordInput, deviceFingerprint: string): Promise<CloudAuthSession>
  refresh(refreshToken: string, timeoutMs: number): Promise<CloudAuthSession>
  logout(accessToken: string): Promise<void>
  me(accessToken: string): Promise<CloudMeValue>
  claimGuest(fingerprint: string, input: CloudGuestClaimInput): Promise<CloudGuestSession>
  guestStatus(guestToken: string): Promise<CloudGuestView>
}

/** 云端 HTTP 客户端。 */
export class CloudApi implements CloudAuthApi {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly defaultTimeoutMs: number
  private readonly clientVersion: string | undefined

  /**
   * @param options - 云端基地址、fetch 替身与超时。
   */
  constructor(readonly options: {
    readonly baseUrl: string
    readonly fetchImpl?: typeof fetch
    readonly timeoutMs?: number
    readonly clientVersion?: string
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.defaultTimeoutMs = options.timeoutMs ?? 10_000
    this.clientVersion = options.clientVersion
  }

  /** 云端基地址（不含末尾斜杠）。 */
  get base(): string {
    return this.baseUrl
  }

  /**
   * 发一次请求并解析 JSON。
   * @param path - `/v1` 之后的路径，例如 `/auth/sms/send`。
   * @param options - 方法、体、令牌与超时。
   * @returns 解析后的 JSON；204 返回 undefined。
   * @throws {CloudApiError} 网络失败、超时或非 2xx。
   */
  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
    if (this.clientVersion !== undefined) headers['x-lcoder-client-version'] = this.clientVersion
    if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        signal: controller.signal,
        ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
      })
    } catch (error: unknown) {
      const timeout = error instanceof Error && error.name === 'AbortError'
      throw new CloudApiError({
        code: 'offline',
        message: timeout ? '云端响应超时了，请稍后重试。' : '无法连接云端，请检查网络。',
      })
    } finally {
      clearTimeout(timer)
    }

    const raw = await response.text()
    let body: unknown = undefined
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw) as unknown
      } catch {
        // 非 JSON 响应按状态码兜底；页面不解析原文。
        body = undefined
      }
    }
    if (!response.ok) throw failureOf(response, body)
    return body as T
  }

  /**
   * 发送短信验证码。
   * @param input - 手机号与用途。
   * @returns 重发倒计时与有效期。
   */
  async sendSms(input: CloudSendSmsInput): Promise<CloudSmsValue> {
    return this.request<CloudSmsValue>('/auth/sms/send', {
      method: 'POST',
      body: {
        phone: input.phone,
        purpose: input.purpose,
        ...input.captchaToken === undefined ? {} : { captchaToken: input.captchaToken },
      },
    })
  }

  /**
   * 注册并登录。
   * @param input - 手机号、验证码、密码与展示名。
   * @param deviceFingerprint - 安装级指纹。
   * @returns 登录会话。
   */
  async register(input: CloudRegisterInput, deviceFingerprint: string): Promise<CloudAuthSession> {
    return this.request<CloudAuthSession>('/auth/register', {
      method: 'POST',
      body: {
        phone: input.phone,
        code: input.code,
        password: input.password,
        deviceFingerprint,
        ...input.displayName === undefined ? {} : { displayName: input.displayName },
      },
    })
  }

  /**
   * 验证码登录。
   * @param input - 手机号与验证码。
   * @param deviceFingerprint - 安装级指纹。
   * @returns 登录会话。
   */
  async loginSms(input: CloudLoginSmsInput, deviceFingerprint: string): Promise<CloudAuthSession> {
    return this.request<CloudAuthSession>('/auth/login/sms', {
      method: 'POST',
      body: { phone: input.phone, code: input.code, deviceFingerprint },
    })
  }

  /**
   * 密码登录。
   * @param input - 手机号与密码。
   * @param deviceFingerprint - 安装级指纹。
   * @returns 登录会话。
   */
  async loginPassword(input: CloudLoginPasswordInput, deviceFingerprint: string): Promise<CloudAuthSession> {
    return this.request<CloudAuthSession>('/auth/login/password', {
      method: 'POST',
      body: { phone: input.phone, password: input.password, deviceFingerprint },
    })
  }

  /**
   * 刷新访问令牌；每次成功都会轮换刷新令牌。
   * @param refreshToken - 当前刷新令牌。
   * @param timeoutMs - 阻塞上限；刷新最多阻塞模型请求 5 秒。
   * @returns 新会话。
   */
  async refresh(refreshToken: string, timeoutMs: number): Promise<CloudAuthSession> {
    return this.request<CloudAuthSession>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      timeoutMs,
    })
  }

  /**
   * 撤销刷新族。
   * @param accessToken - 当前访问令牌。
   */
  async logout(accessToken: string): Promise<void> {
    await this.request<undefined>('/auth/logout', { method: 'POST', token: accessToken })
  }

  /**
   * 读当前用户与额度。
   * @param accessToken - 访问令牌。
   * @returns 用户与额度。
   */
  async me(accessToken: string): Promise<CloudMeValue> {
    const response = await this.request<{ user?: CloudUser; quota?: CloudQuota }>('/me', { token: accessToken })
    if (response.user === undefined || response.quota === undefined) {
      throw new CloudApiError({ code: 'internal_error', message: '云端用户信息不完整。' })
    }
    return { user: response.user, quota: response.quota }
  }

  /**
   * 领取匿名立项授权。
   * @param fingerprint - 安装级指纹。
   * @param input - 可选客户端版本与人机验证令牌。
   * @returns 匿名授权与令牌。
   */
  async claimGuest(fingerprint: string, input: CloudGuestClaimInput): Promise<CloudGuestSession> {
    return this.request<CloudGuestSession>('/guest/sessions', {
      method: 'POST',
      body: {
        deviceFingerprint: fingerprint,
        ...input.clientVersion === undefined ? {} : { clientVersion: input.clientVersion },
        ...input.captchaToken === undefined ? {} : { captchaToken: input.captchaToken },
      },
    })
  }

  /**
   * 查询匿名授权剩余量。
   * @param guestToken - 匿名令牌。
   * @returns 服务端状态。
   */
  async guestStatus(guestToken: string): Promise<CloudGuestView> {
    const response = await this.request<Partial<CloudGuestView>>('/guest/session', { token: guestToken })
    const remainingRequests = numberOf(response.remainingRequests)
    const remainingCostMicroUsd = numberOf(response.remainingCostMicroUsd)
    if (response.grantDate === undefined || response.expiresAt === undefined
      || remainingRequests === undefined || remainingCostMicroUsd === undefined
      || response.limits === undefined || response.model === undefined || response.scope === undefined) {
      throw new CloudApiError({ code: 'internal_error', message: '匿名授权状态不完整。' })
    }
    return {
      grantDate: response.grantDate,
      expiresAt: response.expiresAt,
      remainingRequests,
      remainingCostMicroUsd,
      limits: response.limits,
      model: response.model,
      scope: response.scope,
      revoked: response.revoked === true,
    }
  }
}
