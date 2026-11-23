/**
 * Prototype Studio 协作端：左侧画布由宿主维护，这里只做只读投影与 Remote 操作。
 * 暂存落盘、丢弃、快照恢复全部走 prototype/* Remote，渲染端不直写任何文件。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@heroui/react'
import { GitCompareArrows, History, Maximize2, Minimize2, PanelRightClose } from 'lucide-react'
import type { Translate } from '../locale.ts'
import { translate, type MessageKey } from '../locale.ts'
import { usePreferences } from '../prefs.ts'
import { formatTimestamp } from '../pages/requirement-report.ts'
import { buildStudioCoDesignPrompt } from '../prototype/prompt.ts'
import type {
  PrototypeCommitResult,
  PrototypeStagedView,
  RequirementSyncStatus,
  StagedPrototype,
  UnaryCall,
} from '../prototype/remote.ts'
import {
  commitStagedPrototype, discardStagedPrototype, getStagedPrototype,
  listPrototypeSnapshots, restorePrototypeSnapshot,
} from '../prototype/remote.ts'
import type { PrototypeSnapshotMeta } from '../prototype/remote.ts'
import { AnchorComposer, type StudioAnchorDraft } from './anchor-composer.tsx'
import { ChangeCard } from './change-card.tsx'
import { CoDesignThread, type StudioTurnEcho } from './co-design-thread.tsx'
import { studioBridge, type StudioBridge, type StudioViewMode } from './bridge.ts'

/** 工作室根组件属性。 */
export interface PrototypeStudioAppProps {
  readonly requirementId: string
  /** URL 里带来的会话号；缺省时解析当前工作区作用域会话。 */
  readonly initialSessionId?: string | undefined
  readonly t?: Translate | undefined
  readonly bridge?: StudioBridge | undefined
  /** 一元调用注入点；缺省走宿主 preload。 */
  readonly call?: UnaryCall | undefined
}

const PROJECT_KEY = 'lcoder.m2.project'

/** 探测路径连续几次看到会话停止才算完成：避免排队中的消息被误判成已结束。 */
const STOPPED_PROBES_BEFORE_COMPLETE = 2

/** 折叠胶囊与展开浮窗的默认尺寸，与桌面端浮窗几何一致。 */
const FLOATING_EXPANDED = { width: 380, height: 520 } as const
const FLOATING_COLLAPSED = { width: 260, height: 48 } as const
/** 贴边默认间距，与桌面端 STUDIO_FLOATING_MARGIN 一致。 */
const FLOATING_MARGIN = 24

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 工作区作用域会话号：优先 URL 带来的会话号，其次本机项目档里的 scopeSessionId。
 * 它只服务 prototype/* Remote 的会话作用域，与协作对话用的会话号是两件事。
 * @param initialSessionId - URL 显式带来的会话号。
 * @returns 作用域会话号或 null。
 */
export function resolveScopeSessionId(initialSessionId?: string): string | null {
  if (initialSessionId !== undefined && initialSessionId !== '') return initialSessionId
  try {
    const raw = localStorage.getItem(PROJECT_KEY)
    if (raw !== null) {
      const value: unknown = JSON.parse(raw)
      if (isRecord(value) && typeof value.scopeSessionId === 'string' && value.scopeSessionId !== '') {
        return value.scopeSessionId
      }
    }
    return null
  } catch {
    // 偏好存储损坏时不猜作用域会话：Remote 缺会话号会显式报错，比拿错会话号安全。
    return null
  }
}

/**
 * 协作对话会话号：只认本需求上次用过的工作室会话，绝不回落到工作区作用域会话。
 * 首次发送时没有会话号就新建，避免把 scopeSessionId 当聊天会话号。
 * @param requirementId - 需求编号。
 * @param initialSessionId - 显式带来的会话号；测试与注入用。
 * @returns 会话号或 null。
 */
export function resolveStudioSessionId(requirementId: string, initialSessionId?: string): string | null {
  if (initialSessionId !== undefined && initialSessionId !== '') return initialSessionId
  try {
    const stored = localStorage.getItem(`lcoder.studio.session.${requirementId}`)
    if (stored !== null && stored !== '') return stored
  } catch {
    // 偏好存储损坏时不猜会话：后续发消息会显式新建。
  }
  return null
}

