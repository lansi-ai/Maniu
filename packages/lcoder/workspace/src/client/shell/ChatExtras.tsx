/**
 * 浮层输入区的两个展示组件：模型 chip 与面板、附件列表与附件按钮。
 *
 * 数据与回调都从 props 来，组件本身不碰 ctx；面板状态机与附件校验在
 * `chat-composer.ts`，这里只剩渲染与远程调用。
 */

import { useEffect, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LcoderWorkspaceKey } from '../locales.ts'
import type { ModelSettingsFace } from './model-settings.ts'
import {
  chatModelAvailability, chatModelProviders, formatBytes, INITIAL_MODEL_PANEL, isCurrentModel,
  modelChoiceKey, reduceModelPanel,
} from './chat-composer.ts'
import type {
  ChatImageLimits, ChatModelSelectionView, ChatPendingAttachment, ChatPendingImage, ChatPendingFile,
} from './chat-composer.ts'
import css from './Shell.module.css'

/** 词典函数；占位符由调用方自己补。 */
type Translate = (key: LcoderWorkspaceKey) => string

/** 补 `{name}` 占位符。 */
function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    text,
  )
}

/** 模型 chip 与面板 props。 */
export interface ChatModelChipProps {
  readonly t: Translate
  /** 设置页的数据面；缺省时 chip 只显示不可用。 */
  readonly face?: ModelSettingsFace | undefined
  /** 浮层所在会话；缺省时不能切换。 */
  readonly sessionId?: SessionId | undefined
  /** 当前模型；undefined 表示目录与会话都没给出。 */
  readonly selection?: ChatModelSelectionView | undefined
  /** 切换成功后通知外壳重查模型可用性。 */
  readonly onChanged?: (() => void) | undefined
}

/**
 * 头部模型 chip；点开是分组面板。
 * @param props - 数据面、会话与当前选择。
 * @returns chip 与展开后的面板。
 */
