/**
 * 统一 Markdown 文档阅读器：提供「页面居中 / Web 宽屏」版式、字号调节与全屏预览，
 * 并通过 localStorage 与窗口自定义事件在多个阅读器间同步阅读偏好。
 */

import { useCallback, useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@heroui/react'
import { FileText, Maximize2, Minimize2, Minus, Plus, StretchHorizontal, X } from 'lucide-react'
import { translate, type Translate } from '../locale.ts'
import { renderMarkdown } from './markdown.tsx'

/** 文档阅读版式：Word 页面居中或 Web 宽屏。 */
export type DocLayout = 'page' | 'web'

/** 持久化版式偏好的 localStorage 键。 */
export const DOC_LAYOUT_KEY = 'lcoder.requirement.docLayout'

/** 持久化字号偏好的 localStorage 键。 */
export const DOC_FONT_KEY = 'lcoder.requirement.docFontSize'

/** 默认正文字号（px）。 */
export const DOC_FONT_DEFAULT = 15

/** 最小正文字号（px）。 */
export const DOC_FONT_MIN = 12

/** 最大正文字号（px）。 */
export const DOC_FONT_MAX = 22

const DOC_PREFS_EVENT = 'lcoder:doc-prefs'
const zhText: Translate = (key, params) => translate('zh', key, params)

function readDocLayout(): DocLayout {
  try {
    return localStorage.getItem(DOC_LAYOUT_KEY) === 'web' ? 'web' : 'page'
  } catch {
    return 'page'
  }
}

function clampFontSize(value: number): number {
  return Math.min(DOC_FONT_MAX, Math.max(DOC_FONT_MIN, Math.round(value)))
}

function readDocFontSize(): number {
  try {
    const raw = Number(localStorage.getItem(DOC_FONT_KEY))
    if (Number.isFinite(raw) && raw >= DOC_FONT_MIN && raw <= DOC_FONT_MAX) return Math.round(raw)
  } catch {
    // 忽略读取异常，回落默认字号。
  }
  return DOC_FONT_DEFAULT
}

function notifyDocPrefs(): void {
  window.dispatchEvent(new Event(DOC_PREFS_EVENT))
}

/** 共享阅读偏好状态与更新动作。 */
export interface DocViewPrefs {
  readonly layout: DocLayout
  readonly fontSize: number
  readonly setLayout: (next: DocLayout) => void
  readonly stepFontSize: (delta: number) => void
  readonly resetFontSize: () => void
}

/**
 * 读取并同步文档阅读偏好（页面居中/Web 宽屏与字号）。
 * @returns 当前偏好及持久化更新方法。
 */
export function useDocViewPrefs(): DocViewPrefs {
  const [layout, setLayoutState] = useState<DocLayout>(readDocLayout)
  const [fontSize, setFontSizeState] = useState<number>(readDocFontSize)

  useEffect(() => {
    const sync = (): void => {
      setLayoutState(readDocLayout())
      setFontSizeState(readDocFontSize())
    }
    window.addEventListener(DOC_PREFS_EVENT, sync)
    return () => { window.removeEventListener(DOC_PREFS_EVENT, sync) }
  }, [])

  const setLayout = useCallback((next: DocLayout): void => {
    setLayoutState(next)
    try {
      localStorage.setItem(DOC_LAYOUT_KEY, next)
    } catch {
      // 忽略本地存储写入失败，当前会话仍可即时切换。
    }
    notifyDocPrefs()
  }, [])

  const stepFontSize = useCallback((delta: number): void => {
    const next = clampFontSize(readDocFontSize() + delta)
    try {
      localStorage.setItem(DOC_FONT_KEY, String(next))
    } catch {
      // 忽略本地存储写入失败，当前会话仍可即时调节字号。
    }
    setFontSizeState(next)
    notifyDocPrefs()
  }, [])

  const resetFontSize = useCallback((): void => {
    setFontSizeState(DOC_FONT_DEFAULT)
    try {
      localStorage.setItem(DOC_FONT_KEY, String(DOC_FONT_DEFAULT))
    } catch {
      // 忽略本地存储写入失败。
    }
    notifyDocPrefs()
  }, [])

  return { layout, fontSize, setLayout, stepFontSize, resetFontSize }
}

/** 文档阅读控制栏属性。 */
export interface DocViewControlsProps {
  readonly layout: DocLayout
  readonly fontSize: number
  readonly onLayoutChange: (next: DocLayout) => void
  readonly onStepFont: (delta: number) => void
  readonly t?: Translate | undefined
  /** 窄容器模式：仅展示字号与全屏，隐藏版式切换。 */
  readonly compact?: boolean | undefined
  readonly fullscreen?: boolean | undefined
  readonly allowFullscreen?: boolean | undefined
  readonly onToggleFullscreen?: (() => void) | undefined
  /** data-testid 前缀；默认 `doc`。 */
  readonly testIdPrefix?: string | undefined
}

/**
 * 渲染统一文档阅读控制条（页面居中/Web 宽屏、字号调节、全屏切换）。
 * @param props - 当前版式、字号、回调与 testid 前缀。
 * @returns 控制条节点。
 */
export function DocViewControls(props: DocViewControlsProps): JSX.Element {
  const t = props.t ?? zhText
  const prefix = props.testIdPrefix ?? 'doc'
  const fullscreen = props.fullscreen === true
  const allowFullscreen = props.allowFullscreen !== false && props.onToggleFullscreen !== undefined
  const scope = fullscreen ? `${prefix}-fullscreen` : prefix

  return (
    <div className="requirement-doc-controls">
      {props.compact !== true && (
        <div className="requirement-doc-control-group" role="group" aria-label={t('requirement.docLayoutLabel')}>
          <Button
            isIconOnly
            size="sm"
            variant={props.layout === 'page' ? 'primary' : 'ghost'}
            data-testid={`${scope}-layout-page`}
            aria-label={t('requirement.docLayoutPage')}
            aria-pressed={props.layout === 'page'}
            ref={(node) => { if (node !== null) node.title = t('requirement.docLayoutPage') }}
            onPress={() => { props.onLayoutChange('page') }}
          >
            <FileText size={14} aria-hidden="true" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant={props.layout === 'web' ? 'primary' : 'ghost'}
            data-testid={`${scope}-layout-web`}
            aria-label={t('requirement.docLayoutWeb')}
            aria-pressed={props.layout === 'web'}
            ref={(node) => { if (node !== null) node.title = t('requirement.docLayoutWeb') }}
            onPress={() => { props.onLayoutChange('web') }}
          >
            <StretchHorizontal size={14} aria-hidden="true" />
          </Button>
        </div>
      )}
      <div className="requirement-doc-control-group" role="group" aria-label={t('requirement.docFontLabel')}>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          data-testid={`${scope}-font-dec`}
          aria-label={t('requirement.docFontDecrease')}
          isDisabled={props.fontSize <= DOC_FONT_MIN}
          ref={(node) => { if (node !== null) node.title = t('requirement.docFontDecrease') }}
          onPress={() => { props.onStepFont(-1) }}
        >
          <Minus size={14} aria-hidden="true" />
        </Button>
        <span className="requirement-doc-font-value" data-testid={`${scope}-font-value`}>
          {`${String(props.fontSize)}px`}
        </span>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          data-testid={`${scope}-font-inc`}
          aria-label={t('requirement.docFontIncrease')}
          isDisabled={props.fontSize >= DOC_FONT_MAX}
          ref={(node) => { if (node !== null) node.title = t('requirement.docFontIncrease') }}
          onPress={() => { props.onStepFont(1) }}
        >
          <Plus size={14} aria-hidden="true" />
        </Button>
      </div>
      {allowFullscreen && (
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          data-testid={fullscreen ? `${prefix}-exit-fullscreen` : `${prefix}-fullscreen`}
          aria-label={t(fullscreen ? 'requirement.docExitFullscreen' : 'requirement.docFullscreen')}
          ref={(node) => { if (node !== null) node.title = t(fullscreen ? 'requirement.docExitFullscreen' : 'requirement.docFullscreen') }}
          onPress={props.onToggleFullscreen}
        >
          {fullscreen ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
        </Button>
      )}
    </div>
  )
}

/** 受控全屏文档阅读弹层属性。 */
export interface DocumentReaderDialogProps {
  /** 打开状态由调用方持有；关闭时组件不渲染任何节点。 */
  readonly open: boolean
  readonly text: string
  readonly title?: string | undefined
  readonly subtitle?: string | undefined
  readonly emptyText?: string | undefined
  readonly t?: Translate | undefined
  /** data-testid 前缀；默认 `doc`。 */
  readonly testIdPrefix?: string | undefined
  readonly onClose: () => void
}

/**
 * 渲染受控全屏文档阅读弹层，内建版式/字号调节、Esc 关闭与关闭按钮。
 * @param props - 打开状态、Markdown 原文、标题与关闭回调。
 * @returns 打开时为 portal 到 body 的阅读层，关闭时为空片段。
 */
export function DocumentReaderDialog(props: DocumentReaderDialogProps): JSX.Element {
  const t = props.t ?? zhText
  const { layout, fontSize, setLayout, stepFontSize } = useDocViewPrefs()
  const prefix = props.testIdPrefix ?? 'doc'

  useEffect(() => {
    if (!props.open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      props.onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [props.open, props.onClose])

  if (!props.open) return <></>

  const content = props.text.trim() === ''
    ? (props.emptyText === undefined ? null : <p className="empty">{props.emptyText}</p>)
    : renderMarkdown(props.text)

  return createPortal(
    <div
      className="requirement-doc-fullscreen-layer"
      data-testid={`${prefix}-fullscreen-layer`}
      role="dialog"
      aria-modal="true"
      aria-label={props.title ?? props.subtitle ?? ''}
    >
      <header className="requirement-doc-fullscreen-bar">
        <div className="requirement-doc-fullscreen-title">
          {props.subtitle !== undefined && <span className="mono">{props.subtitle}</span>}
          {props.title !== undefined && <strong>{props.title}</strong>}
        </div>
        <DocViewControls
          layout={layout}
          fontSize={fontSize}
          onLayoutChange={setLayout}
          onStepFont={stepFontSize}
          t={props.t}
          fullscreen
          allowFullscreen
          onToggleFullscreen={props.onClose}
          testIdPrefix={prefix}
        />
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          data-testid={`${prefix}-reader-close`}
          aria-label={t('drawer.close')}
          ref={(node) => { if (node !== null) node.title = t('drawer.close') }}
          onPress={props.onClose}
        >
          <X size={14} aria-hidden="true" />
        </Button>
      </header>
      <div className="requirement-doc-fullscreen-scroll">
        <div
          className="markdown-body document-body"
          data-testid={`${prefix}-fullscreen-body`}
          data-doc-layout={layout}
          data-doc-font-size={fontSize}
          style={{ fontSize: `${String(fontSize)}px` }}
        >
          {content}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 统一 Markdown 文档阅读器属性。 */
export interface MarkdownDocumentViewerProps {
  readonly text: string
  readonly title?: string | undefined
  readonly subtitle?: string | undefined
  readonly emptyText?: string | undefined
  readonly t?: Translate | undefined
  readonly className?: string | undefined
  readonly bodyTestId?: string | undefined
  readonly controlsTestIdPrefix?: string | undefined
  readonly compact?: boolean | undefined
  readonly tall?: boolean | undefined
  readonly allowFullscreen?: boolean | undefined
  /** 嵌入视图工具栏右侧的附加操作节点（仅内联阅读工具栏渲染）。 */
  readonly toolbarExtra?: JSX.Element | undefined
  /** 替换内联正文节点的只读视图；全屏阅读仍使用 `text` 原文。 */
  readonly bodyOverride?: ReactNode | undefined
}

/**
 * 渲染统一 Markdown 文档阅读器，内建工具栏与全屏预览浮层。
 * @param props - Markdown 原文、标题、空态与布局配置。
 * @returns 文档阅读器节点。
 */
export function MarkdownDocumentViewer(props: MarkdownDocumentViewerProps): JSX.Element {
  const { layout, fontSize, setLayout, stepFontSize } = useDocViewPrefs()
  const [fullscreen, setFullscreen] = useState(false)
  const prefix = props.controlsTestIdPrefix ?? 'doc'
  const allowFullscreen = props.allowFullscreen !== false
  const effectiveLayout: DocLayout = props.compact === true ? 'web' : layout
  const bodyClass = `markdown-body document-body${props.tall === true ? ' tall' : ''}${props.className === undefined ? '' : ` ${props.className}`}`

  const content = props.text.trim() === ''
    ? (props.emptyText === undefined ? null : <p className="empty">{props.emptyText}</p>)
    : renderMarkdown(props.text)

  return (
    <>
      <div className="requirement-doc-toolbar">
        <DocViewControls
          layout={layout}
          fontSize={fontSize}
          onLayoutChange={setLayout}
          onStepFont={stepFontSize}
          t={props.t}
          compact={props.compact}
          fullscreen={false}
          allowFullscreen={allowFullscreen}
          onToggleFullscreen={() => { setFullscreen(true) }}
          testIdPrefix={prefix}
        />
        {props.toolbarExtra}
      </div>
      <div
        className={bodyClass}
        data-testid={props.bodyTestId}
        data-doc-layout={effectiveLayout}
        data-doc-font-size={fontSize}
        style={{ fontSize: `${String(fontSize)}px` }}
      >
        {props.bodyOverride ?? content}
      </div>
      <DocumentReaderDialog
        open={allowFullscreen && fullscreen}
        text={props.text}
        title={props.title}
        subtitle={props.subtitle}
        emptyText={props.emptyText}
        t={props.t}
        testIdPrefix={prefix}
        onClose={() => { setFullscreen(false) }}
      />
    </>
  )
}
