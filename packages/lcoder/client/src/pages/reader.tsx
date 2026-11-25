/** 全屏 Markdown 阅读器：文档字节经宿主文件面读取。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@heroui/react'
import { X } from 'lucide-react'
import { readWorkspaceText, WORKSPACE_READ_LINES } from '../spec/files.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import { DocViewControls, useDocViewPrefs } from '../markdown/document-viewer.tsx'
import { usePreferences } from '../prefs.ts'
import { translate, type Translate } from '../locale.ts'

const DOC_LINES = WORKSPACE_READ_LINES

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly text: string }
  | { readonly status: 'failed'; readonly text: string }

/** 阅读器属性。 */
export interface ReaderOverlayProps {
  readonly scopeSessionId: string
  /** 仓库相对路径。 */
  readonly path: string
  readonly onClose: () => void
}

/**
 * 画全屏阅读层。
 * @param props - 作用域会话、文档路径与关闭回调。
 * @returns 阅读层。
 */
export function ReaderOverlay(props: ReaderOverlayProps): JSX.Element {
  const { locale } = usePreferences()
  const t: Translate = useCallback((key, params) => translate(locale, key, params), [locale])
  const { layout, fontSize, setLayout, stepFontSize, resetFontSize } = useDocViewPrefs()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    setLoaded({ status: 'loading' })
    void readWorkspaceText(props.scopeSessionId, props.path, DOC_LINES)
      .then((answer) => {
        if (disposed) return
        setLoaded(answer.ok
          ? { status: 'ready', text: answer.text }
          : { status: 'failed', text: `${answer.error.code}: ${answer.error.message}` })
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setLoaded({ status: 'failed', text: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => { disposed = true }
  }, [props.path, props.scopeSessionId])

  useEffect(() => { rootRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 说明栏等输入框聚焦时不接管字号键；Esc 仍由最上层容器处理。
      const target = event.target
      const typing = target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      switch (event.key) {
        case 'Escape': event.stopPropagation(); props.onClose(); break
        case '+':
        case '=': if (typing) return; stepFontSize(1); break
        case '-':
        case '_': if (typing) return; stepFontSize(-1); break
        case '0': if (typing) return; resetFontSize(); break
        default: return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [props, resetFontSize, stepFontSize])

  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      stepFontSize(event.deltaY < 0 ? 1 : -1)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [stepFontSize])

  return createPortal(
    <div
      className="requirement-doc-fullscreen-layer"
      data-testid="markdown-reader"
      data-reader-path={props.path}
      data-reader-status={loaded.status}
      role="dialog"
      aria-modal="true"
      aria-label={props.path}
      tabIndex={-1}
      ref={rootRef}
    >
      <header className="requirement-doc-fullscreen-bar">
        <div className="requirement-doc-fullscreen-title">
          <strong data-testid="reader-path">{props.path}</strong>
        </div>
        <div className="requirement-doc-controls">
          <DocViewControls
            layout={layout}
            fontSize={fontSize}
            onLayoutChange={setLayout}
            onStepFont={stepFontSize}
            t={t}
            allowFullscreen={false}
            testIdPrefix="reader-doc"
          />
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            data-testid="reader-close"
            aria-label={t('compare.close')}
            ref={(node) => { if (node !== null) node.title = t('compare.close') }}
            onPress={props.onClose}
          >
            <X size={15} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div ref={scrollRef} className="requirement-doc-fullscreen-scroll">
        {loaded.status === 'loading' && <p className="empty" data-testid="reader-loading">正在读取文档…</p>}
        {loaded.status === 'failed' && <pre className="problem" data-testid="reader-failed">{loaded.text}</pre>}
        {loaded.status === 'ready' && loaded.text.trim() === '' && <p className="empty" data-testid="reader-empty">文档为空。</p>}
        {loaded.status === 'ready' && loaded.text.trim() !== '' && (
          <article
            className="markdown-body document-body reader-doc"
            data-testid="reader-doc"
            data-doc-layout={layout}
            data-doc-font-size={fontSize}
            style={{ fontSize: `${String(fontSize)}px` }}
          >
            {renderMarkdown(loaded.text)}
          </article>
        )}
      </div>
    </div>,
    document.body,
  )
}
