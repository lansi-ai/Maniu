/**
 * 云端 HTTP 面：只负责把请求发出去、把错误码折成 {@link CloudApiError}。
 *
 * 令牌刷新、单飞、401 重试与凭据落盘都在 `tokens.ts` / `guest.ts`；这一层
 * 不缓存令牌、不重试业务请求，方便单测直接断言线上字段。
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  CloudCreateTalentInput, CloudEstimateReason, CloudGuestClaimInput, CloudGuestLimits, CloudGuestView,
  CloudLoginPasswordInput, CloudLoginSmsInput, CloudQuota, CloudRegisterInput, CloudSendSmsInput, CloudSmsValue,
  CloudTalent, CloudTalentConfig, CloudTalents, CloudTalentsQuery, CloudTokenEstimate, CloudTokenPrice,
  CloudUpdateTalentInput, CloudUsageItem, CloudUsagePage, CloudUsageQuery, CloudUser,
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
  readonly estimate: CloudTokenEstimate | null
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
  readonly estimate: CloudTokenEstimate | null
}

/** 一次请求的选项。 */
interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
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

/** 云端认可的四个不可用原因；未知值按缺省处理。 */
const ESTIMATE_REASONS: ReadonlySet<string> = new Set([
  'no_effective_price', 'zero_unit_price', 'zero_balance', 'estimate_overflow',
] satisfies CloudEstimateReason[])

/** 读价格快照；三项单位价缺一就返回 null。 */
function priceOf(value: unknown): CloudTokenPrice | null {
  if (typeof value !== 'object' || value === null) return null
  const price = value as Record<string, unknown>
  const input = numberOf(price.inputMicroUsdPerMtok)
  const cached = numberOf(price.cachedInputMicroUsdPerMtok)
  const output = numberOf(price.outputMicroUsdPerMtok)
  if (input === undefined || cached === undefined || output === undefined) return null
  return { inputMicroUsdPerMtok: input, cachedInputMicroUsdPerMtok: cached, outputMicroUsdPerMtok: output }
}

/**
 * 解析云端 token 预估；字段不全时返回 null，由界面显示「不可用」。
 *
 * 换算与原因判定都在云端，这里只做 JSON 取值，不做任何单价运算。
 * @param value - `/v1/me` 或匿名授权的 `tokenEstimate` 字段。
 * @returns 可直接展示的预估，或 null。
 */
export function parseTokenEstimate(value: unknown): CloudTokenEstimate | null {
  if (typeof value !== 'object' || value === null) return null
  const estimate = value as Record<string, unknown>
  if (typeof estimate.available !== 'boolean' || typeof estimate.model !== 'string'
    || typeof estimate.inputOutputRatio !== 'string') return null
  const availableMicroUsd = numberOf(estimate.availableMicroUsd)
  const lowerBoundTokens = numberOf(estimate.lowerBoundTokens)
  const upperBoundTokens = numberOf(estimate.upperBoundTokens)
  if (availableMicroUsd === undefined || lowerBoundTokens === undefined || upperBoundTokens === undefined) return null
  const reason = typeof estimate.unavailableReason === 'string' && ESTIMATE_REASONS.has(estimate.unavailableReason)
    ? estimate.unavailableReason as CloudEstimateReason
    : null
  return {
    available: estimate.available,
    unavailableReason: estimate.available ? null : reason,
    model: estimate.model,
    availableMicroUsd,
    lowerBoundTokens,
    upperBoundTokens,
    inputOutputRatio: estimate.inputOutputRatio,
    price: priceOf(estimate.price),
  }
}

/** 用量流水的状态集合；未知值视为响应不完整。 */
const USAGE_STATUSES: ReadonlySet<string> = new Set(['reserved', 'settled', 'released', 'failed'])

