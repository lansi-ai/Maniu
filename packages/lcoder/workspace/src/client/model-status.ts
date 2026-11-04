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
    return { key: 'shell.sendRefused', detail: `${code}: ${promptError.error?.message ?? ''}` }
  }
  const agentError = snapshot.lastAgentError
  if (typeof agentError === 'string' && agentError !== '') {
    return { key: 'shell.turnFailed', detail: agentError }
  }
  return null
}
