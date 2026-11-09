/**
 * 任务详情里的只读图片附件区。
 *
 * 路径相对 `.spec` 根目录；字节走宿主现成的 `workspaceFiles.readBytes` 通道，
 * 与上游图片预览同一来源，不从渲染端旁路读盘。读不到的文件只画占位，
 * 不影响同一任务里的其它内容。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { LcoderWorkspaceKey } from '../locales.ts'
import css from './Shell.module.css'

/** 按 `.spec` 相对路径读一张图片；失败由返回值表达，不抛。 */
export type TaskAttachmentReader = (
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
) => Promise<RemoteResult<Uint8Array>>

/** schema 允许的图片扩展名到媒体类型。 */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** 一张附件的加载结果。 */
type LoadedAttachment =
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'missing' }

/** 附件区 props。 */
export interface TaskAttachmentsProps {
  readonly t: (key: LcoderWorkspaceKey) => string
  /** 读取用的会话；缺省时全部按读不到处理。 */
  readonly sessionId?: SessionId | undefined
  /** 相对 `.spec` 根目录的图片路径。 */
  readonly paths: readonly string[]
  /** 字节读取面；缺省时全部按读不到处理。 */
  readonly read?: TaskAttachmentReader | undefined
}

/**
 * 取路径末段作为展示文件名。
 * @param path - 相对 `.spec` 的图片路径。
 * @returns 文件名。
 */
function nameOf(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

/**
 * 按扩展名取媒体类型；schema 之外的扩展名返回 undefined。
 * @param path - 相对 `.spec` 的图片路径。
 * @returns 媒体类型。
 */
function mediaTypeOf(path: string): string | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(nameOf(path))?.[1]?.toLowerCase()
  return extension === undefined ? undefined : IMAGE_MEDIA_TYPES[extension]
}

/**
 * 原生字节转 base64，供 data URL 使用。
 * @param bytes - 文件字节。
 * @returns 不带前缀的 base64。
 */
function base64Of(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * 图片附件缩略图网格；点一张在嵌套弹窗里放大，全程只读。
 * @param props - 词典、会话、路径与字节读取面。
 * @returns 附件区；没有附件时为 null。
 */
export function TaskAttachments({ t, sessionId, paths, read }: TaskAttachmentsProps): ReactNode {
  const key = paths.join('\n')
  const [loaded, setLoaded] = useState<Readonly<Record<string, LoadedAttachment>>>({})
  const [zoom, setZoom] = useState<string | null>(null)

  useEffect(() => {
    const list = key === '' ? [] : key.split('\n')
    if (list.length === 0) {
      setLoaded({})
      return
    }
    if (read === undefined || sessionId === undefined) {
      setLoaded(Object.fromEntries(list.map(path => [path, { kind: 'missing' as const }])))
      return
    }
    const controller = new AbortController()
    void Promise.all(list.map(async (path): Promise<readonly [string, LoadedAttachment]> => {
      const mediaType = mediaTypeOf(path)
      if (mediaType === undefined) return [path, { kind: 'missing' }] as const
      const result = await read(sessionId, path, controller.signal).catch(() => null)
      if (result === null || !result.ok || result.value.length === 0) return [path, { kind: 'missing' }] as const
      return [path, { kind: 'ready', url: `data:${mediaType};base64,${base64Of(result.value)}` }] as const
    })).then((entries) => {
      if (controller.signal.aborted) return
      setLoaded(Object.fromEntries(entries))
    })
    return () => { controller.abort() }
  }, [key, read, sessionId])

  if (paths.length === 0) return null

  const zoomed = zoom === null ? undefined : loaded[zoom]
  return (
    <section className={css.attachmentSection} aria-label={t('shell.taskAttachments')}>
      <h4 className={css.attachmentTitle}>{t('shell.taskAttachments')}</h4>
      <div className={css.attachmentGrid}>
        {key.split('\n').map((path) => {
          const item = loaded[path]
          const name = nameOf(path)
          return item?.kind === 'ready'
            ? (
              <button
                type="button"
                key={path}
                className={css.attachmentThumb}
                title={t('shell.attachmentOpen')}
                aria-label={`${t('shell.attachmentOpen')} ${name}`}
                onClick={() => { setZoom(path) }}
              >
                <img className={css.attachmentImage} src={item.url} alt={name} />
              </button>
            )
            : (
              <div key={path} className={css.attachmentMissing} data-kind="missing">
                <span className={css.attachmentMissingName} title={path}>{name}</span>
                <span className={css.attachmentMissingText}>
                  {item === undefined ? t('shell.attachmentLoading') : t('shell.attachmentMissing')}
                </span>
              </div>
            )
        })}
      </div>
      {zoom === null || zoomed?.kind !== 'ready' ? null : (
        <div
          className={`${css.modalBackdrop} ${css.modalNested}`}
          onClick={(event) => { if (event.target === event.currentTarget) setZoom(null) }}
        >
          <div
            className={css.modal}
            role="dialog"
            aria-modal="true"
            aria-label={`${t('shell.attachmentOpen')} ${nameOf(zoom)}`}
          >
            <div className={css.modalHead}>
              <div className={css.grow}>
                <h3>{nameOf(zoom)}</h3>
                <p>{t('shell.taskAttachments')}</p>
              </div>
              <button type="button" className={css.secondaryBtn} onClick={() => { setZoom(null) }}>
                {t('shell.attachmentClose')}
              </button>
            </div>
            <div className={`${css.modalBody} ${css.attachmentZoomBody}`}>
              <img className={css.attachmentZoomImage} src={zoomed.url} alt={nameOf(zoom)} />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
