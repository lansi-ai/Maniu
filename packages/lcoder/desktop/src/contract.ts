/** 主进程与渲染端共用的窄 IPC 契约（S1）。 */

/** 渲染端可见的 IPC 通道名；主进程与 preload 都从这里取，避免字面量漂移。 */
export const IPC_CHANNELS = {
  hostState: 'lcoder:host-state',
  hostStateNow: 'lcoder:host-state-now',
  call: 'lcoder:call',
  streamOpen: 'lcoder:stream-open',
  streamCancel: 'lcoder:stream-cancel',
  streamFrame: 'lcoder:stream-frame',
  events: 'lcoder:events',
  waterfall: 'lcoder:waterfall',
  waterfallCancel: 'lcoder:waterfall-cancel',
  eventResult: 'lcoder:event-result',
  window: 'lcoder:window',
  closeRequest: 'lcoder:close-request',
  confirmClose: 'lcoder:close-confirm',
  windowState: 'lcoder:window-state',
  windowStateNow: 'lcoder:window-state-now',
  appInfo: 'lcoder:app-info',
  update: 'lcoder:update',
  locale: 'lcoder:locale',
  preferencesRead: 'lcoder:preferences-read',
  preferencesWrite: 'lcoder:preferences-write',
  pickDirectory: 'lcoder:pick-directory',
  /** 主窗请求打开独立原型预览窗口。 */
  prototypePreviewOpen: 'lcoder:prototype-preview-open',
  /** 预览窗口把点选元素上报给主进程。 */
  prototypeSelectionReport: 'lcoder:prototype-selection-report',
  /** 主进程把点选元素转发给主窗渲染端。 */
  prototypeSelection: 'lcoder:prototype-selection',
  /** 主窗请求打开 Prototype Studio 多视图工作台。 */
  prototypeStudioOpen: 'lcoder:prototype-studio-open',
  /** 切换工作台的视图模式。 */
  prototypeStudioSetMode: 'lcoder:prototype-studio-set-mode',
  /** 切换原型画布的交互/选择模式。 */
  prototypeStudioSetInteraction: 'lcoder:prototype-studio-set-interaction',
  /** 重载工作台的暂存版与正式版 HTML。 */
  prototypeStudioLoadHtml: 'lcoder:prototype-studio-load-html',
  /** 给原型画布标记需要修改的 DOM 路径。 */
  prototypeStudioHighlightPaths: 'lcoder:prototype-studio-highlight-paths',
  /** 设置全屏置顶模式下协作浮窗的位置与尺寸。 */
  prototypeStudioSetFloatingBounds: 'lcoder:prototype-studio-set-floating-bounds',
  /** 主进程下发到原型画布 preload 的检查器控制（交互模式与高亮路径）。 */
  prototypeStudioInspectControl: 'lcoder:prototype-studio-inspect-control',
} as const

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

/** 宿主 `$events` 的 waterfall 事件；渲染端画卡并把 outcome 原样回执。 */
export interface HostWaterfall {
  readonly name: string
  readonly clientId: string
  readonly eventId: string
  /**
   * 发起这次交互的 agent 标识；与会话标识是同一个值，wire 上是普通字符串。
   * 渲染端用它做字符串相等归属，不从 clientId、问题内容或到达时间推断。
   */
  readonly agentId: string
  readonly request: object
}

/** 宿主撤回一条等待中的 waterfall（回合被停掉或请求超时）。 */
export interface HostWaterfallCancel {
  readonly eventId: string
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

/** 关窗确认请求：主进程判定有回合在跑时才下发。 */
export interface CloseRequest {
  /** 当前在跑的会话数。 */
  readonly running: number
}

/** 主窗口的最大化与全屏实况；自绘标题栏据此切换按钮语义。 */
export interface WindowStateInfo {
  readonly maximized: boolean
  readonly fullscreen: boolean
}

/** 界面语言；主进程菜单与托盘跟随同一个值。 */
export type DesktopLocaleId = 'zh' | 'en'

/** 三态外观；与渲染端三态取值同一组字面量，字段名 skin 保持 IPC 契约不变。 */
export const DESKTOP_SKINS = ['light', 'dark', 'system'] as const

/** 外观标识。 */
export type DesktopSkinId = (typeof DESKTOP_SKINS)[number]

/** 两套字体；与渲染端 `FontId` 同一组字面量。 */
export const DESKTOP_FONTS = ['system', 'modern'] as const

/** 字体标识。 */
export type DesktopFontId = (typeof DESKTOP_FONTS)[number]

/**
 * 跨重启保留的界面偏好。
 *
 * 写盘发生在主进程的每次用户选择，而不是退出时：确定性退出会直接终止
 * 进程，渲染端 localStorage 的末批写入可能来不及落盘。
 */
export interface DesktopPreferences {
  readonly skin: DesktopSkinId
  readonly font: DesktopFontId
  readonly locale: DesktopLocaleId
  /** 上次成功选择的目录；取消对话框不更新，作为下次选择的起始目录。 */
  readonly lastPickedDirectory: string | null
}

/**
 * 一次更新检查的结果。
 *
 * 新壳当前没有接入更新源，`unavailable` 是正常空态而不是失败：界面必须
 * 解释「这个构建不能检查更新」，不能显示成网络错误或永远转圈。
 */
export type UpdateCheck =
  | { readonly kind: 'unavailable'; readonly version: string; readonly reason: 'no-feed' }
  | { readonly kind: 'checking'; readonly version: string }
  | { readonly kind: 'up-to-date'; readonly version: string }
  | { readonly kind: 'error'; readonly version: string; readonly detail: string }

/** 主进程目录选择的回执；失败带人能读的原因，不静默变成取消。 */
export type DirectoryPickResult =
  | { readonly ok: true; readonly path: string | null }
  | { readonly ok: false; readonly message: string }

/** 独立预览窗口点选元素的上报信息；只含元素自身，不含宿主或页面外数据。 */
export interface PrototypeSelectionInfo {
  /** 从 body 到元素的 DOM 路径；元素级修改按它定位。 */
  readonly domPath: string
  /** 元素的 outerHTML（已剥掉脚本与事件属性并截断）。 */
  readonly html: string
  /** 关键计算样式，形如 `color: #333; font-size: 16px`。 */
  readonly css: string
  /** 元素的可读短名（aria-label、首段可见文本或标签标识），最多 80 字符。 */
  readonly label?: string
}

/** Prototype Studio 的视图模式：分屏、全屏置顶浮窗、并排对比。 */
export type PrototypeStudioMode = 'split' | 'fullscreen-pinned' | 'compare-side-by-side'

/** 原型画布当前是普通交互还是元素选择。 */
export type PrototypeInteractionMode = 'interact' | 'select'

/** 全屏置顶模式下协作界面浮窗的位置与尺寸；x/y 为负表示靠右/靠上自动定位。 */
export interface PrototypeStudioFloatingBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** 折叠后收缩为胶囊条，只保留标题高度。 */
  readonly collapsed?: boolean
}

