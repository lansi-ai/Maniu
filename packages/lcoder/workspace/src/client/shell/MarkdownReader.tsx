/**
 * 全屏 Markdown 阅读器：交付物文档与需求文档共用这一层。
 *
 * 只排版与处理阅读手势：正文由调用方按仓库相对路径读出后原样传入，
 * 阅读器不改正文，也不猜路径。缩放只作用于正文排版（50%–200%，步进 10%），
 * 放大后按住拖动平移视口，普通滚轮仍是滚动；Esc 关闭。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useMarkdownLabels } from './ChatPanel.tsx'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/**
 * 阅读器的一份文档：路径是仓库相对路径；`loading` 时正文为空，
 * `failed` 时正文是读盘原话，`ready` 时是文档原文。
 */
export interface MarkdownReaderDoc {
  readonly path: string
  readonly status: 'loading' | 'ready' | 'failed'
  readonly text: string
}

/** 阅读器的 props。 */
export interface MarkdownReaderProps {
  readonly t: Translate
  readonly doc: MarkdownReaderDoc
  readonly onClose: () => void
}

const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10
const ZOOM_BASE = 100

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
}

/**
 * 画全屏阅读层。
 * @param props - 词典、文档读取状态与关闭回调。
 * @returns 盖住内容区的阅读层；由外壳在打开文档时挂载。
 */
export function MarkdownReader({ t, doc, onClose }: MarkdownReaderProps): ReactNode {
  const labels = useMarkdownLabels(t)
  const [zoom, setZoom] = useState(ZOOM_BASE)
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    readonly pointerId: number
    readonly x: number
    readonly y: number
    readonly left: number
    readonly top: number
  } | undefined>(undefined)

  const zoomBy = useCallback((delta: number): void => {
    setZoom(current => clampZoom(current + delta))
  }, [])
  const resetZoom = useCallback((): void => {
    setZoom(ZOOM_BASE)
  }, [])

  // 打开即把焦点放到阅读层：之后的 +/−/0/Esc 都由这一层接管。
  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      switch (event.key) {
        case 'Escape':
          // 停在阅读层：底下的需求抽屉等 Esc 处理器不该连带关闭。
          event.stopPropagation()
          onClose()
          break
        case '+':
        case '=':
          zoomBy(ZOOM_STEP)
          break
        case '-':
        case '_':
          zoomBy(-ZOOM_STEP)
          break
        case '0':
          resetZoom()
          break
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onClose, resetZoom, zoomBy])

  // Ctrl/Cmd + 滚轮缩放需要非被动监听才能拦住浏览器缩放；普通滚轮不接管。
  useEffect(() => {
    const element = scrollRef.current
    /* v8 ignore next -- 阅读层挂载后视口 ref 已赋值；这一支只为类型收窄 */
    if (element === null) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [zoomBy])

  // 缩回 100% 时收掉进行中的拖动，光标与“不拖”的承诺一起回到静止态。
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
    if (typeof element.setPointerCapture === 'function') {
      try {
        element.setPointerCapture(event.pointerId)
      } catch (error: unknown) {
        // jsdom 与部分宿主没有真实指针序列；捕获失败不影响坐标换算。
        console.error('LCoder markdown reader: pointer capture unavailable', error)
      }
    }
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

  const body = doc.text.trim()

  return (
    <div className={css.readerLayer} data-markdown-reader data-reader-path={doc.path} data-reader-status={doc.status}>
      <div
        ref={rootRef}
        className={css.readerPanel}
        role="dialog"
        aria-modal="true"
        aria-label={doc.path}
        tabIndex={-1}
      >
        <div className={css.readerBar}>
          <div className={css.readerHead}>
            <h3 className={css.readerPath} data-reader-path-text>{doc.path}</h3>
            <p className={css.readerHint}>{t('shell.readerHint')}</p>
          </div>
          <div className={css.readerTools}>
            <button
              type="button"
              className={css.readerStep}
              aria-label={t('shell.readerZoomOut')}
              data-reader-zoom-out
              disabled={zoom <= ZOOM_MIN}
              onClick={() => { zoomBy(-ZOOM_STEP) }}
            >−</button>
            <span className={css.readerZoom} data-reader-zoom>{`${String(zoom)}%`}</span>
            <button
              type="button"
              className={css.readerStep}
              aria-label={t('shell.readerZoomIn')}
              data-reader-zoom-in
              disabled={zoom >= ZOOM_MAX}
              onClick={() => { zoomBy(ZOOM_STEP) }}
            >+</button>
            <button
              type="button"
              className={css.readerReset}
              aria-label={t('shell.readerZoomReset')}
              data-reader-zoom-reset
              onClick={resetZoom}
            >{t('shell.readerReset')}</button>
            <button
              type="button"
              className={css.iconBtn}
              aria-label={t('shell.close')}
              data-reader-close
              onClick={onClose}
            >✕</button>
          </div>
        </div>
        <div
          ref={scrollRef}
          className={css.readerScroll}
          data-reader-scroll
          data-zoomable={zoom > ZOOM_BASE ? '' : undefined}
          data-dragging={dragging ? '' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          {doc.status === 'loading' ? (
            <p className={css.readerState} data-reader-loading>{t('shell.deliverableDocLoading')}</p>
          ) : null}
          {doc.status === 'failed' ? (
            <p className={`${css.readerState} ${css.problem}`} data-reader-failed>{doc.text}</p>
          ) : null}
          {doc.status === 'ready' && body === '' ? (
            <p className={css.readerState} data-reader-empty>{t('shell.readerEmpty')}</p>
          ) : null}
          {doc.status === 'ready' && body !== '' ? (
            <article
              className={css.readerDoc}
              data-reader-doc
              style={{ '--lc-reader-zoom': zoom / ZOOM_BASE } as CSSProperties}
            >
              <MarkdownText text={doc.text} labels={labels} omitHtml />
            </article>
          ) : null}
        </div>
      </div>
    </div>
  )
}
