/**
 * Prototype Studio 协作端访问宿主面的窄桥接。
 * 与 prototype-panel 的本地 lcoderBridge 同语义，但只列工作室用到的方法，便于注入测试替身。
 *
 * 工作室的方法与字段来自桌面契约源码；这里按结构声明，避免渲染端依赖滞后的构建产物类型。
 */

import type {
  EventOutcome,
  HostEvent,
  HostWaterfall,
  HostWaterfallCancel,
  LcoderApi,
  RemoteResult,
  StreamFrame,
} from '@maniu/desktop/contract'

/** 工作室收到的元素点选信息；label 缺省时用 DOM 路径展示。 */
export interface StudioSelectionInfo {
  readonly domPath: string
  readonly html: string
  readonly css: string
  readonly label?: string
}

/** 原型画布当前是普通交互还是元素选择。 */
export type StudioInteractionMode = 'interact' | 'select'

/** Prototype Studio 的视图模式。 */
export type StudioViewMode = 'split' | 'fullscreen-pinned' | 'compare-side-by-side'

/** 全屏置顶模式下协作浮窗的位置与尺寸；x/y 为负表示靠右/靠上自动定位。 */
export interface StudioFloatingBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly collapsed?: boolean
}

/** 宿主应用后的浮窗矩形；负坐标已解析成实际的贴边位置。 */
export interface StudioFloatingRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 重载工作台画布的内容。 */
export interface StudioHtmlPayload {
  readonly html: string
  readonly beforeHtml?: string
  readonly highlightDomPaths?: readonly string[]
}

/** 打开 Prototype Studio 的请求。 */
export interface StudioOpenRequest {
  readonly requirementId: string
  readonly sessionId?: string
  readonly html: string
  readonly beforeHtml?: string
  readonly mode?: StudioViewMode
}

/** 宿主实际暴露的工作室方法；用结构类型描述，与桌面契约源码一致。 */
export interface StudioHostApi {
  openPrototypeStudio(request: StudioOpenRequest): Promise<void>
  setPrototypeStudioMode(mode: StudioViewMode): Promise<void>
  setPrototypeStudioInteraction(mode: StudioInteractionMode): Promise<void>
  loadPrototypeStudioHtml(payload: StudioHtmlPayload): Promise<void>
  highlightPrototypeStudioPaths(paths: readonly string[]): Promise<void>
  setPrototypeStudioFloatingBounds(bounds: StudioFloatingBounds): Promise<StudioFloatingRect | undefined>
  onPrototypeSelection(listener: (info: StudioSelectionInfo) => void): () => void
}

/** 工作室需要的宿主方法；全部可选，宿主缺项时界面按不可用降级。 */
export interface StudioBridge {
  readonly call?: (namespace: string, method: string, args: object) => Promise<RemoteResult>
  readonly openStream?: (namespace: string, method: string, args: object) => Promise<string>
  readonly cancelStream?: (streamId: string) => Promise<void>
  readonly onStreamFrame?: (listener: (streamId: string, frame: StreamFrame) => void) => () => void
  readonly onEvent?: (listener: (event: HostEvent) => void) => () => void
  readonly onWaterfall?: (listener: (event: HostWaterfall) => void) => () => void
  readonly onWaterfallCancel?: (listener: (event: HostWaterfallCancel) => void) => () => void
  readonly eventResult?: (clientId: string, eventId: string, outcome: EventOutcome) => Promise<void>
  readonly onPrototypeSelection?: StudioHostApi['onPrototypeSelection']
  readonly openPrototypeStudio?: StudioHostApi['openPrototypeStudio']
  readonly setPrototypeStudioInteraction?: StudioHostApi['setPrototypeStudioInteraction']
  readonly setPrototypeStudioMode?: StudioHostApi['setPrototypeStudioMode']
  readonly loadPrototypeStudioHtml?: StudioHostApi['loadPrototypeStudioHtml']
  readonly highlightPrototypeStudioPaths?: StudioHostApi['highlightPrototypeStudioPaths']
  readonly setPrototypeStudioFloatingBounds?: StudioHostApi['setPrototypeStudioFloatingBounds']
}

/**
 * 取当前渲染端的宿主桥；没有 preload 时返回 undefined。
 * @returns 宿主桥或 undefined。
 */
export function studioBridge(): StudioBridge | undefined {
  if (!('lcoder' in window)) return undefined
  const host = window.lcoder as LcoderApi & StudioHostApi
  return {
    call: (namespace, method, args) => host.call(namespace, method, args),
    openStream: (namespace, method, args) => host.openStream(namespace, method, args),
    cancelStream: streamId => host.cancelStream(streamId),
    onStreamFrame: listener => host.onStreamFrame(listener),
    onEvent: listener => host.onEvent(listener),
    onWaterfall: listener => host.onWaterfall(listener),
    onWaterfallCancel: listener => host.onWaterfallCancel(listener),
    eventResult: (clientId, eventId, outcome) => host.eventResult(clientId, eventId, outcome),
    onPrototypeSelection: listener => host.onPrototypeSelection(listener),
    openPrototypeStudio: request => host.openPrototypeStudio(request),
    setPrototypeStudioInteraction: mode => host.setPrototypeStudioInteraction(mode),
    setPrototypeStudioMode: mode => host.setPrototypeStudioMode(mode),
    loadPrototypeStudioHtml: payload => host.loadPrototypeStudioHtml(payload),
    highlightPrototypeStudioPaths: paths => host.highlightPrototypeStudioPaths(paths),
    setPrototypeStudioFloatingBounds: bounds => host.setPrototypeStudioFloatingBounds(bounds),
  }
}
