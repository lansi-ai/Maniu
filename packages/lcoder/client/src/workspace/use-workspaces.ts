/** 项目列表与工作台作用域会话：`workspace/follow` + `workspace/create`。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionSummary } from '../store.ts'

/** 一个已登记项目。 */
export interface WorkspaceRow {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

/** 当前工作台作用域：项目 + 提供 `.spec` 相对基准的会话。 */
export interface ProjectScope {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly scopeSessionId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function workspaceOf(value: unknown): WorkspaceRow | undefined {
  if (!isRecord(value) || typeof value.workspaceId !== 'string' || typeof value.path !== 'string') return undefined
  return {
    workspaceId: value.workspaceId,
    path: value.path,
    title: typeof value.title === 'string' ? value.title : value.path,
    sessionIds: Array.isArray(value.sessionIds) ? value.sessionIds.filter((id): id is string => typeof id === 'string') : [],
  }
}

function itemsOf(baseline: unknown): WorkspaceRow[] {
  if (!isRecord(baseline) || !Array.isArray(baseline.items)) return []
  return baseline.items.flatMap(item => workspaceOf(item) ?? [])
}

/** 当前会话列表的读取面；空数组表示宿主还没给出列表。 */
export interface SessionLookup {
  readonly sessions: readonly SessionSummary[]
}

/**
 * 订阅项目列表。
 * @param enabled - 宿主就绪后为 true；false 时不打开流。
 * @returns 项目、读取错误与重开方法。
 */
export function useWorkspaceList(enabled: boolean): {
  readonly items: readonly WorkspaceRow[]
  readonly error: string | null
  readonly reload: () => void
} {
  const [items, setItems] = useState<readonly WorkspaceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const streamRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const stream = window.lcoder.openStream('workspace', 'follow', {})
    void stream.then((streamId) => {
      if (disposed) {
        void window.lcoder.cancelStream(streamId)
        return
      }
      streamRef.current = streamId
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
    const off = window.lcoder.onStreamFrame((streamId, frame) => {
      if (streamId !== streamRef.current) return
      if (frame.kind === 'error') {
        setError(`${frame.error.code}: ${frame.error.message}`)
        return
      }
      if (frame.kind !== 'item' || !isRecord(frame.value)) return
      const value = frame.value
      if (value.type === 'baseline') {
        setItems(itemsOf(value.value))
        setError(null)
        return
      }
      if (value.type === 'replace') {
        setItems(itemsOf(value.value))
        return
      }
      if (value.type === 'upsert') {
        const row = workspaceOf(value.workspace)
        if (row === undefined) return
        setItems(current => [...current.filter(item => item.workspaceId !== row.workspaceId), row])
        return
      }
      if (value.type === 'remove' && typeof value.workspaceId === 'string') {
        setItems(current => current.filter(item => item.workspaceId !== value.workspaceId))
        return
      }
      if (value.type === 'order' && Array.isArray(value.workspaceIds)) {
        const order = value.workspaceIds.filter((id): id is string => typeof id === 'string')
        setItems(current => [...current].sort((left, right) => order.indexOf(left.workspaceId) - order.indexOf(right.workspaceId)))
      }
    })
    return () => {
      disposed = true
      off()
      const streamId = streamRef.current
      streamRef.current = null
      if (streamId !== null) void window.lcoder.cancelStream(streamId)
    }
  }, [enabled, generation])

  const reload = useCallback(() => { setGeneration(current => current + 1) }, [])
  return { items, error, reload }
}

/**
 * 选一个目录。
 * @returns 用户选中的路径；取消为 null；对话框打不开时抛错。
 */
export async function pickDirectory(): Promise<string | null> {
  return window.lcoder.pickDirectory()
}

/** 打开项目的结果。 */
export type OpenedWorkspace =
  | { readonly ok: true; readonly workspace: WorkspaceRow }
  | { readonly ok: false; readonly message: string }

/**
 * 登记（或取回）一个项目。
 * @param path - 仓库目录。
 * @returns 项目行；失败带人话。
 */
export async function openWorkspace(path: string): Promise<OpenedWorkspace> {
  const answer = await window.lcoder.call('workspace', 'create', { request: { path } })
  if (!answer.ok) return { ok: false, message: `${answer.error.code}: ${answer.error.message}` }
  const value = answer.value
  const workspace = isRecord(value) ? workspaceOf(value.workspace) : undefined
  return workspace === undefined
    ? { ok: false, message: 'workspace.create 返回了无法识别的项目' }
    : { ok: true, workspace }
}

/**
 * 给项目找一条作用域会话：先按 cwd 复用已有会话，没有再新建。
 * @param workspace - 项目行。
 * @param sessions - 当前会话列表。
 * @param preset - 新建会话时指名的角色。
 * @returns 会话 id；失败带人话。
 */
export async function ensureScopeSession(
  workspace: WorkspaceRow,
  sessions: readonly SessionSummary[],
  preset?: string,
): Promise<{ readonly ok: true; readonly sessionId: string } | { readonly ok: false; readonly message: string }> {
  const normalized = workspace.path.toLowerCase()
  const existing = sessions.find(session => (session.cwd ?? '').toLowerCase() === normalized)
  if (existing !== undefined) return { ok: true, sessionId: existing.sessionId }
  const answer = await window.lcoder.call('session', 'create', {
    request: {
      workspaceId: workspace.workspaceId,
      ...(preset === undefined ? {} : { agentPreset: preset }),
    },
  })
  if (!answer.ok) return { ok: false, message: `${answer.error.code}: ${answer.error.message}` }
  const value = answer.value
  return isRecord(value) && typeof value.sessionId === 'string'
    ? { ok: true, sessionId: value.sessionId }
    : { ok: false, message: 'session.create 返回了无法识别的会话' }
}