/** 会话没有工作区时的 Remote 错误码：只有这种失败允许换会话号重试。 */
const NO_WORKSPACE = 'PROTOTYPE/NO_WORKSPACE'

/**
 * prototype/* Remote 的会话号尝试顺序：先协作会话（暂存在它名下），再工作区作用域会话。
 * 重启后旧协作会话尚未激活时解析不出工作区，靠后一个兜底。
 * @param chatSessionId - 协作对话会话号。
 * @param scopeSessionId - 工作区作用域会话号。
 * @returns 去重后的候选会话号；两者都没有时为空数组。
 */
export function resolveRemoteSessionIds(
  chatSessionId: string | null,
  scopeSessionId: string | null,
): readonly string[] {
  const ids = [chatSessionId, scopeSessionId]
    .filter((id): id is string => id !== null && id !== '')
  return [...new Set(ids)]
}

/**
 * 判断一次 Remote 失败是不是「会话不存在或没有工作区」。
 * @param cause - 失败原因；unwrap 会把错误码放在 name 上。
 * @returns 是否为可回退的失败。
 */
function isNoWorkspace(cause: unknown): boolean {
  return cause instanceof Error && cause.name === NO_WORKSPACE
}

/**
 * 把同步回执映射成词典键；未知值按 none 处理。
 * @param status - 宿主回执状态。
 * @returns 消息键。
 */
function syncKey(status: RequirementSyncStatus): MessageKey {
  switch (status) {
    case 'patched': return 'studio.sync.patched'
    case 'amended': return 'studio.sync.amended'
    case 'skipped_pending': return 'studio.sync.skippedPending'
    case 'skipped_locked': return 'studio.sync.skippedLocked'
    case 'none': return 'studio.sync.none'
  }
}

