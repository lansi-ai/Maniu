/** 主进程内的宿主协议薄适配层：token→cookie、一元 POST、WS mux、`$events`。 */

import WebSocket, { type RawData } from 'ws'
import type {
  EventOutcome, HostEvent, HostWaterfall, HostWaterfallCancel, RemoteFailure, RemoteResult, StreamFrame,
} from './contract.ts'

const EVENT_STREAM_ID = 'ev'
const EVENT_RESULT_ENDPOINT = '$events/result'

/** 渲染端允许调用的一元方法；只放行工作台、账号与设置需要的窄面，不透传任意路径。 */
const UNARY_ALLOWED = new Set([
  'lcoderCloud/state',
  'lcoderCloud/sendSms',
  'lcoderCloud/register',
  'lcoderCloud/loginSms',
  'lcoderCloud/loginPassword',
  'lcoderCloud/refresh',
  'lcoderCloud/me',
  'lcoderCloud/logout',
  'lcoderCloud/usage',
  'lcoderCloud/talents',
  'lcoderCloud/createTalent',
  'lcoderCloud/updateTalent',
  'lcoderCloud/deleteTalent',
  'session/list',
  'session/create',
  'session/prompt',
  'session/cancel',
  'session/rename',
  'session/events',
  'session/attachment',
  'session/modelCatalog',
  'session/selectModel',
  'fileUploads/upload',
  'prototype/prefetch',
  'prototype/uploadRef',
  'prototype/clear',
  'prototype/adopt',
  'prototype/getStaged',
  'prototype/commitStaged',
  'prototype/discardStaged',
  'prototype/listSnapshots',
  'prototype/getSnapshot',
  'prototype/restoreSnapshot',
  'workspace/create',
  'workspace/initializeDefault',
  'workspaceFiles/list',
  'workspaceFiles/read',
  'workspaceFiles/readBytes',
  'workspaceFiles/stat',
  'settings/describe',
  'settings/mutate',
  'credentials/describe',
  'credentials/set',
  'credentials/unset',
  'llm/listProviders',
  'llm/listConfigurableProviders',
  'llm/discoverModels',
  'commands/list',
  'commands/execute',
  'agentPresets/list',
  'agentPresets/read',
  'agentTalents/applyTalents',
  'agentTalents/removeTalent',
  'agentTalents/sessionRefs',
  'agentTalents/catalog',
  'agentTalents/presetTools',
  'agentTalents/projectIdentity',
  'agentTalents/ensureProjectId',
])

/** 渲染端允许打开的流式方法。 */
const STREAM_ALLOWED = new Set(['session/follow', 'session/control', 'workspace/follow'])

/** 转发给渲染端的宿主事件。 */
const FORWARDED_EVENTS = new Set([
  'api-session/added',
  'api-session/removed',
  'api-session/status',
  'api-session/activity',
  'api-session/error',
  'llm/models-updated',
  'llm/adapters-updated',
  'credentials/reference-updated',
  'settings/document-updated',
])

/** 转发给渲染端的 waterfall 事件；渲染端画卡并回执。 */
const FORWARDED_WATERFALLS = new Set(['approval/request', 'user-questions/request'])

/** 工作台主动作允许的人机命令；其余命令不透传。 */
const COMMAND_ALLOWED = new Set([
  'requirement_approve',
  'requirement_release',
  'requirement_close',
  'requirement_review_decide',
  'task_contract',
  'task_discard',
  'task_bind',
  'task_assign',
  'task_split_ready',
  'task_schedule',
  'contract_sign',
  'proposal_approve',
  'proposal_reject',
  'flow_status',
  'flow_log',
  'flow_save',
  'agent_bind',
  'role_upsert',
])

/** 一条命令行里的命令名；不是 `/name` 形状时为空串。 */
function commandNameOf(args: object): string {
  const line = 'line' in args && typeof args.line === 'string' ? args.line.trim() : ''
  const match = /^\/([A-Za-z0-9_-]+)/u.exec(line)
  return match?.[1] ?? ''
}

/** 宿主事件与流帧的接收面。 */
export interface LinkSink {
  onEvent(event: HostEvent): void
  onWaterfall(event: HostWaterfall): void
  onWaterfallCancel(event: HostWaterfallCancel): void
  onStreamFrame(streamId: string, frame: StreamFrame): void
}

