/** 渲染端看到的窄 IPC 契约；与 `@lcoder/desktop` 的 contract.ts 保持同名同形。 */

export type HostState =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'fatal'; readonly detail: string }
  | { readonly kind: 'stopped' }

export interface RemoteFailure {
  readonly code: string
  readonly message: string
  readonly details?: object
}

export type RemoteResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure }

export type StreamFrame =
  | { readonly kind: 'item'; readonly value: unknown }
  | { readonly kind: 'end' }
  | { readonly kind: 'error'; readonly error: RemoteFailure }

export interface HostEvent {
  readonly name: string
  readonly args: readonly unknown[]
}

export interface HostWaterfall {
  readonly name: string
  readonly clientId: string
  readonly eventId: string
  readonly request: object
}

export type EventOutcome =
  | { readonly kind: 'next' }
  | { readonly kind: 'result'; readonly value?: unknown }
  | { readonly kind: 'rejected'; readonly error: { readonly name: string; readonly message: string; readonly code?: string } }

export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

export interface LcoderApi {
  hostState(listener: (state: HostState) => void): () => void
  hostStateNow(): Promise<HostState>
  call(namespace: string, method: string, args: object): Promise<RemoteResult>
  openStream(namespace: string, method: string, args: object): Promise<string>
  cancelStream(streamId: string): Promise<void>
  onStreamFrame(listener: (streamId: string, frame: StreamFrame) => void): () => void
  onEvent(listener: (event: HostEvent) => void): () => void
  onWaterfall(listener: (event: HostWaterfall) => void): () => void
  eventResult(clientId: string, eventId: string, outcome: EventOutcome): Promise<void>
  window(action: WindowAction): Promise<void>
  appInfo(): Promise<{ readonly version: string; readonly hostUrl?: string }>
}

declare global {
  interface Window {
    readonly lcoder: LcoderApi
  }
}
