/**
 * 需求详情的原型区：参考图上传、网页样式预取、后台生成、隔离预览、区块重生成、采纳与清除。
 *
 * 预览 iframe 固定 `sandbox=""`（无 allow-scripts、无 allow-same-origin），
 * 用 `srcDoc` 独立渲染；原型页拿不到 window、IPC 或同源资源。
 */
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, JSX } from 'react'
import { Button, Separator } from '@heroui/react'

import type { PrototypeStyleSummary, UnaryCall } from '../prototype/remote.ts'
import { adoptPrototype, clearPrototype, prefetchStyle, readPrototypeHtml, uploadPrototypeRef } from '../prototype/remote.ts'
import { buildPrototypePrompt, PROTOTYPE_SECTIONS } from '../prototype/prompt.ts'
import type { PrototypeRefView, PrototypeSection } from '../prototype/prompt.ts'
import { readImageBase64 } from '../chat/attachments.ts'
import type { RequirementDocRow } from '../spec/rows.ts'
import { formatTimestamp } from './requirement-report.ts'
import { translate, type Translate } from '../locale.ts'

const zhText: Translate = (key, params) => translate('zh', key, params)

/** 原型区属性。 */
export interface PrototypePanelProps {
  readonly row: RequirementDocRow
  readonly scopeSessionId: string
  /** 页面级后台会话是否在跑；跑时锁定生成类按钮。 */
  readonly running: boolean
  /** 后台发起一条 maniu-prototype 会话；提示词由本区拼好。 */
  readonly onGenerate: (
    prompt: string,
  ) => Promise<{ readonly ok: boolean; readonly message: string }>
  readonly onReload: () => void
  readonly call?: UnaryCall | undefined
  readonly t?: Translate | undefined
}

/** 一次原型操作的忙碌标识。 */
type BusyKind = 'upload' | 'prefetch' | 'clear' | 'adopt' | null

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

  const registration = props.row.prototype
  const call = props.call
  const defaultCall: UnaryCall = (namespace, method, args) => window.lcoder.call(namespace, method, args)
  const invoke = call ?? defaultCall

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

  // 投影刷新后把已落盘的参考图补回列表；内存里已有的按路径去重，不覆盖缩略图。
  useEffect(() => {
    if (registration === undefined) return
    setRefs((current) => {
      const known = new Set(current.map(ref => ref.path))
      const persisted = (registration.references ?? [])
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
    if (props.running || busy !== null) return
    setGenError(undefined)
    const prompt = buildPrototypePrompt({
      requirementId: props.row.id,
      requirementTitle: props.row.title ?? props.row.id,
      requirementText: props.row.text,
      summary,
      refs,
      ...(section === undefined ? {} : { section }),
    })
    const answer = await props.onGenerate(prompt)
    if (!answer.ok) setGenError(answer.message)
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
              onChange={event => setUrl(event.target.value)}
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

      <div className="prototype-actions" data-testid="prototype-actions">
        <Button variant="primary" size="sm" data-testid="prototype-generate" isDisabled={props.running || busy !== null} onPress={() => { void doGenerate() }}>
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

      {registration !== undefined && (
        <div className="prototype-section-tools" data-testid="prototype-section-tools">
          <span className="prototype-subtitle">{t('prototype.regenerateSection')}</span>
          {PROTOTYPE_SECTIONS.map(section => (
            <Button key={section} size="sm" variant="ghost" data-testid="prototype-regenerate-section" data-section={section} isDisabled={props.running || busy !== null} onPress={() => { void doGenerate(section) }}>
              {section}
            </Button>
          ))}
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
        </div>
      )}

      <div className="prototype-preview" data-testid="prototype-preview">
        <h5>{t('prototype.previewTitle')}</h5>
        {registration === undefined
          ? <p className="empty" data-testid="prototype-preview-empty">{t('prototype.previewEmpty')}</p>
          : (
            <>
              <p className="detail-note" data-testid="prototype-generated-at">{t('prototype.generatedAt', { at: formatTimestamp(registration.generatedAt) })}</p>
              {previewError !== undefined && <p className="problem" data-testid="prototype-preview-error">{previewError}</p>}
              {html === undefined
                ? <p className="empty" data-testid="prototype-preview-loading">{t('prototype.previewLoading')}</p>
                : (
                  <iframe
                    title={t('prototype.previewTitle')}
                    className="prototype-frame"
                    data-testid="prototype-iframe"
                    sandbox=""
                    srcDoc={html}
                  />
                )}
              <p className="detail-note" data-testid="prototype-preview-note">{t('prototype.previewNote')}</p>
            </>
          )}
      </div>

      {(localError !== undefined || genError !== undefined) && (
        <p className="problem" data-testid="prototype-error">
          {t('prototype.error', { detail: localError ?? genError ?? '' })}
        </p>
      )}
    </section>
  )
}