interface PendingStream {
  readonly endpoint: string
  readonly args: object
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把一帧 waterfall 折成渲染端事件。
 *
 * 事件代际来自同一代 `$events` 开场的 ready 帧，waterfall 帧里没有 `clientId`；
 * 会话身份取自帧里的 `agentId`，原样下发给渲染端做归属。缺代际、缺会话身份或
 * 事件不在白名单时返回 undefined。
 * @param value - `$events` 的一帧。
 * @param clientId - 本次连接的事件代际。
 * @returns 渲染端事件，或 undefined。
 */
export function waterfallOf(value: unknown, clientId: string | undefined): HostWaterfall | undefined {
  if (clientId === undefined || !isRecord(value) || value.type !== 'waterfall') return undefined
  if (typeof value.event !== 'string' || !FORWARDED_WATERFALLS.has(value.event)
    || typeof value.eventId !== 'string' || typeof value.agentId !== 'string'
    || !isRecord(value.request)) return undefined
  return { name: value.event, clientId, eventId: value.eventId, agentId: value.agentId, request: value.request }
}

/**
 * 把一帧 waterfall 撤回折成渲染端通知。
 * @param value - `$events` 的一帧。
 * @returns 撤回事件，或 undefined。
 */
export function waterfallCancelOf(value: unknown): HostWaterfallCancel | undefined {
  if (!isRecord(value) || value.type !== 'cancel' || typeof value.eventId !== 'string') return undefined
  return { eventId: value.eventId }
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function failureOf(value: unknown): RemoteFailure {
  if (!isRecord(value)) return { code: 'lcoder/invalid-failure', message: '宿主返回了无法识别的失败字段' }
  return {
    code: typeof value.code === 'string' ? value.code : 'lcoder/invalid-failure',
    message: typeof value.message === 'string' ? value.message : '宿主返回了无法识别的失败字段',
    ...(isRecord(value.details) ? { details: value.details } : {}),
  }
}

/** 解析结果信封。 */
function resultOf(value: unknown): RemoteResult {
  if (!isRecord(value)) return { ok: false, error: failureOf(undefined) }
  if (value.ok === true) return { ok: true, value: value.value }
  return { ok: false, error: failureOf(value.error) }
}

interface BinaryAttachment {
  readonly part: string
  readonly path: readonly (string | number)[]
}

function attachmentOf(value: unknown): BinaryAttachment | undefined {
  if (!isRecord(value) || value.codec !== 'bytes' || typeof value.part !== 'string' || !Array.isArray(value.path)) return undefined
  const path = value.path.filter((segment): segment is string | number =>
    typeof segment === 'string' || typeof segment === 'number')
  return path.length === value.path.length ? { part: value.part, path } : undefined
}

/**
 * 解析 `multipart/form-data` 结果：metadata 信封 + 按 path 回填的字节段。
 * @param response - 宿主响应。
 * @param rpcId - 本次调用编号；回执必须对得上。
 * @returns 已解码的一元结果。
 */
async function binaryResultOf(response: Response, rpcId: string): Promise<RemoteResult> {
  const form = await response.formData()
  const metadata = form.get('metadata')
  if (typeof metadata !== 'string') {
    return { ok: false, error: { code: 'lcoder/invalid-response', message: '二进制回执缺少 metadata' } }
  }
  let envelope: unknown
  try {
    envelope = JSON.parse(metadata)
  } catch {
    return { ok: false, error: { code: 'lcoder/invalid-response', message: '二进制回执的 metadata 不是 JSON' } }
  }
  if (!isRecord(envelope) || envelope.rpcId !== rpcId) {
    return { ok: false, error: { code: 'lcoder/invalid-response', message: '二进制回执的 rpcId 不匹配' } }
  }
  const result = resultOf(envelope.result)
  if (!result.ok || !Array.isArray(envelope.attachments)) return result
  const root: { value: unknown } = { value: result.value }
  for (const raw of envelope.attachments) {
    const attachment = attachmentOf(raw)
    if (attachment === undefined) {
      return { ok: false, error: { code: 'lcoder/invalid-response', message: '二进制回执的附件事项不合法' } }
    }
    const data = form.get(attachment.part)
    if (!(data instanceof Blob)) {
      return { ok: false, error: { code: 'lcoder/invalid-response', message: '二进制回执缺少字节段' } }
    }
    let parent: object = root
    let key: string | number = 'value'
    for (const segment of attachment.path) {
      const value: unknown = Reflect.get(parent, key)
      if (typeof value !== 'object' || value === null) {
        return { ok: false, error: { code: 'lcoder/invalid-response', message: '二进制回执的路径不合法' } }
      }
      parent = value
      key = segment
    }
    Reflect.set(parent, key, new Uint8Array(await data.arrayBuffer()))
  }
  return { ok: true, value: root.value }
}

/**
 * 一条宿主连接的完整生命周期。`connect` 换 cookie 后开 mux；断线自动重连并重开 `$events`。
 */
export class HostLink {
  private base = ''
  private token = ''
  private cookie: string | undefined
  private socket: WebSocket | undefined
  private socketOpen = false
  private reconnectTimer: NodeJS.Timeout | undefined
  private stopping = false
  private rpcSeq = 0
  private streamSeq = 0
  private clientId: string | undefined
  private readonly streams = new Map<string, PendingStream>()
  private sink: LinkSink | undefined

  /** 当前客户端事件代际；回执 waterfall 时使用。 */
  get eventClientId(): string | undefined { return this.clientId }

  /**
   * 连接一个已就绪的宿主。
   * @param url - `desktop-host` 报告的 `ready.url`（带 launch token）。
   * @param sink - 事件与流帧接收面。
   */
  async connect(url: string, sink: LinkSink): Promise<void> {
    this.stopping = false
    this.sink = sink
    const parsed = new URL(url)
    const token = parsed.searchParams.get('token')
    if (token === null || token === '') throw new Error('lcoder link: 宿主就绪地址缺少 token')
    this.base = parsed.origin
    this.token = token
    this.cookie = await this.exchangeCookie()
    this.openSocket()
  }

  /** 断开并停止重连。关窗走 terminate：宿主不必等待逻辑流优雅结束。 */
  close(): void {
    this.stopping = true
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    const socket = this.socket
    this.socket = undefined
    this.socketOpen = false
    this.streams.clear()
    // 优雅 close 的握手依赖对端读事件；应用已在退出路径上，多一条 open 的逻辑流
    // （workspace/follow）就会把宿主关停拖过探针的退出窗口。直接断开 TCP 即可。
    socket?.terminate()
  }

  /**
   * 发一次一元调用。
   * @param namespace - Remote 命名空间。
   * @param method - 方法名。
   * @param args - 生成签名里的参数对象。
   * @returns 宿主的成功值或结构化失败。
   */
  async call(namespace: string, method: string, args: object): Promise<RemoteResult> {
    const endpoint = `${namespace}/${method}`
    if (!UNARY_ALLOWED.has(endpoint)) {
      return { ok: false, error: { code: 'lcoder/not-allowed', message: `未开放 ${endpoint}` } }
    }
    if (endpoint === 'commands/execute') {
      const name = commandNameOf(args)
      if (!COMMAND_ALLOWED.has(name)) {
        return { ok: false, error: { code: 'lcoder/not-allowed', message: `未开放命令 /${name}` } }
      }
    }
    return this.post(endpoint, args)
  }

  /**
   * 打开一条逻辑流。
   * @param namespace - Remote 命名空间。
   * @param method - 方法名。
   * @param args - 生成签名里的参数对象。
   * @returns 主进程分配的流标识。
   */
  openStream(namespace: string, method: string, args: object): string {
    const endpoint = `${namespace}/${method}`
    if (!STREAM_ALLOWED.has(endpoint)) throw new Error(`lcoder link: 未开放流 ${endpoint}`)
    const streamId = `s${++this.streamSeq}`
    this.streams.set(streamId, { endpoint, args })
    if (this.socketOpen) this.sendOpen(streamId, { endpoint, args })
    return streamId
  }

  /** 取消一条流。 */
  cancelStream(streamId: string): void {
    if (!this.streams.delete(streamId)) return
    if (this.socketOpen) this.send({ type: 'cancel', streamId })
  }

  /**
   * 回执一个 waterfall。
   * @param clientId - `$events` 开场帧里的 clientId。
   * @param eventId - waterfall 帧的事件标识。
   * @param outcome - 回执结果。
   */
  async eventResult(clientId: string, eventId: string, outcome: EventOutcome): Promise<RemoteResult> {
    return this.post(EVENT_RESULT_ENDPOINT, { clientId, eventId, outcome })
  }

  private async exchangeCookie(): Promise<string> {
    const response = await fetch(
      `${this.base}/connect?token=${encodeURIComponent(this.token)}&interactions=answer`,
      { redirect: 'manual' },
    )
    const cookies = response.headers.getSetCookie()
    const first = cookies[0]
    if (first === undefined || first === '') {
      throw new Error(`lcoder link: /connect 没有下发 cookie（HTTP ${String(response.status)}）`)
    }
    return first.split(';', 1)[0] ?? first
  }

  private openSocket(): void {
    if (this.stopping) return
    const target = `${this.base.replace('http://', 'ws://').replace('https://', 'wss://')}/api/remote.mux`
    const socket = new WebSocket(target, this.cookie === undefined ? {} : { headers: { cookie: this.cookie } })
    this.socket = socket
    socket.on('open', () => {
      this.socketOpen = true
      this.sendOpen(EVENT_STREAM_ID, { endpoint: '$events', args: {} })
      for (const [streamId, stream] of this.streams) this.sendOpen(streamId, stream)
    })
    socket.on('message', (data) => { this.receive(textOf(data)) })
    socket.on('close', () => {
      this.socketOpen = false
      this.socket = undefined
      this.clientId = undefined
      if (this.stopping) return
      for (const streamId of this.streams.keys()) {
        this.sink?.onStreamFrame(streamId, {
          kind: 'error',
          error: { code: 'lcoder/transport-closed', message: '宿主连接已断开，需重新订阅' },
        })
      }
      this.streams.clear()
      this.scheduleReconnect()
    })
    socket.on('error', (error) => {
      console.error('lcoder link: 宿主 WebSocket 报错', error)
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined || this.stopping) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void (async () => {
        this.cookie = await this.exchangeCookie()
        this.openSocket()
      })().catch((error: unknown) => {
        console.error('lcoder link: 重连失败', error)
        this.scheduleReconnect()
      })
    }, 750)
  }

  private sendOpen(streamId: string, stream: { endpoint: string; args: object }): void {
    this.send({ type: 'open', streamId, endpoint: stream.endpoint, payload: { args: stream.args } })
  }

  private send(value: object): void {
    this.socket?.send(JSON.stringify(value))
  }

  private receive(text: string): void {
    let decoded: unknown
    try {
      decoded = JSON.parse(text)
    } catch {
      console.error('lcoder link: 宿主流帧不是 JSON')
      return
    }
    if (!isRecord(decoded) || typeof decoded.streamId !== 'string') return
    const streamId = decoded.streamId
    if (decoded.type === 'item') {
      if (streamId === EVENT_STREAM_ID) this.receiveEvent(decoded.value)
      else this.sink?.onStreamFrame(streamId, { kind: 'item', value: decoded.value })
      return
    }
    if (decoded.type === 'end') {
      if (streamId === EVENT_STREAM_ID) return
      this.streams.delete(streamId)
      this.sink?.onStreamFrame(streamId, { kind: 'end' })
      return
    }
    if (decoded.type === 'error') {
      const error = failureOf(decoded.error)
      if (streamId === EVENT_STREAM_ID) {
        console.error('lcoder link: $events 失败', error.code, error.message)
        return
      }
      this.streams.delete(streamId)
      this.sink?.onStreamFrame(streamId, { kind: 'error', error })
    }
  }

  private receiveEvent(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string') return
    if (value.type === 'ready') {
      if (typeof value.clientId === 'string') this.clientId = value.clientId
      return
    }
    if (value.type === 'emit') {
      if (typeof value.event !== 'string' || !FORWARDED_EVENTS.has(value.event)) return
      this.sink?.onEvent({ name: value.event, args: Array.isArray(value.args) ? value.args : [] })
      return
    }
    const waterfall = waterfallOf(value, this.clientId)
    if (waterfall !== undefined) {
      this.sink?.onWaterfall(waterfall)
      return
    }
    const cancel = waterfallCancelOf(value)
    if (cancel !== undefined) this.sink?.onWaterfallCancel(cancel)
  }

  private async post(endpoint: string, args: object): Promise<RemoteResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.cookie === undefined) this.cookie = await this.exchangeCookie()
      const rpcId = `lcoder-${++this.rpcSeq}`
      const response = await fetch(`${this.base}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: this.cookie },
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
      })
      if (response.status === 401 && attempt === 0) {
        this.cookie = await this.exchangeCookie()
        continue
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('multipart/form-data')) return binaryResultOf(response, rpcId)
      let decoded: unknown
      try {
        decoded = JSON.parse(await response.text())
      } catch {
        return { ok: false, error: { code: 'lcoder/invalid-response', message: `宿主返回了非 JSON（HTTP ${String(response.status)}）` } }
      }
      if (!isRecord(decoded) || decoded.type !== 'server-response') {
        return { ok: false, error: { code: 'lcoder/invalid-response', message: '宿主返回了无法识别的响应信封' } }
      }
      return resultOf(decoded.result)
    }
    return { ok: false, error: { code: 'lcoder/unauthorized', message: '宿主鉴权失败' } }
  }
}
