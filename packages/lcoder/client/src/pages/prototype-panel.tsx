/**
 * 需求详情的原型区：参考图上传、网页样式预取、后台生成、隔离预览、区块重生成、采纳与清除。
 *
 * 预览 iframe 固定 `sandbox=""`（无 allow-scripts、无 allow-same-origin），
 * 用 `srcDoc` 独立渲染；原型页拿不到 window、IPC 或同源资源。
 */
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, JSX } from 'react'
import { Button, Modal, Separator, useOverlayState } from '@heroui/react'

import type { LcoderApi, PrototypeSelectionInfo } from '../contract.ts'
import type { PrototypeStagedView, PrototypeStyleSummary, UnaryCall } from '../prototype/remote.ts'
import {
  adoptPrototype, clearPrototype, getStagedPrototype, prefetchStyle, readPrototypeHtml, uploadPrototypeRef,
} from '../prototype/remote.ts'
import { buildPrototypePrompt, PROTOTYPE_SECTIONS } from '../prototype/prompt.ts'
import type { PrototypeRefView, PrototypeSection } from '../prototype/prompt.ts'
import { resolveLibraryCopy, resolvePrototypeLibrary, usePrototypeLibraryState } from '../prototype/libraries.ts'
import { readImageBase64 } from '../chat/attachments.ts'
import type { RequirementDocRow } from '../spec/rows.ts'
import { formatTimestamp } from './requirement-report.ts'
import { translate, type Translate } from '../locale.ts'
import { studioBridge } from '../prototype-studio/bridge.ts'
import { useOpLiveFeeds } from '../shell/op-live-feed.ts'
import { OperationCardsPortal } from '../shell/operation-cards-portal.tsx'
import { prototypeRegenCardKey, prototypeRegenCardView } from '../prototype/regen-card.ts'

function lcoderBridge(): Partial<LcoderApi> | undefined {
  return 'lcoder' in window ? window.lcoder : undefined
}

const zhText: Translate = (key, params) => translate('zh', key, params)

/** 原型区属性。 */
export interface PrototypePanelProps {
  readonly row: RequirementDocRow
  readonly scopeSessionId: string
  /** 页面级后台会话是否在跑；跑时锁定生成类按钮。 */
  readonly running: boolean
  /** 后台发起一条 maniu-prototype 会话；提示词由本区拼好，成功时带回会话号。 */
  readonly onGenerate: (
    prompt: string,
  ) => Promise<{ readonly ok: boolean; readonly message: string; readonly sessionId?: string }>
  readonly onReload: () => void
  readonly onManageLibraries?: (() => void) | undefined
  /** 跳到原型页查看项目活原型；缺省时不显示入口。 */
  readonly onOpenProjectPrototype?: (() => void) | undefined
  /** 浮卡「查看对话」入口；缺省时不显示跳转按钮。 */
  readonly onOpenSession?: ((sessionId: string) => void) | undefined
  readonly call?: UnaryCall | undefined
  readonly t?: Translate | undefined
}

/** 一次原型操作的忙碌标识。 */
type BusyKind = 'upload' | 'prefetch' | 'clear' | 'adopt' | null

/** 面板持有的原型生成浮卡：状态随生成会话结束与暂存登记推进。 */
interface PanelRegenCard {
  readonly sessionId: string
  readonly status: 'running' | 'done' | 'failed'
  readonly minimized: boolean
}

/**
 * 画出需求详情的原型区。
 * @param props - 需求行、会话号与后台发起回调。
 * @returns 原型面板。
 */
