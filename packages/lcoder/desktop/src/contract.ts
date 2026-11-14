/** 主进程与渲染端共用的窄 IPC 契约（S1）。 */

/** 宿主子进程生命周期状态。 */
export type HostState =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'fatal'; readonly detail: string }
  | { readonly kind: 'stopped' }

/** 宿主 Remote 失败字段。 */
export interface RemoteFailure {
  readonly code: string
  readonly message: string
  readonly details?: object
}

/** 一次一元调用的结果。 */
export type RemoteResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure }

/** 一条逻辑流的帧。 */
export type StreamFrame =
  | { readonly kind: 'item'; readonly value: unknown }
  | { readonly kind: 'end' }
  | { readonly kind: 'error'; readonly error: RemoteFailure }

/** 宿主 `$events` 的普通事件。 */
export interface HostEvent {
  readonly name: string
  readonly args: readonly unknown[]
}

/** 宿主 `$events` 的 waterfall 事件；S1 只转发，不回执卡片。 */
export interface HostWaterfall {
  readonly name: string
  readonly clientId: string
  readonly eventId: string
  readonly request: object
}

/** 客户端对 waterfall 的回执。 */
export type EventOutcome =
  | { readonly kind: 'next' }
  | { readonly kind: 'result'; readonly value?: unknown }
  | {
    readonly kind: 'rejected'
    readonly error: { readonly name: string; readonly message: string; readonly code?: string }
  }

/** 自绘标题栏的窗口动作。 */
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

/** preload 暴露给渲染端的完整面。 */
export interface LcoderApi {
  /** 订阅宿主状态；返回取消订阅函数。 */
  hostState(listener: (state: HostState) => void): () => void
  /** 拉取当前宿主状态；用于挂载时补读。 */
  hostStateNow(): Promise<HostState>
  /** 一元 Remote 调用。 */
  call(namespace: string, method: string, args: object): Promise<RemoteResult>
  /** 打开一条流；返回主进程分配的流标识。 */
  openStream(namespace: string, method: string, args: object): Promise<string>
  /** 取消一条流。 */
  cancelStream(streamId: string): Promise<void>
  /** 订阅流帧。 */
  onStreamFrame(listener: (streamId: string, frame: StreamFrame) => void): () => void
  /** 订阅宿主事件。 */
  onEvent(listener: (event: HostEvent) => void): () => void
  /** 订阅 waterfall 事件。 */
  onWaterfall(listener: (event: HostWaterfall) => void): () => void
  /** 回执一个 waterfall。 */
  eventResult(clientId: string, eventId: string, outcome: EventOutcome): Promise<void>
  /** 自绘标题栏动作。 */
  window(action: WindowAction): Promise<void>
  /** 应用版本与宿主地址，仅用于诊断展示。 */
  appInfo(): Promise<{ readonly version: string; readonly hostUrl?: string }>
}
