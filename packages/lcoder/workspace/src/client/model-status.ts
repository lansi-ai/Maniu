/**
 * 模型可用性的纯判定：把宿主给的模型目录与会话快照里的失败，折成外壳能画的三态。
 *
 * 为什么要这个模块：缺凭据时提示**不是**被拒——宿主把消息收进入队就返回接受，
 * 真失败发生在 agent 侧，落在会话快照的 `lastAgentError` 上，而事件流里一条
 * `user/message` 都没有。外壳只看事件流就会显示成「发了，什么都没发生」。
 *
 * 这里不读盘、不调远程、不看时间，只吃已取回的形状，所以判定可以被单测钉死，
 * 也让 `Shell.tsx` 里只剩渲染。
 */

/** 宿主模型目录里本判定用到的部分；不引上游类型面，避免把整个 seam 拖进外壳。 */
export interface ModelCatalogLike {
  readonly routableProviders: readonly string[]
  readonly groups: readonly { readonly id: string; readonly models: readonly unknown[] }[]
  readonly failures?: readonly { readonly id: string; readonly name: string; readonly message: string }[]
  readonly default?: { readonly provider: string; readonly model: string } | null
}

/**
 * 模型可用性。
 *
 * `empty` 才是「没有钥匙」，可以据此拦住发送；`unknown` 是查询本身失败了，
 * 把它的 code 说出来，但不把查询失败说成没有凭据，也不禁用发送——那会让
 * 用户在明明能用的装配上被我们挡住。
 */
export type ModelStatus =
  | { readonly state: 'ready' }
  | { readonly state: 'empty'; readonly detail: string }
  | { readonly state: 'unknown'; readonly detail: string }

/** 目录里是否还有能跑的模型：任一 provider 可路由，或任一组有模型。 */
export function catalogHasModel(catalog: ModelCatalogLike): boolean {
  return catalog.routableProviders.length > 0 || catalog.groups.some(group => group.models.length > 0)
}

/** provider 侧的失败说明，用于告诉用户是哪一个路由坏了。 */
function failureDetail(catalog: ModelCatalogLike): string {
  return (catalog.failures ?? [])
    .map(failure => `${failure.name || failure.id}: ${failure.message}`)
    .join('；')
}

/**
 * 把一次成功的目录查询折成可用性。
 * @param catalog - 宿主返回的模型目录。
 * @returns 三态之一。
 */
export function statusFromCatalog(catalog: ModelCatalogLike): ModelStatus {
  if (catalogHasModel(catalog)) return { state: 'ready' }
  const detail = failureDetail(catalog)
  return { state: 'empty', detail }
}

/**
 * 目录查询本身失败时的状态。
 * @param code - `RemoteFailure` 的判别码。
 * @param message - 宿主给出的一句话。
 * @returns `unknown` 状态，附带可直接显示的细节。
 */
export function statusOfFailure(code: string, message: string): ModelStatus {
  return { state: 'unknown', detail: `${code}: ${message}` }
}

/** 浮层里一条就地显示的失败说明。`key` 定文案，`detail` 是宿主给的具体原因。 */
export interface ShellSessionNotice {
  readonly key: 'shell.sendRefused' | 'shell.turnFailed'
  readonly detail: string
  /** 云端/网关错误码；有它时界面按码给文案与下一步，不再显示原文。 */
  readonly code?: string
  /** 服务端请求号；随失败一起显示。 */
  readonly requestId?: string
}

/** 云端错误体在宿主失败串里的形状；只抽 code 与 requestId。 */
const JSON_CODE = /"code"\s*:\s*"([a-z_]+)"/
const JSON_REQUEST_ID = /"requestId"\s*:\s*"([^"]+)"/
const HTTP_STATUS = /\b(401|402|403|429|500|502|504)\b/
/** 网络失败在宿主失败串里的常见措辞；没有 HTTP 状态时按离线处理。 */
const OFFLINE_TEXT = new RegExp([
  '\\bECONNREFUSED\\b', '\\bENOTFOUND\\b', '\\bEAI_AGAIN\\b',
  'fetch failed', 'connection (?:error|failed|refused)', 'network', 'socket', 'terminated', 'timed? out',
].join('|'), 'i')

/** 状态码到错误码的兜底映射；JSON code 优先。 */
const CODE_BY_STATUS: Readonly<Record<string, string>> = {
  401: 'unauthorized',
  402: 'quota_exhausted',
  403: 'banned',
  429: 'rate_limited',
  500: 'internal_error',
  502: 'upstream_unavailable',
  504: 'upstream_timeout',
}

/**
 * 从宿主失败串里抽云端错误码与 requestId。
 *
 * 只在宿主已把请求标成失败时读这段诊断；界面仍按 code 分支，不显示原文。
 * @param text - `lastAgentError` 或准入失败说明。
 * @returns 可识别的 code 与 requestId。
 */
export function cloudCodeFromError(text: string): { code?: string; requestId?: string } {
  const status = HTTP_STATUS.exec(text)?.[1]
  const code = JSON_CODE.exec(text)?.[1]
    ?? (status === undefined ? undefined : CODE_BY_STATUS[status])
    ?? (OFFLINE_TEXT.test(text) ? 'offline' : undefined)
    ?? (/lcoder-cloud|LCODER_CLOUD|MISSING_CREDENTIAL/.test(text) ? 'needs_login' : undefined)
  const requestId = JSON_REQUEST_ID.exec(text)?.[1]
  return {
    ...code === undefined ? {} : { code },
    ...requestId === undefined ? {} : { requestId },
  }
}

/**
 * 从会话快照的错误字段取出一条提示。
 *
 * 只认 `promptError.op === 'send'`：外壳没有停止按钮，`stop` 那类失败不是本壳的
 * 动作结果，冒出来只会误导。两个字段都没有时返回 null。
 * @param snapshot - 客户端会话快照（取本判定用到的字段）。
 * @returns 提示，或 null。
 */
export function noticeFromSnapshot(snapshot: {
  readonly promptError?: { readonly op?: string; readonly error?: { readonly code?: string; readonly message?: string } } | null
  readonly lastAgentError?: string | null
}): ShellSessionNotice | null {
  const promptError = snapshot.promptError
  if (promptError !== null && promptError !== undefined && promptError.op === 'send') {
    const code = promptError.error?.code ?? 'gateway/internal'
    const text = promptError.error?.message ?? ''
    const extracted = cloudCodeFromError(`${code} ${text}`)
    return {
      key: 'shell.sendRefused',
      detail: `${code}: ${text}`,
      ...extracted.code === undefined ? {} : { code: extracted.code },
      ...extracted.requestId === undefined ? {} : { requestId: extracted.requestId },
    }
  }
  const agentError = snapshot.lastAgentError
  if (typeof agentError === 'string' && agentError !== '') {
    const extracted = cloudCodeFromError(agentError)
    return {
      key: 'shell.turnFailed',
      detail: agentError,
      ...extracted.code === undefined ? {} : { code: extracted.code },
      ...extracted.requestId === undefined ? {} : { requestId: extracted.requestId },
    }
  }
  return null
}