function requestId(): string {
  return `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * 画 Prototype Studio 协作端。
 * @param props - 需求编号、可选会话号与注入的宿主/调用替身。
 * @returns 工作室界面。
 */
export function PrototypeStudioApp(props: PrototypeStudioAppProps): JSX.Element {
  const prefs = usePreferences()
  const t: Translate = props.t ?? ((key, params) => translate(prefs.locale, key, params))
  const bridge = useMemo<StudioBridge | undefined>(() => props.bridge ?? studioBridge(), [props.bridge])
  const invoke = useMemo<UnaryCall>(() => props.call ?? ((namespace, method, args) => {
    if (bridge?.call === undefined) return Promise.reject(new Error('宿主桥不可用'))
    return bridge.call(namespace, method, args)
  }), [bridge, props.call])

  const requirementId = props.requirementId
  // 作用域会话号只给 prototype/* Remote；协作对话有独立会话号，首次发送时才创建。
  const scopeSessionId = useMemo(
    () => resolveScopeSessionId(props.initialSessionId),
    [props.initialSessionId],
  )
  const [chatSessionId, setChatSessionId] = useState<string | null>(
    () => resolveStudioSessionId(requirementId),
  )
  const chatSessionIdRef = useRef(chatSessionId)
  chatSessionIdRef.current = chatSessionId

  /**
   * 用实际可用的会话号执行一次 prototype/* 调用。
   * 首选协作会话；它报告没有工作区时就回退工作区作用域会话重试一次，其余失败直接上抛。
   * @param run - 按会话号发起的调用。
   * @returns 调用结果。
   */
  const withRemoteSession = useCallback(async <T,>(run: (sessionId: string) => Promise<T>): Promise<T> => {
    const candidates = resolveRemoteSessionIds(chatSessionIdRef.current, scopeSessionId)
    if (candidates.length === 0) return run('')
    let failure: unknown
    for (const sessionId of candidates) {
      try {
        return await run(sessionId)
      } catch (cause: unknown) {
        if (!isNoWorkspace(cause)) throw cause
        failure = cause
      }
    }
    throw failure
  }, [scopeSessionId])

  /** 协作会话的跟随流；由本组件打开并交给协作流消费，保证发言前流已在。 */
  const [followStreamId, setFollowStreamId] = useState<string | null>(null)
  const streamRef = useRef<{ readonly sessionId: string; readonly id: string } | null>(null)
  const openingRef = useRef<{ readonly sessionId: string; readonly promise: Promise<string | null> } | null>(null)
  /** 探测计数按本轮 sentAt 记账，换一轮就重新数。 */
  const probeRef = useRef<{ readonly sentAt: number; readonly stopped: number } | null>(null)
  const tRef = useRef(t)
  tRef.current = t
  const [turn, setTurn] = useState<StudioTurnEcho | undefined>(undefined)
  const [staged, setStaged] = useState<StagedPrototype | null>(null)
  const [committedHtml, setCommittedHtml] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<readonly PrototypeSnapshotMeta[]>([])
  const [viewMode, setViewMode] = useState<StudioViewMode>('split')
  const [floatingCollapsed, setFloatingCollapsed] = useState(false)
  const [showingBefore, setShowingBefore] = useState(false)
  const [highlight, setHighlight] = useState(false)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncStatus, setSyncStatus] = useState<RequirementSyncStatus | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [turnRunning, setTurnRunning] = useState(false)
  /** 最近一次写给宿主的浮窗矩形；拖拽与折叠都以它为起点。 */
  const floatingRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  /** 一次指针拖拽的起点与目标；rAF 合并同一帧内的多次移动。 */
  const dragRef = useRef<{
    readonly pointerId: number
    readonly width: number
    readonly height: number
    readonly collapsed: boolean
    startX: number
    startY: number
    originX: number
    originY: number
    lastX: number
    lastY: number
    /** 起点坐标是否已确定；自动贴位的浮窗要先向宿主核对一次真实矩形。 */
    resolved: boolean
    pendingX: number
    pendingY: number
    moved: boolean
    frame: number | null
  } | null>(null)
  /** 拖完松手会紧跟一次 click；这一次点击不该触发折叠或展开。 */
  const suppressClickRef = useRef(false)

  const loadHtml = useCallback((html: string | null, beforeHtml: string | null): void => {
    if (html === null) return
    void bridge?.loadPrototypeStudioHtml?.({
      html,
      ...(beforeHtml === null ? {} : { beforeHtml }),
    })
  }, [bridge])

  const refreshStaged = useCallback(async (): Promise<PrototypeStagedView> => {
    const view = await withRemoteSession(sessionId => getStagedPrototype(sessionId, requirementId, invoke))
    setStaged(view.staged)
    setCommittedHtml(view.committedHtml)
    return view
  }, [invoke, requirementId, withRemoteSession])

  const refreshSnapshots = useCallback(async (): Promise<void> => {
    const items = await withRemoteSession(sessionId => listPrototypeSnapshots(sessionId, requirementId, invoke))
    setSnapshots(items)
  }, [invoke, requirementId, withRemoteSession])

  /** 把一份暂存视图画到左侧画布：有暂存就默认展示修改后版本并高亮改动区域。 */
  const showStagedView = useCallback((view: PrototypeStagedView): void => {
    const next = view.staged
    setStaged(next)
    setCommittedHtml(view.committedHtml)
    setShowingBefore(false)
    setHighlight(next !== null)
    void bridge?.highlightPrototypeStudioPaths?.(next === null ? [] : next.changedDomPaths)
    loadHtml(next === null ? view.committedHtml : next.html, view.committedHtml)
  }, [bridge, loadHtml])

  useEffect(() => {
    let disposed = false
    void Promise.all([refreshStaged(), refreshSnapshots()]).then(([view]) => {
      if (disposed) return
      showStagedView(view)
    }).catch((cause: unknown) => {
      if (!disposed) setNotice(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { disposed = true }
  }, [refreshStaged, refreshSnapshots, showStagedView])

  /** 已按哪个协作会话画过画布：换会话才重读暂存，首帧读取由挂载时的 effect 负责。 */
  const paintedChatSessionRef = useRef(chatSessionId)
  useEffect(() => {
    if (paintedChatSessionRef.current === chatSessionId) return
    paintedChatSessionRef.current = chatSessionId
    void refreshStaged().then(showStagedView).catch((cause: unknown) => {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    })
  }, [chatSessionId, refreshStaged, showStagedView])

  const changeMode = (next: StudioViewMode): void => {
    setViewMode(next)
    void bridge?.setPrototypeStudioMode?.(next)
  }

  /**
   * 把浮窗矩形写给宿主；折叠、拖拽都走这一条，避免两条路径各记一份坐标。
   * @param next - 完整矩形与折叠标记。
   */
  const applyFloating = (next: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
    readonly collapsed: boolean
  }): void => {
    floatingRef.current = { x: next.x, y: next.y, width: next.width, height: next.height }
    const applied = bridge?.setPrototypeStudioFloatingBounds?.(next)
    if (applied === undefined) return
    void applied.then((rect) => {
      // 自动贴位的矩形由宿主解析；记下真实坐标，下一次拖拽才有准确起点。
      if (rect !== undefined && (next.x < 0 || next.y < 0)) {
        floatingRef.current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
    }).catch(() => undefined)
  }

  const toggleFloating = (): void => {
    // 刚拖过的那一次 click 是拖拽的尾巴，不当作折叠/展开。
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const known = floatingRef.current
    const x = known === null ? -1 : known.x
    const y = known === null ? -1 : known.y
    if (floatingCollapsed) {
      setFloatingCollapsed(false)
      applyFloating({ x, y, ...FLOATING_EXPANDED, collapsed: false })
      return
    }
    setFloatingCollapsed(true)
    applyFloating({ x, y, ...FLOATING_COLLAPSED, collapsed: true })
  }

  /**
   * 按下浮窗顶栏或折叠胶囊，开始一次指针拖拽。
   * 用指针坐标换算窗口位置并交给宿主 setFloatingBounds：不设 app-region，画布拖拽命中层不受影响。
   * @param event - 指针按下事件。
   * @param collapsed - 起点是折叠胶囊还是展开浮窗。
   */
  const beginFloatingDrag = (event: ReactPointerEvent<HTMLElement>, collapsed: boolean): void => {
    if (viewMode !== 'fullscreen-pinned' || event.button !== 0) return
    const target = event.target
    if (target instanceof Element) {
      const button = target.closest('button')
      // 顶栏里的按钮自己响应点击；胶囊本身就是按钮，按在它上面照样算拖拽。
      if (button !== null && button !== event.currentTarget) return
    }
    suppressClickRef.current = false
    const known = floatingRef.current
    const size = collapsed ? FLOATING_COLLAPSED : (known ?? FLOATING_EXPANDED)
    const resolved = known !== null && known.x >= 0 && known.y >= 0
    // 视图自己不知道在工作室窗口里的位置：自动贴位时先按可视宽度估一个，再向宿主核对真实矩形。
    const originX = resolved ? known.x : Math.max(0, window.innerWidth - size.width - FLOATING_MARGIN)
    const originY = resolved ? known.y : FLOATING_MARGIN
    const drag = {
      pointerId: event.pointerId,
      width: size.width,
      height: size.height,
      collapsed,
      startX: event.screenX,
      startY: event.screenY,
      originX,
      originY,
      lastX: event.screenX,
      lastY: event.screenY,
      resolved,
      pendingX: originX,
      pendingY: originY,
      moved: false,
      frame: null,
    }
    dragRef.current = drag
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 合成指针或没有指针捕获的环境：仍按元素上收到的移动量继续拖。
    }
    if (drag.resolved) return
    const applied = bridge?.setPrototypeStudioFloatingBounds?.({ x: -1, y: -1, ...size, collapsed })
    if (applied === undefined) {
      drag.resolved = true
      return
    }
    void applied.then((rect) => {
      if (dragRef.current !== drag) return
      if (rect !== undefined) {
        drag.originX = rect.x
        drag.originY = rect.y
        // 用最近一次指针位置当新起点：核对期间发生的位移不会被重复计入。
        drag.startX = drag.lastX
        drag.startY = drag.lastY
        drag.pendingX = rect.x
        drag.pendingY = rect.y
        floatingRef.current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
      drag.resolved = true
    }).catch(() => { drag.resolved = true })
  }

  const moveFloatingDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    drag.lastX = event.screenX
    drag.lastY = event.screenY
    if (!drag.moved && Math.abs(event.screenX - drag.startX) + Math.abs(event.screenY - drag.startY) > 3) {
      drag.moved = true
    }
    if (!drag.resolved) return
    drag.pendingX = drag.originX + (event.screenX - drag.startX)
    drag.pendingY = drag.originY + (event.screenY - drag.startY)
    if (drag.frame !== null) return
    drag.frame = window.requestAnimationFrame(() => {
      drag.frame = null
      if (dragRef.current !== drag) return
      applyFloating({
        x: Math.round(drag.pendingX),
        y: Math.round(drag.pendingY),
        width: drag.width,
        height: drag.height,
        collapsed: drag.collapsed,
      })
    })
  }

  const endFloatingDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (drag.frame !== null) window.cancelAnimationFrame(drag.frame)
    if (drag.moved) {
      suppressClickRef.current = true
      applyFloating({
        x: Math.round(drag.pendingX),
        y: Math.round(drag.pendingY),
        width: drag.width,
        height: drag.height,
        collapsed: drag.collapsed,
      })
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // 没有指针捕获时无需释放。
    }
  }

  const switchView = (before: boolean): void => {
    setShowingBefore(before)
    loadHtml(before ? committedHtml : staged?.html ?? null, committedHtml)
  }

  const compareSideBySide = (): void => {
    changeMode('compare-side-by-side')
    loadHtml(staged?.html ?? committedHtml, committedHtml)
  }

  const toggleHighlight = (): void => {
    const next = !highlight
    setHighlight(next)
    void bridge?.highlightPrototypeStudioPaths?.(next && staged !== null ? staged.changedDomPaths : [])
  }

  const commit = async (applyRequirementDiff: boolean, amend: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    try {
      const result: PrototypeCommitResult = await withRemoteSession(sessionId => commitStagedPrototype({
        sessionId,
        requirementId,
        ...(applyRequirementDiff ? { applyRequirementDiff: true } : {}),
        ...(amend ? { requirementAmendMode: 'amend' as const } : {}),
      }, invoke))
      setSyncStatus(result.requirementSync)
      const view = await refreshStaged()
      await refreshSnapshots()
      setShowingBefore(false)
      setHighlight(false)
      void bridge?.highlightPrototypeStudioPaths?.([])
      loadHtml(view.committedHtml, view.committedHtml)
      setNotice(result.requirementSync === 'skipped_pending'
        ? t('studio.syncSkippedPending')
        : t('studio.commitDone', { sync: t(syncKey(result.requirementSync)) }))
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const discard = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    try {
      await withRemoteSession(sessionId => discardStagedPrototype(sessionId, requirementId, invoke))
      const view = await refreshStaged()
      setShowingBefore(false)
      setHighlight(false)
      void bridge?.highlightPrototypeStudioPaths?.([])
      loadHtml(view.committedHtml, view.committedHtml)
      setNotice(t('studio.discardDone'))
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (snapshotId: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    try {
      const restored = await withRemoteSession(sessionId =>
        restorePrototypeSnapshot(sessionId, requirementId, snapshotId, invoke))
      await Promise.all([refreshStaged(), refreshSnapshots()])
      loadHtml(restored.html, restored.html)
      setNotice(t('studio.restoreDone'))
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 取协作会话号：本需求上次用过就沿用，没有就新建一个 maniu-prototype 会话。
   * @returns 会话号；建会话失败时返回 null 并已在界面上报错。
   */
  const ensureChatSession = useCallback(async (): Promise<string | null> => {
    const existing = chatSessionIdRef.current
    if (existing !== null) return existing
    const workspaceId = (() => {
      try {
        const raw = localStorage.getItem(PROJECT_KEY)
        const value: unknown = raw === null ? undefined : JSON.parse(raw)
        return isRecord(value) && typeof value.workspaceId === 'string' ? value.workspaceId : undefined
      } catch {
        return undefined
      }
    })()
    const created = await invoke('session', 'create', {
      request: {
        ...(workspaceId === undefined ? {} : { workspaceId }),
        agentPreset: 'maniu-prototype',
      },
    })
    if (!created.ok) {
      setNotice(`${created.error.code}: ${created.error.message}`)
      return null
    }
    const value: unknown = created.value
    if (!isRecord(value) || typeof value.sessionId !== 'string') {
      setNotice(tRef.current('studio.sessionCreateFailed'))
      return null
    }
    const sid = value.sessionId
    chatSessionIdRef.current = sid
    setChatSessionId(sid)
    try {
      localStorage.setItem(`lcoder.studio.session.${requirementId}`, sid)
    } catch {
      // 会话已在内存里生效；存储失败不影响本轮发送。
    }
    return sid
  }, [invoke, requirementId])

  /**
   * 为协作会话打开跟随流；同一会话复用同一条流，换会话时先撤旧的。
   * @param sid - 协作会话号。
   * @returns 流标识；宿主没有开流能力时返回 null。
   */
  const openFollowStream = useCallback(async (sid: string): Promise<string | null> => {
    const opened = streamRef.current
    if (opened !== null && opened.sessionId === sid) return opened.id
    const opening = openingRef.current
    if (opening !== null && opening.sessionId === sid) return opening.promise
    const openStream = bridge?.openStream
    if (openStream === undefined) return null
    if (opened !== null) {
      streamRef.current = null
      setFollowStreamId(null)
      void bridge?.cancelStream?.(opened.id)
    }
    const promise = openStream('session', 'follow', {
      request: {
        address: { kind: 'session', sessionId: sid },
        // 本轮由用户主动发起：请求后台激活，宿主不会因为窗口没人看就缓起这一轮。
        activate: true,
        assistantStream: true,
        maxMessages: 20,
      },
    }).then((id) => {
      streamRef.current = { sessionId: sid, id }
      setFollowStreamId(id)
      return id
    }).catch(() => null)
    openingRef.current = { sessionId: sid, promise }
    void promise.finally(() => {
      if (openingRef.current?.promise === promise) openingRef.current = null
    })
    return promise
  }, [bridge])

  // 进入即跟随已有会话：历史回合能回显，实时进度也不用等下一次发送。
  useEffect(() => {
    if (chatSessionId === null) return
    void openFollowStream(chatSessionId)
  }, [chatSessionId, openFollowStream])

  useEffect(() => () => {
    const opened = streamRef.current
    streamRef.current = null
    if (opened !== null) void bridge?.cancelStream?.(opened.id)
  }, [bridge])

  /**
   * 等待期探测：暂存比本轮新、或会话连续两次报告已停止，就当作这一轮结束。
   * 事件通道偶发漏帧时靠它退出等待，不再永久卡在「正在调整原型」。
   * @param sentAt - 本轮发出时刻。
   * @returns 是否可以结束本轮等待。
   */
  const probeTurnComplete = useCallback(async (sentAt: number): Promise<boolean> => {
    const previous = probeRef.current
    let stopped = previous !== null && previous.sentAt === sentAt ? previous.stopped : 0
    try {
      const view = await withRemoteSession(sessionId => getStagedPrototype(sessionId, requirementId, invoke))
      setStaged(view.staged)
      setCommittedHtml(view.committedHtml)
      if (view.staged !== null) {
        const created = Date.parse(view.staged.createdAt)
        if (Number.isFinite(created) && created > sentAt) {
          probeRef.current = null
          return true
        }
      }
    } catch {
      // 单次探测失败不改变等待：事件通道与回合结束帧仍是权威信号。
    }
    const sid = chatSessionIdRef.current
    if (sid === null) return false
    try {
      const listed = await invoke('session', 'list', { _request: {} })
      const value: unknown = listed.ok ? listed.value : undefined
      if (isRecord(value) && Array.isArray(value.items)) {
        const items: readonly unknown[] = value.items
        const found = items.find(item => isRecord(item) && item.sessionId === sid)
        stopped = isRecord(found) && found.running === false ? stopped + 1 : 0
      }
    } catch {
      // 同上：探测失败不提前结束等待。
    }
    probeRef.current = { sentAt, stopped }
    return stopped >= STOPPED_PROBES_BEFORE_COMPLETE
  }, [invoke, requirementId, withRemoteSession])

  const sendCoDesign = async (instruction: string, anchors: readonly StudioAnchorDraft[]): Promise<boolean> => {
    const prompt = buildStudioCoDesignPrompt({
      requirementId,
      requirementTitle: requirementId,
      baselineNote: staged === null ? t('studio.baselineCommitted') : t('studio.baselineStaged'),
      instruction,
      anchors,
    })
    // 顺序固定：先拿到会话号，再确保跟随流已打开，再回显本轮，最后才发消息。
    // 反过来的话宿主会在流打开前就报 running=true，界面收不到那次回执，永远等不到结束。
    const sid = await ensureChatSession()
    if (sid === null) return false
    await openFollowStream(sid)
    setNotice(undefined)
    setTurn({ instruction, anchors, sentAt: Date.now() })
    const accepted = await invoke('session', 'prompt', {
      request: { requestId: requestId(), sessionId: sid, mode: 'queue', content: [{ type: 'text', text: prompt }] },
    })
    if (!accepted.ok) {
      setNotice(`${accepted.error.code}: ${accepted.error.message}`)
      // 没被接受就不该留在等待态；清掉本轮回显让发送入口立即恢复。
      setTurn(undefined)
      return false
    }
    return true
  }

  /** 回合结束后重读暂存：有暂存就立刻切到修改后、高亮本轮改动；没有就回到正式版。 */
  const refreshAfterTurn = useCallback((): void => {
    void refreshStaged().then(showStagedView).catch((cause: unknown) => {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    })
  }, [refreshStaged, showStagedView])

  const isFullscreen = viewMode === 'fullscreen-pinned'
  const modeLabel = isFullscreen ? t('studio.exitFullscreen') : t('studio.enterFullscreen')
  const quickCompareLabel = staged === null
    ? t('studio.quickCompareUnavailable')
    : t(showingBefore ? 'studio.quickCompareToAfter' : 'studio.quickCompareToBefore')

  return (
    <div className={`studio-app${isFullscreen ? ' studio-app-pinned' : ''}`} data-testid="studio-app" data-requirement-id={requirementId}>
      {isFullscreen && floatingCollapsed && (
        <button
          type="button"
          className="studio-floating studio-floating-collapsed"
          data-testid="studio-floating-collapse"
          aria-expanded={false}
          onClick={toggleFloating}
          onPointerDown={(event) => { beginFloatingDrag(event, true) }}
          onPointerMove={moveFloatingDrag}
          onPointerUp={endFloatingDrag}
          onPointerCancel={endFloatingDrag}
        >
          {t('studio.expandCapsule', { id: requirementId })}
        </button>
      )}
      <div className="studio-body" data-testid="studio-body" hidden={isFullscreen && floatingCollapsed}>
        <header
          className={isFullscreen ? 'studio-head studio-head-draggable' : 'studio-head'}
          data-testid="studio-head"
          onPointerDown={(event) => { beginFloatingDrag(event, false) }}
          onPointerMove={moveFloatingDrag}
          onPointerUp={endFloatingDrag}
          onPointerCancel={endFloatingDrag}
        >
          <span className="studio-title" data-testid="studio-title">{t('studio.title', { id: requirementId })}</span>
          <div className="studio-head-actions" data-testid="studio-head-actions">
            {isFullscreen && (
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className="studio-icon-button"
                data-testid="studio-floating-collapse"
                aria-expanded
                aria-label={t('studio.collapsePanel')}
                ref={(node) => { if (node !== null) node.title = t('studio.collapsePanel') }}
                onPress={toggleFloating}
              >
                <PanelRightClose aria-hidden="true" size={16} />
              </Button>
            )}
            <Button
              isIconOnly
              size="sm"
              variant={showingBefore ? 'primary' : 'ghost'}
              className={showingBefore ? 'studio-icon-button studio-icon-button-active' : 'studio-icon-button'}
              data-testid="studio-quick-compare"
              data-active={showingBefore ? 'true' : 'false'}
              aria-label={quickCompareLabel}
              aria-pressed={showingBefore}
              isDisabled={staged === null}
              ref={(node) => { if (node !== null) node.title = quickCompareLabel }}
              onPress={() => { switchView(!showingBefore) }}
            >
              <GitCompareArrows aria-hidden="true" size={16} />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="studio-icon-button"
              data-testid="studio-snapshots-trigger"
              aria-expanded={snapshotsOpen}
              aria-label={t('studio.snapshots')}
              ref={(node) => { if (node !== null) node.title = t('studio.snapshots') }}
              onPress={() => { setSnapshotsOpen(current => !current) }}
            >
              <History aria-hidden="true" size={16} />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="studio-icon-button"
              data-testid="studio-mode-toggle"
              data-mode={viewMode}
              aria-label={modeLabel}
              ref={(node) => { if (node !== null) node.title = modeLabel }}
              onPress={() => { changeMode(isFullscreen ? 'split' : 'fullscreen-pinned') }}
            >
              {isFullscreen ? <Minimize2 aria-hidden="true" size={16} /> : <Maximize2 aria-hidden="true" size={16} />}
            </Button>
          </div>
        </header>

        {staged !== null && (
          <div className="studio-staged-bar" data-testid="studio-staged-bar" data-staged="true">
            <span className="studio-staged-live" data-testid="studio-staged-state">
              {t('studio.stagedPending')}
            </span>
            <div className="studio-segmented" role="group" aria-label={t('studio.viewSwitch')}>
              <button
                type="button"
                className={showingBefore ? 'studio-segment studio-segment-on' : 'studio-segment'}
                data-testid="studio-view-before"
                aria-pressed={showingBefore}
                onClick={() => { switchView(true) }}
              >
                {t('studio.viewBefore')}
              </button>
              <button
                type="button"
                className={!showingBefore ? 'studio-segment studio-segment-on' : 'studio-segment'}
                data-testid="studio-view-after"
                aria-pressed={!showingBefore}
                onClick={() => { switchView(false) }}
              >
                {t('studio.viewAfter')}
              </button>
            </div>
            <Button size="sm" variant="secondary" data-testid="studio-compare-side-by-side" isDisabled={busy} onPress={compareSideBySide}>
              {t('studio.compareSideBySide')}
            </Button>
            <Button size="sm" variant={highlight ? 'primary' : 'secondary'} data-testid="studio-highlight-toggle" isDisabled={busy} onPress={toggleHighlight}>
              {t('studio.highlightChanges')}
            </Button>
            <Button size="sm" variant="primary" data-testid="studio-commit-staged" isDisabled={busy} onPress={() => { void commit(false, false) }}>
              {t('studio.confirmCommit')}
            </Button>
            <Button size="sm" variant="secondary" data-testid="studio-discard-staged" isDisabled={busy} onPress={() => { void discard() }}>
              {t('studio.discard')}
            </Button>
          </div>
        )}

        {snapshotsOpen && (
          <div className="studio-snapshots" data-testid="studio-snapshots">
            {snapshots.length === 0
              ? <p className="studio-empty">{t('studio.snapshotsEmpty')}</p>
              : snapshots.slice(0, 10).map(snapshot => (
                <div key={snapshot.snapshotId} className="studio-snapshot" data-testid="studio-snapshot" data-snapshot-id={snapshot.snapshotId}>
                  <span>{formatTimestamp(snapshot.createdAt)}</span>
                  <span>{t('studio.snapshotBytes', { bytes: snapshot.bytes })}</span>
                  <Button size="sm" variant="secondary" data-testid="studio-snapshot-restore" isDisabled={busy} onPress={() => { void restore(snapshot.snapshotId) }}>
                    {t('studio.restoreSnapshot')}
                  </Button>
                </div>
              ))}
          </div>
        )}

        <CoDesignThread
          t={t}
          bridge={bridge}
          sessionId={chatSessionId}
          streamId={followStreamId}
          turn={turn}
          onStageComplete={refreshAfterTurn}
          onRunningChange={setTurnRunning}
          onProbeComplete={probeTurnComplete}
          changeCard={staged === null
            ? undefined
            : (
              <ChangeCard
                t={t}
                staged={staged}
                busy={busy}
                syncStatus={syncStatus}
                showingBefore={showingBefore}
                onViewChange={switchView}
                onCompare={compareSideBySide}
                onCommit={(applyDiff, amend) => { void commit(applyDiff, amend) }}
                onDiscard={() => { void discard() }}
              />
            )}
        />
        <AnchorComposer t={t} bridge={bridge} running={turnRunning || busy} onSend={sendCoDesign} />

        {notice !== undefined && <p className="studio-notice" data-testid="studio-notice">{notice}</p>}
      </div>
    </div>
  )
}