export function ChatModelChip({ t, face, sessionId, selection, onChanged }: ChatModelChipProps): ReactNode {
  const [state, dispatch] = useReducer(reduceModelPanel, INITIAL_MODEL_PANEL)
  const wrap = useRef<HTMLDivElement>(null)

  const load = async (): Promise<void> => {
    if (face === undefined) {
      dispatch({ type: 'fail', detail: t('shell.chatModelUnavailable') })
      return
    }
    try {
      dispatch({ type: 'load', snapshot: await face.load() })
    } catch (error: unknown) {
      dispatch({ type: 'fail', detail: String(error) })
    }
  }

  useEffect(() => {
    if (!state.open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (wrap.current !== null && event.target instanceof Node && wrap.current.contains(event.target)) return
      dispatch({ type: 'close' })
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [state.open])

  const toggle = (): void => {
    const opening = !state.open
    dispatch({ type: 'toggle' })
    if (opening && (state.snapshot === null || state.failure !== null)) void load()
  }

  const pick = async (provider: string, model: string): Promise<void> => {
    if (face === undefined || sessionId === undefined) return
    dispatch({ type: 'pick', key: modelChoiceKey(provider, model) })
    const failure = await face.setDefault(sessionId, provider, model)
    if (failure !== undefined) {
      dispatch({ type: 'pick-failed', detail: failure })
      return
    }
    onChanged?.()
    try {
      dispatch({ type: 'picked', snapshot: await face.load() })
    } catch (error: unknown) {
      dispatch({ type: 'pick-failed', detail: String(error) })
    }
  }

  const availability = chatModelAvailability(state.snapshot)
  const providers = chatModelProviders(state.snapshot)
  const label = selection === undefined ? t('shell.chatModel') : `${selection.provider}/${selection.model}`
  const chipTitle = selection === undefined
    ? t('shell.chatModel')
    : selection.source === 'default'
      ? `${label} · ${t('shell.chatModelDefaultNote')}`
      : label

  return (
    <div className={css.modelChipWrap} ref={wrap}>
      <button
        type="button"
        className={css.modelChip}
        title={chipTitle}
        aria-expanded={state.open}
        onClick={toggle}
      >
        <span className={css.modelChipText}>{label}</span>
        {selection?.source === 'default' ? <span className={css.modelChipTag}>{t('shell.modelDefaultBadge')}</span> : null}
        <span className={css.modelChipCaret} aria-hidden="true">▾</span>
      </button>
      {state.open ? (
        <div className={css.modelPanel} role="dialog" aria-label={t('shell.chatModel')}>
          <div className={css.modelPanelHead}>
            <span>{t('shell.chatModel')}</span>
            <button type="button" className={css.modelPanelClose} onClick={() => { dispatch({ type: 'close' }) }}>✕</button>
          </div>
          <div className={css.modelPanelBody}>
            {availability.kind === 'loading' ? <p className={css.modelPanelHint}>{t('shell.chatModelLoading')}</p> : null}
            {availability.kind === 'error'
              ? <p className={css.modelPanelError}>{fill(t('shell.modelLoadError'), { detail: availability.detail })}</p>
              : null}
            {availability.kind === 'empty' ? <p className={css.modelPanelHint}>{t('shell.chatModelEmpty')}</p> : null}
            {availability.kind === 'no-credential'
              ? <p className={css.modelPanelHint}>{t('shell.chatModelNoCredential')}</p>
              : null}
            {providers.map(provider => (
              <section key={provider.provider} className={css.modelProvider}>
                <div className={css.modelProviderHead}>
                  <span className={css.modelProviderName}>{provider.name}</span>
                  <span className={css.modelProviderId}>{provider.provider}</span>
                  {provider.reason === undefined ? null : (
                    <span className={css.modelProviderReason}>{t(providerReasonKey(provider.reason))}</span>
                  )}
                </div>
                <div className={css.modelList}>
                  {provider.models.map((model) => {
                    const key = modelChoiceKey(provider.provider, model.id)
                    const current = isCurrentModel(selection, provider.provider, model.id)
                    const busy = state.busyKey === key
                    return (
                      <button
                        key={model.id}
                        type="button"
                        className={`${css.modelOption} ${current ? css.modelOptionOn : ''}`}
                        aria-pressed={current}
                        disabled={!provider.usable || state.busyKey !== null}
                        title={provider.usable ? model.id : t(providerReasonKey(provider.reason ?? 'no-key'))}
                        onClick={() => { void pick(provider.provider, model.id) }}
                      >
                        <span className={css.modelOptionName}>{model.name}</span>
                        {busy ? <span className={css.modelOptionMark}>…</span> : null}
                        {current && !busy ? <span className={css.modelOptionMark}>✓</span> : null}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
            {state.failure === null ? null : (
              <p className={css.modelPanelError}>{fill(t('shell.chatModelSelectFailed'), { detail: state.failure })}</p>
            )}
          </div>
          <p className={css.modelPanelFoot}>{t('shell.modelSetDefaultHint')}</p>
        </div>
      ) : null}
    </div>
  )
}

/** 不可用原因到词典键。 */
function providerReasonKey(reason: 'error' | 'inactive' | 'account' | 'no-key'): LcoderWorkspaceKey {
  if (reason === 'error') return 'shell.modelBroken'
  if (reason === 'inactive') return 'shell.modelInactive'
  if (reason === 'account') return 'shell.modelSignInNeeded'
  return 'shell.modelNotConfigured'
}

/** 附件列表 props。 */
export interface ChatAttachmentListProps {
  readonly t: Translate
  readonly attachments: readonly ChatPendingAttachment[]
  readonly limits: ChatImageLimits
  readonly onRemove: (id: string) => void
  readonly onRetry: (id: string) => void
}

/**
 * 待发附件列表：图片给缩略图，文件给名称、大小与上传状态。
 * @param props - 附件、上限与移除/重试回调。
 * @returns 附件条带；没有附件时为空。
 */
export function ChatAttachmentList({
  t, attachments, limits, onRemove, onRetry,
}: ChatAttachmentListProps): ReactNode {
  if (attachments.length === 0) return null
  const images = attachments.filter((item): item is ChatPendingImage => item.kind === 'image')
  return (
    <div className={css.attachList}>
      {attachments.map((attachment) => {
        if (attachment.kind === 'image') {
          return (
            <div key={attachment.id} className={css.attachItem} data-kind="image">
              <img
                className={css.attachThumb}
                src={`data:${attachment.mediaType};base64,${attachment.data}`}
                alt={attachment.name}
              />
              <div className={css.attachMeta}>
                <span className={css.attachName} title={attachment.name}>{attachment.name}</span>
                <span className={css.attachSize}>{formatBytes(attachment.bytes)}</span>
              </div>
              <button
                type="button"
                className={css.attachRemove}
                title={t('shell.attachmentRemove')}
                onClick={() => { onRemove(attachment.id) }}
              >
                ✕
              </button>
            </div>
          )
        }
        return (
          <ChatFileItem
            key={attachment.id}
            t={t}
            file={attachment}
            onRemove={() => { onRemove(attachment.id) }}
            onRetry={() => { onRetry(attachment.id) }}
          />
        )
      })}
      {images.length === 0 ? null : (
        <p className={css.attachHint}>
          {fill(t('shell.attachmentLimits'), {
            size: formatBytes(limits.maxImageBytes),
            count: limits.maxImagesPerMessage,
          })}
        </p>
      )}
    </div>
  )
}

/** 一条文件附件。 */
function ChatFileItem({ t, file, onRemove, onRetry }: {
  readonly t: Translate
  readonly file: ChatPendingFile
  readonly onRemove: () => void
  readonly onRetry: () => void
}): ReactNode {
  return (
    <div className={css.attachItem} data-kind="file" data-status={file.status}>
      <span className={css.attachFileMark} aria-hidden="true">▤</span>
      <div className={css.attachMeta}>
        <span className={css.attachName} title={file.name}>{file.name}</span>
        <span className={css.attachSize}>
          {formatBytes(file.bytes)}
          {file.status === 'uploading' ? ` · ${t('shell.attachmentUploading')}` : ''}
        </span>
        {file.status === 'failed'
          ? (
            <span className={css.attachError} title={file.errorCode}>
              {fill(t('shell.attachmentUploadFailed'), { detail: file.error ?? '' })}
            </span>
          )
          : null}
      </div>
      {file.status === 'failed' ? (
        <button type="button" className={css.attachRetry} onClick={onRetry}>{t('shell.attachmentRetry')}</button>
      ) : null}
      <button type="button" className={css.attachRemove} title={t('shell.attachmentRemove')} onClick={onRemove}>✕</button>
    </div>
  )
}

/** 附件按钮 props。 */
export interface ChatAttachButtonProps {
  readonly t: Translate
  readonly disabled?: boolean | undefined
  readonly onFiles: (files: readonly File[]) => void
}

/**
 * 附件按钮：打开原生文件选择，选完交给外壳读取与上传。
 * @param props - 词典、禁用位与选文件回调。
 * @returns 一个紧凑按钮与隐藏的 file input。
 */
export function ChatAttachButton({ t, disabled, onFiles }: ChatAttachButtonProps): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        className={`${css.iconBtn} ${css.attachButton}`}
        title={t('shell.attachments')}
        aria-label={t('shell.attachments')}
        disabled={disabled}
        onClick={() => { input.current?.click() }}
      >
        ＋
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </>
  )
}