/** 读一条用量流水；字段不全时返回 undefined。 */
function usageItemOf(value: unknown): CloudUsageItem | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const item = value as Record<string, unknown>
  const promptTokens = numberOf(item.promptTokens)
  const cachedTokens = numberOf(item.cachedTokens)
  const completionTokens = numberOf(item.completionTokens)
  const costMicroUsd = numberOf(item.costMicroUsd)
  if (typeof item.requestId !== 'string' || typeof item.model !== 'string'
    || typeof item.createdAt !== 'string'
    || (item.source !== 'user' && item.source !== 'guest')
    || typeof item.status !== 'string' || !USAGE_STATUSES.has(item.status)
    || promptTokens === undefined || cachedTokens === undefined
    || completionTokens === undefined || costMicroUsd === undefined) return undefined
  const absorbedMicroUsd = numberOf(item.absorbedMicroUsd)
  return {
    requestId: item.requestId,
    source: item.source,
    model: item.model,
    promptTokens,
    cachedTokens,
    completionTokens,
    costMicroUsd,
    ...absorbedMicroUsd === undefined ? {} : { absorbedMicroUsd },
    status: item.status as CloudUsageItem['status'],
    createdAt: item.createdAt,
  }
}

/** 把 `/v1/me/usage` 的响应折成页面需要的形状。 */
function usagePageOf(value: unknown): CloudUsagePage {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { items?: unknown }).items)) {
    throw new CloudApiError({ code: 'internal_error', message: '云端用量流水不完整。' })
  }
  const page = value as { items?: unknown; nextCursor?: unknown }
  const items: CloudUsageItem[] = []
  for (const raw of page.items as unknown[]) {
    const item = usageItemOf(raw)
    if (item === undefined) throw new CloudApiError({ code: 'internal_error', message: '云端用量流水不完整。' })
    items.push(item)
  }
  return { items, nextCursor: textOf(page.nextCursor) ?? null }
}

/** 云端只认对象；数组与标量都是坏响应。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 递归校验一段静态 JSON 对象；非 JSON 值让整条响应无效。 */
function jsonObjectOf(value: unknown): Record<string, JsonValue> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    const json = jsonOf(item)
    if (json === undefined) return undefined
    result[key] = json
  }
  return result
}

/** 递归校验一个静态 JSON 值。 */
function jsonOf(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const items: JsonValue[] = []
    for (const item of value) {
      const json = jsonOf(item)
      if (json === undefined) return undefined
      items.push(json)
    }
    return items
  }
  return jsonObjectOf(value)
}

/** 读一条人才配置；字段不全或类型不对时整条响应无效。 */
function talentConfigOf(value: unknown): CloudTalentConfig | undefined {
  if (!isRecord(value) || typeof value.version !== 'number') return undefined
  const rawPlugins = value.plugins
  let plugins: { name: string; config?: Record<string, JsonValue> }[] | undefined
  if (rawPlugins !== undefined) {
    if (!Array.isArray(rawPlugins)) return undefined
    const parsed = rawPlugins.flatMap((entry): { name: string; config?: Record<string, JsonValue> }[] => {
      if (!isRecord(entry) || typeof entry.name !== 'string') return []
      if (entry.config === undefined) return [{ name: entry.name }]
      const config = jsonObjectOf(entry.config)
      return config === undefined ? [] : [{ name: entry.name, config }]
    })
    if (parsed.length !== rawPlugins.length) return undefined
    plugins = parsed
  }
  const tools = value.tools === undefined
    ? undefined
    : Array.isArray(value.tools) && value.tools.every(item => typeof item === 'string')
      ? value.tools.filter((item): item is string => typeof item === 'string')
      : undefined
  if (value.tools !== undefined && tools === undefined) return undefined
  const model = value.model === undefined
    ? undefined
    : isRecord(value.model) && typeof value.model.provider === 'string' && typeof value.model.modelId === 'string'
      ? { provider: value.model.provider, modelId: value.model.modelId }
      : undefined
  if (value.model !== undefined && model === undefined) return undefined
  const budget = value.budget === undefined
    ? undefined
    : isRecord(value.budget)
      ? {
        ...typeof value.budget.maxCostMicroUsd === 'number' ? { maxCostMicroUsd: value.budget.maxCostMicroUsd } : {},
        ...typeof value.budget.maxRequestsPerSession === 'number'
          ? { maxRequestsPerSession: value.budget.maxRequestsPerSession } : {},
      }
      : undefined
  if (value.budget !== undefined && budget === undefined) return undefined
  return {
    version: value.version,
    ...typeof value.basePreset === 'string' ? { basePreset: value.basePreset } : {},
    ...typeof value.persona === 'string' ? { persona: value.persona } : {},
    ...plugins === undefined ? {} : { plugins },
    ...tools === undefined ? {} : { tools },
    ...model === undefined ? {} : { model },
    ...budget === undefined ? {} : { budget },
  }
}