/** 打开 Prototype Studio 的请求；html 为暂存版，beforeHtml 为并排对比用的正式版。 */
export interface PrototypeStudioOpenRequest {
  readonly requirementId: string
  readonly sessionId?: string
  readonly html: string
  readonly beforeHtml?: string
  readonly mode?: PrototypeStudioMode
}

/** 重载工作台画布的内容；highlightDomPaths 是需要在暂存版上标记修改的 DOM 路径。 */
export interface PrototypeStudioHtmlPayload {
  readonly html: string
  readonly beforeHtml?: string
  readonly highlightDomPaths?: readonly string[]
}

/** 主进程下发到原型画布 preload 的检查器控制载荷。 */
export type PrototypeStudioInspectControl =
  | { readonly interactionMode: PrototypeInteractionMode }
  | { readonly highlightDomPaths: readonly string[] }

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
  /** 订阅 waterfall 撤回。 */
  onWaterfallCancel(listener: (event: HostWaterfallCancel) => void): () => void
  /** 回执一个 waterfall。 */
  eventResult(clientId: string, eventId: string, outcome: EventOutcome): Promise<void>
  /** 自绘标题栏动作。 */
  window(action: WindowAction): Promise<void>
  /** 订阅关窗确认请求；只有存在运行中回合时才会到达。 */
  onCloseRequest(listener: (request: CloseRequest) => void): () => void
  /** 确认放弃运行中的回合并关窗。 */
  confirmClose(): Promise<void>
  /** 订阅最大化与全屏变化；返回取消订阅函数。 */
  windowState(listener: (state: WindowStateInfo) => void): () => void
  /** 拉取当前窗口状态；用于挂载时补读。 */
  windowStateNow(): Promise<WindowStateInfo>
  /** 应用版本与宿主地址，仅用于诊断展示。 */
  appInfo(): Promise<{ readonly version: string; readonly hostUrl?: string }>
  /** 检查更新；没有更新源时返回可解释的空态。 */
  update(): Promise<UpdateCheck>
  /** 同步界面语言到主进程菜单与托盘。 */
  setLocale(locale: DesktopLocaleId): Promise<void>
  /** 读主进程保存的完整偏好；启动时由渲染端补读。 */
  readPreferences(): Promise<DesktopPreferences>
  /** 写一项或多项偏好；主进程负责落盘并返回合并后的完整值。 */
  writePreferences(patch: Partial<DesktopPreferences>): Promise<DesktopPreferences>
  /**
   * 弹出系统目录选择框。
   * @param defaultPath - 期望的起始目录；不是已存在目录时主进程退到最近的已存在祖先，再退到上次成功选择的目录。
   * @returns 选中的目录；取消返回 null，打不开时抛错而不是当作取消。
   */
  pickDirectory(defaultPath?: string): Promise<string | null>
  /** 在独立沙箱窗口里交互预览一份 HTML 原型；只由主窗口调用。 */
  openPrototypePreview(html: string): Promise<void>
  /** 订阅独立预览窗口的元素点选上报；返回取消订阅函数。 */
  onPrototypeSelection(listener: (info: PrototypeSelectionInfo) => void): () => void
  /** 打开 Prototype Studio 多视图工作台；只由主窗口调用。 */
  openPrototypeStudio(request: PrototypeStudioOpenRequest): Promise<void>
  /** 切换工作台的视图模式。 */
  setPrototypeStudioMode(mode: PrototypeStudioMode): Promise<void>
  /** 切换原型画布的交互/选择模式。 */
  setPrototypeStudioInteraction(mode: PrototypeInteractionMode): Promise<void>
  /** 重载工作台暂存版与正式版 HTML。 */
  loadPrototypeStudioHtml(payload: PrototypeStudioHtmlPayload): Promise<void>
  /** 在暂存版画布上标记需要修改的 DOM 路径；空数组清除标记。 */
  highlightPrototypeStudioPaths(paths: readonly string[]): Promise<void>
  /** 设置全屏置顶模式下协作浮窗的位置与尺寸。 */
  setPrototypeStudioFloatingBounds(bounds: PrototypeStudioFloatingBounds): Promise<void>
}