export function PrototypePanel(props: PrototypePanelProps): JSX.Element {
  const t = props.t ?? zhText
  const fileRef = useRef<HTMLInputElement>(null)
  const [refs, setRefs] = useState<readonly PrototypeRefView[]>([])
  const [url, setUrl] = useState('')
  const [summary, setSummary] = useState<PrototypeStyleSummary | undefined>(undefined)
  const [busy, setBusy] = useState<BusyKind>(null)
  const [localError, setLocalError] = useState<string | undefined>(undefined)
  const [genError, setGenError] = useState<string | undefined>(undefined)
  const [confirmClear, setConfirmClear] = useState(false)
  const [html, setHtml] = useState<string | undefined>(undefined)
  const [previewError, setPreviewError] = useState<string | undefined>(undefined)
  /** 项目级统一活原型：需求详情展示同一份活原型，工作室仍带当前 REQ-xx 上下文。 */
  const [projectView, setProjectView] = useState<PrototypeStagedView | null>(null)
  const [generatingSection, setGeneratingSection] = useState<PrototypeSection | undefined>(undefined)
  const [lastRedone, setLastRedone] = useState<PrototypeSection | undefined>(undefined)
  /** 待确认的生成目标；null 表示没有打开确认框。 */
  const [generateConfirmTarget, setGenerateConfirmTarget] = useState<{ readonly section?: PrototypeSection } | null>(null)
  /** 生成浮卡：发起后显示进度，结束按暂存是否落盘收口为完成或失败。 */
  const [regenCard, setRegenCard] = useState<PanelRegenCard | null>(null)
  const sawCardRunningRef = useRef(false)
  const cardBaselineGeneratedAtRef = useRef<string | undefined>(undefined)
  const cardSessionIds = regenCard !== null && regenCard.status === 'running' ? [regenCard.sessionId] : []
  const cardLiveFeeds = useOpLiveFeeds(cardSessionIds)
  const generateOverlay = useOverlayState({
    isOpen: generateConfirmTarget !== null,
    onOpenChange: (open) => {
      if (!open) setGenerateConfirmTarget(null)
    },
  })
  const [selection, setSelection] = useState<PrototypeSelectionInfo | undefined>(undefined)
  const [instruction, setInstruction] = useState('')
  const [patching, setPatching] = useState(false)
  const [patchNote, setPatchNote] = useState<string | undefined>(undefined)
  const libraryState = usePrototypeLibraryState()
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(libraryState.defaultLibraryId)
  const lastDefaultLibraryRef = useRef<string>(libraryState.defaultLibraryId)
  /** 已交给独立窗口的 HTML；html 变化时据此刷新同一个窗口。 */
  const lastOpenedHtml = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (lastDefaultLibraryRef.current !== libraryState.defaultLibraryId) {
      lastDefaultLibraryRef.current = libraryState.defaultLibraryId
      setSelectedLibraryId(libraryState.defaultLibraryId)
      return
    }
    if (!libraryState.libraries.some(lib => lib.id === selectedLibraryId)) {
      setSelectedLibraryId(libraryState.defaultLibraryId)
    }
  }, [libraryState.defaultLibraryId, libraryState.libraries, selectedLibraryId])

  const selectedLibrary = resolvePrototypeLibrary(selectedLibraryId, libraryState)
  const selectedLibraryCopy = resolveLibraryCopy(selectedLibrary, t)

  const registration = props.row.prototype
  /** 生成配置默认折叠：已有原型时预览留在首屏，无原型时展开配置供首次生成。 */
  const [configOpen, setConfigOpen] = useState(registration === undefined)
  const quality = registration?.quality
  const adoptReady = quality !== undefined && quality.failed.length === 0 && quality.misses.length === 0
  const call = props.call
  const defaultCall: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args)
  const invoke = call ?? defaultCall

  // 生成结束后按暂存登记的生成时间收口浮卡：有新的暂存版本算完成，否则算失败。
  useEffect(() => {
    if (regenCard === null || regenCard.status !== 'running') return
    if (props.running) {
      sawCardRunningRef.current = true
      return
    }
    const generatedAt = registration?.generatedAt
    const landed = generatedAt !== undefined && generatedAt !== cardBaselineGeneratedAtRef.current
    if (!landed && !sawCardRunningRef.current) return
    sawCardRunningRef.current = false
    setRegenCard(current => current === null ? current : { ...current, status: landed ? 'done' : 'failed' })
  }, [props.running, regenCard, registration?.generatedAt])

  /** 面板首屏优先展示项目级统一活原型；项目级没有原型时回退到需求自己的正式版。 */
  const projectHtml = projectView === null ? undefined : projectView.staged?.html ?? projectView.committedHtml ?? undefined
  const previewHtml = projectHtml ?? html
  /** 需求有登记但 HTML 还没读回来：画加载态，不误报「还没有原型」。 */
  const previewPending = previewHtml === undefined && registration !== undefined

  // 生成完成、清除或切换需求后，配置折叠态回到与新原型登记匹配的位置。
  useEffect(() => {
    setConfigOpen(registration === undefined)
  }, [registration?.path, registration?.generatedAt, props.row.id])

  // 原型登记变化（生成或清除后）时重读 HTML 到隔离预览；卸载后不再落状态。
  useEffect(() => {
    if (registration === undefined) {
      setHtml(undefined)
      setPreviewError(undefined)
      return
    }
    let disposed = false
    setPreviewError(undefined)
    void readPrototypeHtml(props.scopeSessionId, registration, invoke)
      .then((text) => { if (!disposed) setHtml(text) })
      .catch((cause: unknown) => {
        if (!disposed) setPreviewError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { disposed = true }
  }, [registration?.path, registration?.generatedAt, props.scopeSessionId])

  // 项目级活原型与需求登记分开读：项目级读不到时保留需求自己的预览，不把面板画空。
  useEffect(() => {
    let disposed = false
    void getStagedPrototype(props.scopeSessionId, undefined, invoke)
      .then((view) => { if (!disposed) setProjectView(view) })
      .catch(() => { if (!disposed) setProjectView(null) })
    return () => { disposed = true }
  }, [props.scopeSessionId, props.row.id, registration?.path, registration?.generatedAt])

  // 预览内容变化（元素级修改或项目活原型更新）：若已开过独立窗口，复用它刷新，不堆积多个窗口。
  useEffect(() => {
    if (lastOpenedHtml.current === undefined || previewHtml === undefined || previewHtml === lastOpenedHtml.current) return
    lastOpenedHtml.current = previewHtml
    void Promise.resolve(lcoderBridge()?.openPrototypePreview?.(previewHtml)).catch((cause: unknown) => {
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [previewHtml])

  // 独立预览窗口的点选上报：只接元素信息，不反向给原型任何宿主数据。
  useEffect(() => {
    const unsubscribe = lcoderBridge()?.onPrototypeSelection?.((info) => {
      setSelection(info)
      setInstruction('')
      setPatchNote(undefined)
    })
    return () => { unsubscribe?.() }
  }, [])

  // 投影刷新后把已落盘的参考图补回列表；内存里已有的按路径去重，不覆盖缩略图。
  useEffect(() => {
    if (registration === undefined) return
    setRefs((current) => {
      const known = new Set(current.map(ref => ref.path))
      const persisted = registration.references
        .map(path => ({ path, name: path.split('/').pop() ?? path }))
        .filter(ref => !known.has(ref.path))
      return persisted.length === 0 ? current : [...current, ...persisted]
    })
  }, [registration?.path, registration?.generatedAt])

  const fail = (cause: unknown): void => {
    setLocalError(cause instanceof Error ? cause.message : String(cause))
  }

  const pickImage = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || busy !== null) return
    setBusy('upload')
    setLocalError(undefined)
    try {
      const base64 = await readImageBase64(file)
      const receipt = await uploadPrototypeRef(props.scopeSessionId, props.row.id, file.name, base64, invoke)
      setRefs(current => [...current, {
        path: receipt.path,
        name: file.name,
        dataUrl: `data:${file.type === '' ? 'image/png' : file.type};base64,${base64}`,
      }])
    } catch (cause: unknown) {
      fail(cause)
    } finally {
      setBusy(null)
    }
  }

  const doPrefetch = async (): Promise<void> => {
    const trimmed = url.trim()
    if (trimmed === '' || busy !== null) return
    setBusy('prefetch')
    setLocalError(undefined)
    try {
      setSummary(await prefetchStyle(trimmed, invoke))
    } catch (cause: unknown) {
      fail(cause)
    } finally {
      setBusy(null)
    }
  }

  const doGenerate = async (section?: PrototypeSection): Promise<void> => {
    if (props.running || busy !== null || generatingSection !== undefined) return
    setGenError(undefined)
    setLastRedone(undefined)
    if (section !== undefined) setGeneratingSection(section)
    try {
      const prompt = buildPrototypePrompt({
        requirementId: props.row.id,
        requirementTitle: props.row.title ?? props.row.id,
        requirementText: props.row.text,
        summary,
        refs,
        library: { ...selectedLibrary, name: selectedLibraryCopy.name, summary: selectedLibraryCopy.summary },
        ...(section === undefined ? {} : { section }),
      })
      const answer = await props.onGenerate(prompt)
      if (!answer.ok) setGenError(answer.message)
      else {
        if (section !== undefined) setLastRedone(section)
        if (answer.sessionId !== undefined) {
          sawCardRunningRef.current = false
          cardBaselineGeneratedAtRef.current = registration?.generatedAt
          setRegenCard({ sessionId: answer.sessionId, status: 'running', minimized: false })
        }
      }
    } catch (cause: unknown) {
      setGenError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setGeneratingSection(undefined)
    }
  }

  /** 生成类入口统一先开确认框；运行中或忙时不再响应。 */
  const askGenerate = (section?: PrototypeSection): void => {
    if (props.running || busy !== null || generatingSection !== undefined) return
    setGenError(undefined)
    setGenerateConfirmTarget(section === undefined ? {} : { section })
  }

  /** 确认后才真正发起；取消由弹窗关闭处理，不调用 onGenerate。 */
  const confirmGenerate = (): void => {
    const target = generateConfirmTarget
    setGenerateConfirmTarget(null)
    void doGenerate(target?.section)
  }

  const doOpenWindow = async (): Promise<void> => {
    if (previewHtml === undefined) return
    setPreviewError(undefined)
    lastOpenedHtml.current = previewHtml
    try {
      await lcoderBridge()?.openPrototypePreview?.(previewHtml)
    } catch (cause: unknown) {
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const doOpenStudio = async (): Promise<void> => {
    if (previewHtml === undefined) return
    setPreviewError(undefined)
    try {
      await studioBridge()?.openPrototypeStudio?.({
        requirementId: props.row.id,
        sessionId: props.scopeSessionId,
        html: previewHtml,
        beforeHtml: previewHtml,
        mode: 'split',
      })
    } catch (cause: unknown) {
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const applyPatch = async (): Promise<void> => {
    if (selection === undefined || instruction.trim() === '' || props.running || patching) return
    setPatching(true)
    setPatchNote(undefined)
    setGenError(undefined)
    try {
      const prompt = buildPrototypePrompt({
        requirementId: props.row.id,
        requirementTitle: props.row.title ?? props.row.id,
        requirementText: props.row.text,
        summary,
        refs,
        library: { ...selectedLibrary, name: selectedLibraryCopy.name, summary: selectedLibraryCopy.summary },
        patch: {
          domPath: selection.domPath,
          html: selection.html,
          css: selection.css,
          instruction: instruction.trim(),
        },
      })
      const answer = await props.onGenerate(prompt)
      if (!answer.ok) setGenError(answer.message)
      else {
        setPatchNote(t('prototype.selectionSent'))
        setInstruction('')
      }
    } catch (cause: unknown) {
      setGenError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPatching(false)
    }
  }

  const doAdopt = async (): Promise<void> => {
    if (busy !== null || registration === undefined) return
    setBusy('adopt')
    setLocalError(undefined)
    try {
      await adoptPrototype(props.scopeSessionId, props.row.id, invoke)
      props.onReload()
    } catch (cause: unknown) {
      fail(cause)
    } finally {
      setBusy(null)
    }
  }

  const doClear = async (): Promise<void> => {
    if (busy !== null) return
    setBusy('clear')
    setLocalError(undefined)
    try {
      await clearPrototype(props.scopeSessionId, props.row.id, invoke)
      setConfirmClear(false)
      setRefs([])
      setUrl('')
      setSummary(undefined)
      props.onReload()
    } catch (cause: unknown) {
      fail(cause)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="detail-section requirement-prototype" data-testid="prototype-panel" data-requirement-id={props.row.id}>
      <Separator className="detail-divider" />
      <h4>{t('prototype.title')}</h4>
      <p className="detail-note" data-testid="prototype-hint">{t('prototype.hint')}</p>

      {/* 预览与产出信息置顶：已有原型时首屏直接看到预览、独立窗和采纳清除生成。 */}
      <div className="prototype-preview" data-testid="prototype-preview">
        <h5>{t('prototype.previewTitle')}</h5>
        {previewHtml === undefined
          ? previewPending
            ? <p className="empty" data-testid="prototype-preview-loading">{t('prototype.previewLoading')}</p>
            : <p className="empty" data-testid="prototype-preview-empty">{t('prototype.previewEmpty')}</p>
          : (
            <>
              {registration !== undefined && (
                <p className="detail-note" data-testid="prototype-generated-at">{t('prototype.generatedAt', { at: formatTimestamp(registration.generatedAt) })}</p>
              )}
              <div className="prototype-window-actions">
                <Button size="sm" variant="secondary" data-testid="prototype-open-window" onPress={() => { void doOpenWindow() }}>
                  {t('prototype.openWindow')}
                </Button>
                <Button size="sm" variant="primary" data-testid="prototype-open-studio" onPress={() => { void doOpenStudio() }}>
                  {t('prototype.openStudio')}
                </Button>
                {props.onOpenProjectPrototype !== undefined && (
                  <Button size="sm" variant="ghost" data-testid="prototype-open-project" onPress={() => { props.onOpenProjectPrototype?.() }}>
                    {t('prototype.openProjectPrototype')}
                  </Button>
                )}
                <span className="detail-note" data-testid="prototype-window-note">{t('prototype.windowNote')}</span>
              </div>
              {previewError !== undefined && <p className="problem" data-testid="prototype-preview-error">{previewError}</p>}
              <iframe
                title={t('prototype.previewTitle')}
                className="prototype-frame"
                data-testid="prototype-iframe"
                sandbox=""
                srcDoc={previewHtml}
              />
              <p className="detail-note" data-testid="prototype-preview-note">{t('prototype.previewNote')}</p>
            </>
          )}
      </div>

      {selection !== undefined && (
        <div className="prototype-selection-card" data-testid="prototype-selection-card">
          <span className="prototype-subtitle">{t('prototype.selectionTitle')}</span>
          <p className="mono" data-testid="prototype-selection-path">{t('prototype.selectionCard', { domPath: selection.domPath })}</p>
          <div className="prototype-selection-row">
            <input
              className="prototype-selection-input"
              data-testid="prototype-selection-instruction"
              value={instruction}
              placeholder={t('prototype.selectionInstruction')}
              onChange={(event) => { setInstruction(event.target.value) }}
            />
            <Button
              size="sm"
              variant="primary"
              data-testid="prototype-selection-apply"
              isDisabled={props.running || patching || instruction.trim() === ''}
              onPress={() => { void applyPatch() }}
            >
              {patching ? t('prototype.selectionApplying') : t('prototype.selectionApply')}
            </Button>
          </div>
          {patchNote !== undefined && <p className="detail-note" data-testid="prototype-selection-status">{patchNote}</p>}
        </div>
      )}

      {registration?.quality !== undefined && (
        <div className="prototype-quality" data-testid="prototype-quality" data-ok={registration.quality.failed.length === 0 ? 'true' : 'false'}>
          <h5>{registration.quality.failed.length === 0 ? t('prototype.qualityPassed') : t('prototype.qualityFailed')}</h5>
          {registration.quality.failed.map(issue => (
            <p key={issue.code} className="problem" data-testid="prototype-quality-failed">
              {t('prototype.qualityItem', { code: issue.code, message: issue.message })}
            </p>
          ))}
          <p data-testid="prototype-keywords">
            {t('prototype.keywords', {
              hits: registration.quality.hits.length,
              total: registration.quality.keywords.length,
              rate: Math.round(registration.quality.keywordHitRate * 100),
            })}
          </p>
          {registration.quality.misses.length > 0 && (
            <p className="detail-note" data-testid="prototype-keywords-miss">
              {t('prototype.keywordsMiss', { words: registration.quality.misses.join('、') })}
            </p>
          )}
          <div className="prototype-quality-next" data-testid="prototype-quality-next" data-recommend={adoptReady ? 'adopt' : 'regenerate'}>
            <p className="detail-note" data-testid="prototype-quality-guide">
              {adoptReady
                ? t('prototype.qualityNextAdopt')
                : t('prototype.qualityNextRegenerate', { count: registration.quality.misses.length })}
            </p>
            <div className="prototype-quality-actions">
              <Button
                variant={adoptReady ? 'primary' : 'secondary'}
                size="sm"
                data-testid="prototype-quality-adopt"
                isDisabled={busy !== null || registration.adoptedAt !== undefined}
                onPress={() => { void doAdopt() }}
              >
                {t('prototype.adopt')}
              </Button>
              <Button
                variant={adoptReady ? 'secondary' : 'primary'}
                size="sm"
                data-testid="prototype-quality-regenerate"
                isDisabled={props.running || busy !== null}
                onPress={() => { askGenerate() }}
              >
                {t('prototype.regenerate')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="prototype-actions" data-testid="prototype-actions">
        <Button variant="primary" size="sm" data-testid="prototype-generate" isDisabled={props.running || busy !== null} onPress={() => { askGenerate() }}>
          {registration === undefined ? t('prototype.generate') : t('prototype.regenerate')}
        </Button>
        {registration !== undefined && (
          <>
            <Button variant="secondary" size="sm" data-testid="prototype-adopt" isDisabled={busy !== null || registration.adoptedAt !== undefined} onPress={() => { void doAdopt() }}>
              {registration.adoptedAt === undefined ? t('prototype.adopt') : t('prototype.adopted')}
            </Button>
            {!confirmClear
              ? <Button variant="danger-soft" size="sm" data-testid="prototype-clear" isDisabled={busy !== null} onPress={() => { setConfirmClear(true) }}>
                {t('prototype.clear')}
              </Button>
              : (
                <span className="prototype-confirm" data-testid="prototype-clear-confirm">
                  <span>{t('prototype.clearConfirm')}</span>
                  <Button size="sm" variant="danger" data-testid="prototype-clear-yes" isDisabled={busy !== null} onPress={() => { void doClear() }}>
                    {busy === 'clear' ? t('prototype.clearing') : t('prototype.clear')}
                  </Button>
                  <Button size="sm" variant="ghost" data-testid="prototype-clear-no" onPress={() => { setConfirmClear(false) }}>
                    {t('prototype.clearCancel')}
                  </Button>
                </span>
              )}
          </>
        )}
      </div>

      <button
        type="button"
        className="prototype-config-toggle"
        data-testid="prototype-config-toggle"
        data-open={configOpen ? 'true' : 'false'}
        aria-expanded={configOpen}
        onClick={() => { setConfigOpen(current => !current) }}
      >
        {configOpen ? t('prototype.configToggleClose') : t('prototype.configToggleOpen')}
      </button>

      <div className="prototype-config" data-testid="prototype-config" hidden={!configOpen}>
        <div className="prototype-library-bar" data-testid="prototype-library-bar">
          <div className="prototype-library-head">
            <span className="prototype-subtitle">{t('prototype.libraryTitle')}</span>
            <Button
              size="sm"
              variant="ghost"
              data-testid="prototype-library-manage"
              onPress={() => { props.onManageLibraries?.() }}
            >
              {t('prototype.libraryManage')}
            </Button>
          </div>
          <div className="prototype-library-controls">
            <select
              className="prototype-library-select"
              data-testid="prototype-library-select"
              aria-label={t('prototype.libraryTitle')}
              value={selectedLibrary.id}
              onChange={(event) => { setSelectedLibraryId(event.target.value) }}
            >
              {libraryState.libraries.map((lib) => {
                const copy = resolveLibraryCopy(lib, t)
                const label = lib.id === libraryState.defaultLibraryId
                  ? t('prototype.libraryDefaultOption', { name: copy.name })
                  : copy.name
                return <option key={lib.id} value={lib.id}>{label}</option>
              })}
            </select>
            <div className="prototype-library-meta">
              <div className="proto-lib-palette">
                {selectedLibrary.palette.slice(0, 5).map((color, index) => (
                  <span
                    key={`${selectedLibrary.id}-dot-${String(index)}`}
                    className="proto-lib-swatch"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
              {selectedLibraryCopy.summary !== '' && (
                <span className="detail-note" data-testid="prototype-library-summary">{selectedLibraryCopy.summary}</span>
              )}
            </div>
          </div>
        </div>

        <div className="prototype-inputs">
          <div className="prototype-refs" data-testid="prototype-refs">
            <span className="prototype-subtitle">{t('prototype.refTitle')}</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="prototype-file-input"
              data-testid="prototype-ref-input"
              hidden
              onChange={(event) => { void pickImage(event) }}
            />
            <Button size="sm" variant="secondary" data-testid="prototype-ref-upload" isDisabled={busy !== null} onPress={() => { fileRef.current?.click() }}>
              {busy === 'upload' ? t('prototype.refUploading') : t('prototype.refUpload')}
            </Button>
            {refs.length === 0
              ? <p className="empty" data-testid="prototype-ref-empty">{t('prototype.refEmpty')}</p>
              : (
                <ul className="prototype-ref-list" data-testid="prototype-ref-list">
                  {refs.map(ref => (
                    <li key={ref.path} data-testid="prototype-ref-item" data-path={ref.path}>
                      {ref.dataUrl === undefined
                        ? <span className="prototype-ref-thumb" aria-hidden="true" />
                        : <img className="prototype-ref-thumb" data-testid="prototype-ref-thumb" src={ref.dataUrl} alt={ref.name} />}
                      <span className="mono">{ref.name}</span>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        data-testid="prototype-ref-remove"
                        aria-label={t('prototype.refRemove')}
                        onPress={() => { setRefs(current => current.filter(item => item.path !== ref.path)) }}
                      >
                        ×
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
          </div>

          <div className="prototype-url" data-testid="prototype-url">
            <span className="prototype-subtitle">{t('prototype.urlTitle')}</span>
            <div className="prototype-url-row">
              <input
                className="prototype-url-input"
                data-testid="prototype-url-input"
                value={url}
                placeholder={t('prototype.urlPlaceholder')}
                onChange={(event) => { setUrl(event.target.value) }}
              />
              <Button size="sm" variant="secondary" data-testid="prototype-url-prefetch" isDisabled={busy !== null || url.trim() === ''} onPress={() => { void doPrefetch() }}>
                {busy === 'prefetch' ? t('prototype.urlPrefetching') : t('prototype.urlPrefetch')}
              </Button>
              {summary !== undefined && (
                <>
                  <Button size="sm" variant="ghost" data-testid="prototype-url-clear" onPress={() => { setSummary(undefined); setUrl('') }}>
                    {t('prototype.urlClear')}
                  </Button>
                  <Button size="sm" variant="ghost" data-testid="prototype-url-ignore" onPress={() => { setSummary(undefined) }}>
                    {t('prototype.urlIgnore')}
                  </Button>
                </>
              )}
            </div>
            {summary === undefined
              ? <p className="empty" data-testid="prototype-summary-empty">{t('prototype.summaryEmpty')}</p>
              : (
                <div className="prototype-summary" data-testid="prototype-summary">
                  <h5>{t('prototype.summaryTitle')}</h5>
                  <p data-testid="prototype-summary-fields">
                    {t('prototype.summaryFields', {
                      colors: summary.colors.length === 0 ? t('prototype.summaryUnknown') : summary.colors.join('、'),
                      font: summary.font === '' ? t('prototype.summaryUnknown') : summary.font,
                      layout: summary.layout === '' ? t('prototype.summaryUnknown') : summary.layout,
                      buttons: summary.buttonStyle === '' ? t('prototype.summaryUnknown') : summary.buttonStyle,
                    })}
                  </p>
                  <p data-testid="prototype-summary-text">{t('prototype.summaryText', { text: summary.text })}</p>
                </div>
              )}
          </div>
        </div>

        {registration !== undefined && (
          <div className="prototype-section-tools" data-testid="prototype-section-tools">
            <span className="prototype-subtitle">{t('prototype.regenerateSection')}</span>
            <div className="prototype-section-chips" role="group" aria-label={t('prototype.regenerateSection')}>
              {PROTOTYPE_SECTIONS.map((section) => {
                const active = generatingSection === section
                return (
                  <Button
                    key={section}
                    size="sm"
                    variant="outline"
                    className="prototype-section-chip"
                    data-testid="prototype-regenerate-section"
                    data-section={section}
                    data-state={active ? 'running' : 'idle'}
                    isDisabled={props.running || busy !== null || generatingSection !== undefined}
                    onPress={() => { askGenerate(section) }}
                  >
                    {active ? t('prototype.sectionRedoing') : section}
                  </Button>
                )
              })}
            </div>
            {generatingSection !== undefined && (
              <span className="prototype-hint-running" data-testid="prototype-section-status">
                {t('prototype.sectionStatus', { section: generatingSection })}
              </span>
            )}
            {generatingSection === undefined && lastRedone !== undefined && (
              <span className="prototype-hint-done" data-testid="prototype-section-done">
                {t('prototype.sectionDone', { section: lastRedone })}
              </span>
            )}
          </div>
        )}
      </div>

      {(localError !== undefined || genError !== undefined) && (
        <p className="problem" data-testid="prototype-error">
          {t('prototype.error', { detail: localError ?? genError ?? '' })}
        </p>
      )}

      <Modal.Root state={generateOverlay}>
        <Modal.Backdrop variant="transparent" className="glass-modal-backdrop">
          <Modal.Container placement="center" size="md" className="glass-modal">
            <Modal.Dialog
              className="glass-modal-panel"
              data-testid="prototype-generate-confirm-dialog"
              aria-label={t('prototype.regenConfirmTitle')}
            >
              <Modal.Header>
                <Modal.Heading>{t('prototype.regenConfirmTitle')}</Modal.Heading>
                <Modal.CloseTrigger data-testid="prototype-generate-confirm-close" aria-label={t('prototype.regenConfirmCancel')} />
              </Modal.Header>
              <Modal.Body>
                <p data-testid="prototype-generate-confirm-text">{t('prototype.regenConfirmBody')}</p>
                <div className="prototype-confirm">
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="prototype-generate-confirm-cancel"
                    onPress={() => { setGenerateConfirmTarget(null) }}
                  >
                    {t('prototype.regenConfirmCancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    data-testid="prototype-generate-confirm"
                    onPress={confirmGenerate}
                  >
                    {t('prototype.regenConfirmSubmit')}
                  </Button>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      <OperationCardsPortal
        cards={regenCard === null
          ? []
          : [prototypeRegenCardView({
            sessionId: regenCard.sessionId,
            status: regenCard.status,
            minimized: regenCard.minimized,
            t,
            ...(cardLiveFeeds[regenCard.sessionId] === undefined ? {} : { liveFeed: cardLiveFeeds[regenCard.sessionId] }),
          })]}
        onToggleMinimize={(key) => {
          setRegenCard(current => current !== null && prototypeRegenCardKey(current.sessionId) === key
            ? { ...current, minimized: !current.minimized }
            : current)
        }}
        onOpenSession={(sessionId) => { props.onOpenSession?.(sessionId) }}
        onClose={(key) => {
          setRegenCard(current => current !== null && prototypeRegenCardKey(current.sessionId) === key ? null : current)
        }}
        t={t}
      />
    </section>
  )
}