/** 读一条人才；任一必填字段缺失都按坏响应处理。 */
function talentOf(value: unknown): CloudTalent | undefined {
  if (!isRecord(value)) return undefined
  const { id, scope, projectId, ownerUserId, createdBy, name, description, revision, canManage, createdAt, updatedAt } = value
  const config = talentConfigOf(value.config)
  if (typeof id !== 'string' || (scope !== 'global' && scope !== 'project') || typeof ownerUserId !== 'string'
    || (createdBy !== 'user' && createdBy !== 'ai') || typeof name !== 'string' || typeof description !== 'string'
    || typeof revision !== 'number' || typeof canManage !== 'boolean'
    || typeof createdAt !== 'string' || typeof updatedAt !== 'string' || config === undefined
    || !(projectId === null || typeof projectId === 'string')) return undefined
  return {
    id, scope, projectId, ownerUserId, createdBy, name, description, config, revision, canManage, createdAt, updatedAt,
  }
}

/** 解析人才列表；不是列表就让界面看到一条可读的失败。 */
function talentsOf(value: unknown): CloudTalents {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new CloudApiError({ code: 'internal_error', message: '云端人才列表不完整。' })
  }
  const items: CloudTalent[] = []
  for (const raw of value.items) {
    const talent = talentOf(raw)
    if (talent === undefined) throw new CloudApiError({ code: 'internal_error', message: '云端人才条目不完整。' })
    items.push(talent)
  }
  return { items }
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
  usage(accessToken: string, query: CloudUsageQuery): Promise<CloudUsagePage>
  claimGuest(fingerprint: string, input: CloudGuestClaimInput): Promise<CloudGuestSession>
  guestStatus(guestToken: string): Promise<CloudGuestView>
}

/** 人才库的 HTTP 面；令牌由调用方按需刷新后传入。 */
export interface CloudTalentApi {
  talents(accessToken: string, query: CloudTalentsQuery): Promise<CloudTalents>
  createTalent(accessToken: string, input: CloudCreateTalentInput): Promise<CloudTalent>
  updateTalent(accessToken: string, input: CloudUpdateTalentInput): Promise<CloudTalent>
  deleteTalent(accessToken: string, talentId: string): Promise<void>
}

/** 云端 HTTP 客户端。 */
export class CloudApi implements CloudAuthApi, CloudTalentApi {
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
   * 读当前用户、额度与 token 预估。
   * @param accessToken - 访问令牌。
   * @returns 用户、额度与预估。
   */
  async me(accessToken: string): Promise<CloudMeValue> {
    const response = await this.request<{ user?: CloudUser; quota?: CloudQuota; tokenEstimate?: unknown }>(
      '/me',
      { token: accessToken },
    )
    if (response.user === undefined || response.quota === undefined) {
      throw new CloudApiError({ code: 'internal_error', message: '云端用户信息不完整。' })
    }
    return { user: response.user, quota: response.quota, estimate: parseTokenEstimate(response.tokenEstimate) }
  }

  /**
   * 读一页用量流水。
   * @param accessToken - 访问令牌。
   * @param query - 分页与筛选参数。
   * @returns 流水与下一页游标。
   */
  async usage(accessToken: string, query: CloudUsageQuery): Promise<CloudUsagePage> {
    const params = new URLSearchParams()
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    if (query.cursor !== undefined) params.set('cursor', query.cursor)
    if (query.from !== undefined) params.set('from', query.from)
    if (query.to !== undefined) params.set('to', query.to)
    if (query.modelId !== undefined) params.set('modelId', query.modelId)
    const encoded = params.toString()
    const suffix = encoded.length === 0 ? '' : `?${encoded}`
    return usagePageOf(await this.request<unknown>(`/me/usage${suffix}`, { token: accessToken }))
  }

