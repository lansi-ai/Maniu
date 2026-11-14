/** 全屏 Markdown 阅读器：文档字节经宿主文件面读取。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react'
import { renderMarkdown } from '../markdown/markdown.tsx'

const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10
const ZOOM_BASE = 100
const DOC_LINES = 5000

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly text: string }
  | { readonly status: 'failed'; readonly text: string }

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
}

/** 阅读器属性。 */
export interface ReaderOverlayProps {
  readonly scopeSessionId: string
  /** 仓库相对路径。 */
  readonly path: string
  readonly onClose: () => void
}

interface DragOrigin {
  readonly pointerId: number
  readonly x: number
  readonly y: number
  readonly left: number
  readonly top: number
}

/**
 * 画全屏阅读层。
 * @param props - 作用域会话、文档路径与关闭回调。
 * @returns 阅读层。
 */
export function ReaderOverlay(props: ReaderOverlayProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [zoom, setZoom] = useState(ZOOM_BASE)
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragOrigin | undefined>(undefined)

  useEffect(() => {
    let disposed = false
    setLoaded({ status: 'loading' })
    void window.lcoder.call('workspaceFiles', 'read', {
      workspaceFileScopeId: props.scopeSessionId,
      path: props.path,
      range: { offset: 1, limit: DOC_LINES },
    }).then((answer) => {
      if (disposed) return
      if (!answer.ok) {
        setLoaded({ status: 'failed', text: `${answer.error.code}: ${answer.error.message}` })
        return
      }
      const value = answer.value
      const text = typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string'
        ? value.text
        : ''
      setLoaded({ status: 'ready', text })
    }).catch((cause: unknown) => {
      if (disposed) return
      setLoaded({ status: 'failed', text: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => { disposed = true }
  }, [props.path, props.scopeSessionId])

  const zoomBy = useCallback((delta: number): void => { setZoom(current => clampZoom(current + delta)) }, [])
  const resetZoom = useCallback((): void => { setZoom(ZOOM_BASE) }, [])

  useEffect(() => { rootRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      switch (event.key) {
        case 'Escape': event.stopPropagation(); props.onClose(); break
        case '+':
        case '=': zoomBy(ZOOM_STEP); break
        case '-':
        case '_': zoomBy(-ZOOM_STEP); break
        case '0': resetZoom(); break
        default: return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [props, resetZoom, zoomBy])

  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [zoomBy])

  useEffect(() => {
    if (zoom > ZOOM_BASE) return
    dragRef.current = undefined
    setDragging(false)
  }, [zoom])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = scrollRef.current
    if (zoom <= ZOOM_BASE || event.button !== 0 || !event.isPrimary || element === null) return
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    const element = scrollRef.current
    if (current === undefined || element === null || current.pointerId !== event.pointerId) return
    element.scrollLeft = current.left - (event.clientX - current.x)
    element.scrollTop = current.top - (event.clientY - current.y)
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = undefined
    setDragging(false)
  }

  return (
    <div className="reader-layer" data-testid="markdown-reader" data-reader-path={props.path} data-reader-status={loaded.status}>
      <div className="reader-panel lg-glass" role="dialog" aria-modal="true" aria-label={props.path} tabIndex={-1} ref={rootRef}>
        <div className="reader-bar">
          <div className="reader-head">
            <h3 data-testid="reader-path">{props.path}</h3>
            <p>Esc 关闭 · +/− 缩放 · Ctrl+滚轮缩放 · 放大后可拖动平移</p>
          </div>
          <div className="reader-tools">
            <button type="button" className="pill" aria-label="缩小" disabled={zoom <= ZOOM_MIN} onClick={() => { zoomBy(-ZOOM_STEP) }}>−</button>
            <span data-testid="reader-zoom">{`${String(zoom)}%`}</span>
            <button type="button" className="pill" aria-label="放大" disabled={zoom >= ZOOM_MAX} onClick={() => { zoomBy(ZOOM_STEP) }}>+</button>
            <button type="button" className="pill" onClick={resetZoom}>重置</button>
            <button type="button" className="pill pill-accent" data-testid="reader-close" onClick={props.onClose}>关闭</button>
          </div>
        </div>
        <div
          ref={scrollRef}
          className="reader-scroll"
          data-dragging={dragging ? '' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          {loaded.status === 'loading' && <p className="empty" data-testid="reader-loading">正在读取文档…</p>}
          {loaded.status === 'failed' && <pre className="problem" data-testid="reader-failed">{loaded.text}</pre>}
          {loaded.status === 'ready' && loaded.text.trim() === '' && <p className="empty" data-testid="reader-empty">文档为空。</p>}
          {loaded.status === 'ready' && loaded.text.trim() !== '' && (
            <article
              className="reader-doc"
              data-testid="reader-doc"
              style={{ '--reader-zoom': zoom / ZOOM_BASE } as CSSProperties}
            >
              {renderMarkdown(loaded.text)}
            </article>
          )}
        </div>
      </div>
    </div>
  )
}
