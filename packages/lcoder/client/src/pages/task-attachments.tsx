/** 任务附件只读区：经宿主 `workspaceFiles.readBytes` 取图片并回显。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

type Loaded =
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'missing' }

function nameOf(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function mediaTypeOf(path: string): string | undefined {
  const extension = /\.([A-Za-z0-9]+)$/u.exec(nameOf(path))?.[1]?.toLowerCase()
  return extension === undefined ? undefined : MEDIA_TYPES[extension]
}

function bytesOf(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof value === 'object' && value !== null && 'data' in value) {
    const data = value.data
    if (data instanceof Uint8Array) return data
    if (data instanceof ArrayBuffer) return new Uint8Array(data)
  }
  return undefined
}

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** 附件区属性。 */
export interface TaskAttachmentsProps {
  readonly scopeSessionId: string
  /** 相对 `.spec` 根目录的图片路径。 */
  readonly paths: readonly string[]
}

/**
 * 画附件缩略图网格。
 * @param props - 作用域会话与图片路径。
 * @returns 附件区；没有附件时为空片段。
 */
export function TaskAttachments(props: TaskAttachmentsProps): JSX.Element | null {
  const [loaded, setLoaded] = useState<Readonly<Record<string, Loaded>>>({})
  const [zoom, setZoom] = useState<string | null>(null)
  const key = props.paths.join('\n')

  useEffect(() => {
    let disposed = false
    const list = key === '' ? [] : key.split('\n')
    if (list.length === 0) {
      setLoaded({})
      return
    }
    void Promise.all(list.map(async (path): Promise<readonly [string, Loaded]> => {
      const mediaType = mediaTypeOf(path)
      if (mediaType === undefined) return [path, { kind: 'missing' }] as const
      try {
        const answer = await window.lcoder.call('workspaceFiles', 'readBytes', {
          workspaceFileScopeId: props.scopeSessionId,
          path: `.spec/${path}`,
          options: {},
        })
        if (!answer.ok) return [path, { kind: 'missing' }] as const
        const bytes = bytesOf(answer.value)
        if (bytes === undefined || bytes.length === 0) return [path, { kind: 'missing' }] as const
        return [path, { kind: 'ready', url: `data:${mediaType};base64,${base64Of(bytes)}` }] as const
      } catch {
        return [path, { kind: 'missing' }] as const
      }
    })).then((entries) => {
      if (disposed) return
      setLoaded(Object.fromEntries(entries))
    })
    return () => { disposed = true }
  }, [key, props.scopeSessionId])

  if (props.paths.length === 0) return null
  const zoomed = zoom === null ? undefined : loaded[zoom]

  return (
    <div className="attachment-grid" data-testid="task-attachment-grid">
      {props.paths.map((path) => {
        const item = loaded[path]
        return item?.kind === 'ready'
          ? (
            <button type="button" key={path} className="attachment-thumb" data-testid="task-attachment" data-path={path} onClick={() => { setZoom(path) }}>
              <img src={item.url} alt={nameOf(path)} />
            </button>
          )
          : (
            <div key={path} className="attachment-missing" data-testid="task-attachment-missing" data-path={path}>
              <span>{nameOf(path)}</span>
              <em>{item === undefined ? '读取中…' : '读不到这张图片'}</em>
            </div>
          )
      })}
      {zoom !== null && zoomed?.kind === 'ready' && (
        <div className="attachment-zoom" data-testid="attachment-zoom" onClick={() => { setZoom(null) }}>
          <figure>
            <img src={zoomed.url} alt={nameOf(zoom)} />
            <figcaption>{zoom}</figcaption>
          </figure>
        </div>
      )}
    </div>
  )
}
