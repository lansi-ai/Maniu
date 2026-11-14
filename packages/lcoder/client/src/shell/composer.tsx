/** 输入区：附件、模型 chip、上下文用量、发送与停止。 */

import { useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import type { Translate } from '../locale.ts'
import {
  attachmentsReady, checkImageCandidate, formatBytes, formatTokens, promptIsEmpty, uploadedFile,
  type ChatImageLimits, type ChatImageMediaType, type ChatModelAvailability, type ChatModelOption,
  type ChatModelSelectionView, type ChatContextUsage, type ChatPendingAttachment, type ChatPendingFile,
  type ChatPendingImage,
} from '../chat/composer.ts'
import { readImageBase64, uploadAttachment } from '../chat/attachments.ts'

/** 输入区属性。 */
export interface ComposerProps {
  readonly t: Translate
  readonly sessionId: string | null
  readonly running: boolean
  readonly sending: boolean
  readonly limits: ChatImageLimits
  readonly models: readonly ChatModelOption[]
  readonly selection: ChatModelSelectionView | undefined
  readonly availability: ChatModelAvailability
  readonly usage: ChatContextUsage
  readonly composerRef: RefObject<HTMLTextAreaElement>
  readonly ensureSession: () => Promise<string | null>
  /** 发送一条提示；返回 true 表示宿主已接受，输入区据此清空。 */
  readonly onSend: (text: string, attachments: readonly ChatPendingAttachment[]) => Promise<boolean>
  readonly onStop: () => void
  /** 切换模型；返回 true 表示宿主已接受。 */
  readonly onSelectModel: (provider: string, model: string) => Promise<boolean>
}

function imageIdOf(): string {
  return `image-${String(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0)}`
}

function fileIdOf(): string {
  return `file-${String(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0)}`
}

const IMAGE_MEDIA_TYPES: readonly ChatImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** 图片类型白名单判定；浏览器给的 type 可能是空串。 */
function imageMediaOf(type: string): ChatImageMediaType | null {
  return IMAGE_MEDIA_TYPES.find(known => known === type) ?? null
}

/**
 * 一条待发附件：图片给本地缩略图，文件给状态与重试。
 * @param props - 附件、词典与动作。
 * @returns 附件条目。
 */
function AttachmentChip({ attachment, t, onRemove, onRetry }: {
  readonly attachment: ChatPendingAttachment
  readonly t: Translate
  readonly onRemove: (id: string) => void
  readonly onRetry: (id: string) => void
}): JSX.Element {
  const label = `${attachment.name} · ${formatBytes(attachment.bytes)}`
  return (
    <div className="attach-item" data-kind={attachment.kind} data-testid="composer-attachment" data-status={attachment.kind === 'file' ? attachment.status : 'ready'}>
      {attachment.kind === 'image' && (
        <img
          src={`data:${attachment.mediaType};base64,${attachment.data}`}
          alt={attachment.name}
          data-testid="composer-image"
        />
      )}
      <span className="attach-name" title={attachment.name}>{label}</span>
      {attachment.kind === 'file' && attachment.status === 'uploading'
        ? <span className="attach-state">{t('chat.attachUploading')}</span>
        : null}
      {attachment.kind === 'file' && attachment.status === 'failed'
        ? <span className="attach-state attach-failed">{t('chat.attachFailed', { detail: attachment.error ?? '' })}</span>
        : null}
      {attachment.kind === 'file' && attachment.status === 'failed'
        ? <button type="button" className="pill pill-mini" data-testid="attach-retry" onClick={() => { onRetry(attachment.id) }}>{t('chat.attachRetry')}</button>
        : null}
      <button type="button" className="attach-remove" aria-label={t('chat.attachRemove')} data-testid="attach-remove" onClick={() => { onRemove(attachment.id) }}>
        ×
      </button>
    </div>
  )
}

/**
 * 输入区。
 * @param props - 会话、模型、附件上限与动作。
 * @returns 玻璃胶囊输入器。
 */
export function Composer({
  t, sessionId, running, sending, limits, models, selection, availability, usage,
  composerRef, ensureSession, onSend, onStop, onSelectModel,
}: ComposerProps): JSX.Element {
  const [attachments, setAttachments] = useState<readonly ChatPendingAttachment[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [modelBusy, setModelBusy] = useState(false)
  const filesRef = useRef(new Map<string, File>())
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)

  const patchFile = (id: string, next: (current: ChatPendingFile) => ChatPendingFile): void => {
    setAttachments(current => current.map(item => item.id === id && item.kind === 'file' ? next(item) : item))
  }

  const uploadFile = async (id: string, session: string, file: File): Promise<void> => {
    try {
      const data = await readImageBase64(file)
      const result = await uploadAttachment(session, data, file.name)
      patchFile(id, current => uploadedFile(current.id, current.name, current.bytes, result))
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      patchFile(id, current => ({ ...current, status: 'failed', error: detail }))
    }
  }

  const addFiles = async (files: readonly File[]): Promise<void> => {
    setProblem(null)
    const session = sessionId ?? await ensureSession()
    let images = attachments.filter((item): item is ChatPendingImage => item.kind === 'image')
    for (const file of files) {
      const mediaType = imageMediaOf(file.type)
      if (mediaType === null && file.type.startsWith('image/')) {
        setProblem(t('chat.attachUnsupported'))
        continue
      }
      if (mediaType !== null) {
        const rejection = checkImageCandidate(mediaType, file.size, images, limits)
        if (rejection !== null) {
          setProblem(rejection.kind === 'unsupported-type'
            ? t('chat.attachUnsupported')
            : rejection.kind === 'too-large' ? t('chat.attachTooLarge', { limit: formatBytes(rejection.limit) })
              : rejection.kind === 'too-many' ? t('chat.attachTooMany', { count: rejection.limit })
                : t('chat.attachTotalTooLarge', { limit: formatBytes(rejection.limit) }))
          continue
        }
        try {
          const data = await readImageBase64(file)
          const image: ChatPendingImage = { id: imageIdOf(), kind: 'image', name: file.name, bytes: file.size, mediaType, data }
          images = [...images, image]
          setAttachments(current => [...current, image])
        } catch (cause: unknown) {
          setProblem(cause instanceof Error ? cause.message : String(cause))
        }
        continue
      }
      const id = fileIdOf()
      filesRef.current.set(id, file)
      const pending: ChatPendingFile = { id, kind: 'file', name: file.name, bytes: file.size, status: 'uploading' }
      setAttachments(current => [...current, pending])
      if (session === null) {
        patchFile(id, current => ({ ...current, status: 'failed', error: t('chat.noSession') }))
        continue
      }
      await uploadFile(id, session, file)
    }
  }

  const retry = (id: string): void => {
    const file = filesRef.current.get(id)
    if (file === undefined) return
    patchFile(id, current => ({
      id: current.id,
      kind: 'file',
      name: current.name,
      bytes: current.bytes,
      status: 'uploading',
    }))
    void (async () => {
      const session = sessionId ?? await ensureSession()
      if (session === null) {
        patchFile(id, current => ({ ...current, status: 'failed', error: t('chat.noSession') }))
        return
      }
      await uploadFile(id, session, file)
    })()
  }

  const remove = (id: string): void => {
    filesRef.current.delete(id)
    setAttachments(current => current.filter(item => item.id !== id))
  }

  // 只有目录明确为空才拦住发送；查询本身失败不冒充「没有模型」。
  const modelBlocked = availability.kind === 'empty'
  const ready = attachmentsReady(attachments)
  // 文本区是非受控的：按钮不按当前文本禁用，空文本由 submit 自己吃掉。
  const canSend = !sending && !modelBlocked && ready

  const submit = async (): Promise<void> => {
    if (submittingRef.current) return
    const text = composerRef.current?.value.trim() ?? ''
    if (promptIsEmpty(text, attachments) || !ready || sending || modelBlocked) return
    submittingRef.current = true
    try {
      const accepted = await onSend(text, attachments)
      if (!accepted) return
      if (composerRef.current !== null) composerRef.current.value = ''
      filesRef.current.clear()
      setAttachments([])
      setProblem(null)
    } finally {
      submittingRef.current = false
    }
  }

  const pickModel = async (key: string): Promise<void> => {
    const option = models.find(item => `${item.provider}\u0000${item.model}` === key)
    if (option === undefined || modelBusy) return
    setModelBusy(true)
    await onSelectModel(option.provider, option.model)
    setModelBusy(false)
  }

  const selectionKey = selection === undefined ? '' : `${selection.provider}\u0000${selection.model}`
  const knownSelection = models.some(item => `${item.provider}\u0000${item.model}` === selectionKey)
  const selectedOption = models.find(item => `${item.provider}\u0000${item.model}` === selectionKey)
  const selectionLabel = selection === undefined
    ? t('chat.modelEmpty')
    : selectedOption === undefined
      ? `${selection.provider} · ${selection.model}`
      : `${selectedOption.providerName} · ${selectedOption.modelName}`
  const selectValue = selection === undefined ? models[0] === undefined ? '' : `${models[0].provider}\u0000${models[0].model}` : selectionKey

  const usageText = usage.used === undefined
    ? t('chat.contextUnknown')
    : usage.window === undefined
      ? t('chat.contextUsed', { used: formatTokens(usage.used) })
      : t('chat.contextUsage', {
        used: formatTokens(usage.used),
        budget: formatTokens(usage.window),
        percent: String(Math.round((usage.used / Math.max(1, usage.window)) * 100)),
      })

  return (
    <div className="composer lg-glass" data-testid="composer-shell">
      {attachments.length > 0 && (
        <div className="attach-rail" data-testid="composer-attachments">
          {attachments.map(attachment => (
            <AttachmentChip key={attachment.id} attachment={attachment} t={t} onRemove={remove} onRetry={retry} />
          ))}
          <span className="attach-limits" data-testid="attach-limits">
            {t('chat.attachLimits', { size: formatBytes(limits.maxImageBytes), count: limits.maxImagesPerMessage })}
          </span>
        </div>
      )}
      {problem === null ? null : <p className="notice" data-testid="composer-problem">{problem}</p>}
      <div className="composer-row">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="attach-input"
          data-testid="attach-input"
          onChange={(event) => {
            const files = event.target.files === null ? [] : [...event.target.files]
            event.target.value = ''
            void addFiles(files)
          }}
        />
        <button
          type="button"
          className="pill pill-icon"
          data-testid="attach"
          title={t('chat.attach')}
          aria-label={t('chat.attach')}
          onClick={() => { inputRef.current?.click() }}
        >
          +
        </button>
        <textarea
          ref={composerRef}
          data-testid="composer"
          placeholder={t('chat.placeholder')}
          rows={2}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        {running ? (
          <button type="button" className="pill" data-testid="stop" onClick={onStop}>
            {t('chat.stop')}
          </button>
        ) : null}
        <button
          type="button"
          className="pill pill-accent lg-sheen lg-lift"
          data-testid="send"
          disabled={!canSend}
          onClick={() => { void submit() }}
        >
          {sending ? t('chat.sending') : t('chat.send')}
        </button>
      </div>
      <div className="composer-meta">
        <label className="model-chip" data-testid="model-chip" data-source={selection?.source ?? 'none'}>
          <span className="model-chip-label">{t('chat.modelLabel')}</span>
          <select
            className="model-chip-select"
            data-testid="model-chip-select"
            value={selectValue}
            disabled={models.length === 0 || modelBusy || modelBlocked}
            aria-label={t('chat.modelLabel')}
            onChange={(event) => { void pickModel(event.target.value) }}
          >
            {selection !== undefined && !knownSelection
              ? <option value={selectionKey}>{selectionLabel}</option>
              : null}
            {models.map(option => (
              <option key={`${option.provider}\u0000${option.model}`} value={`${option.provider}\u0000${option.model}`}>
                {option.providerName} · {option.modelName}
              </option>
            ))}
          </select>
        </label>
        <span className="context-usage" data-testid="context-usage" data-known={usage.used === undefined ? 'false' : 'true'}>
          {usageText}
        </span>
        {availability.kind !== 'ready' ? (
          <span className="model-warning" data-testid="model-blocked">
            {availability.kind === 'empty' ? t('chat.modelBlocked') : t('chat.modelUnknown', { detail: availability.detail })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