  /**
   * 读人才列表；全局与项目按 scope 分两次取。
   * @param accessToken - 访问令牌。
   * @param query - scope 与可选的 projectId。
   * @returns 人才列表。
   */
  async talents(accessToken: string, query: CloudTalentsQuery = {}): Promise<CloudTalents> {
    const params = new URLSearchParams()
    if (query.scope !== undefined) params.set('scope', query.scope)
    if (query.projectId !== undefined) params.set('projectId', query.projectId)
    const encoded = params.toString()
    return talentsOf(await this.request<unknown>(`/talents${encoded === '' ? '' : `?${encoded}`}`, { token: accessToken }))
  }

  /**
   * 新建一条人才；项目人才由云端在首次绑定时认领项目。
   * @param accessToken - 访问令牌。
   * @param input - 作用域、名称与版本化配置。
   * @returns 云端落库后的人才。
   */
  async createTalent(accessToken: string, input: CloudCreateTalentInput): Promise<CloudTalent> {
    const body = await this.request<unknown>('/talents', {
      method: 'POST',
      token: accessToken,
      body: {
        scope: input.scope,
        ...input.projectId === undefined ? {} : { projectId: input.projectId },
        ...input.createdBy === undefined ? {} : { createdBy: input.createdBy },
        name: input.name,
        ...input.description === undefined ? {} : { description: input.description },
        config: input.config,
      },
    })
    const talent = talentOf(body)
    if (talent === undefined) throw new CloudApiError({ code: 'internal_error', message: '云端新建人才的结果不完整。' })
    return talent
  }

  /**
   * 更新一条人才；期望版本不一致时云端返回 409。
   * @param accessToken - 访问令牌。
   * @param input - 人才 id 与要改的字段。
   * @returns 更新后的人才。
   */
  async updateTalent(accessToken: string, input: CloudUpdateTalentInput): Promise<CloudTalent> {
    const body = await this.request<unknown>(`/talents/${encodeURIComponent(input.id)}`, {
      method: 'PATCH',
      token: accessToken,
      body: {
        ...input.name === undefined ? {} : { name: input.name },
        ...input.description === undefined ? {} : { description: input.description },
        ...input.config === undefined ? {} : { config: input.config },
        ...input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision },
      },
    })
    const talent = talentOf(body)
    if (talent === undefined) throw new CloudApiError({ code: 'internal_error', message: '云端更新人才的结果不完整。' })
    return talent
  }

  /**
   * 删除一条人才；权限与存在性由云端判定。
   * @param accessToken - 访问令牌。
   * @param talentId - 人才 id。
   */
  async deleteTalent(accessToken: string, talentId: string): Promise<void> {
    await this.request<undefined>(`/talents/${encodeURIComponent(talentId)}`, {
      method: 'DELETE',
      token: accessToken,
    })
  }

  /**
   * 领取匿名立项授权。
   * @param fingerprint - 安装级指纹。
   * @param input - 可选客户端版本与人机验证令牌。
   * @returns 匿名授权与令牌。
   */
  async claimGuest(fingerprint: string, input: CloudGuestClaimInput): Promise<CloudGuestSession> {
    const response = await this.request<{
      guestToken: string
      tokenType: string
      expiresAt: string
      grantDate: string
      limits: CloudGuestLimits
      model: string
      scope: string
      tokenEstimate?: unknown
    }>('/guest/sessions', {
      method: 'POST',
      body: {
        deviceFingerprint: fingerprint,
        ...input.clientVersion === undefined ? {} : { clientVersion: input.clientVersion },
        ...input.captchaToken === undefined ? {} : { captchaToken: input.captchaToken },
      },
    })
    return {
      guestToken: response.guestToken,
      tokenType: response.tokenType,
      expiresAt: response.expiresAt,
      grantDate: response.grantDate,
      limits: response.limits,
      model: response.model,
      scope: response.scope,
      estimate: parseTokenEstimate(response.tokenEstimate),
    }
  }

  /**
   * 查询匿名授权剩余量与预估。
   * @param guestToken - 匿名令牌。
   * @returns 服务端状态。
   */
  async guestStatus(guestToken: string): Promise<CloudGuestView> {
    const response = await this.request<Partial<CloudGuestView> & { tokenEstimate?: unknown }>(
      '/guest/session',
      { token: guestToken },
    )
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
      estimate: parseTokenEstimate(response.tokenEstimate),
    }
  }
}
