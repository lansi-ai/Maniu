/**
 * Prototype Studio 协作端：左侧画布由宿主维护，这里只做只读投影与 Remote 操作。
 * 暂存落盘、丢弃、快照恢复全部走 prototype/* Remote，渲染端不直写任何文件。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@heroui/react'
import type { Translate } from '../locale.ts'
import { translate, type MessageKey } from '../locale.ts'
import { usePreferences } from '../prefs.ts'
import { formatTimestamp } from '../pages/requirement-report.ts'
import { buildStudioCoDesignPrompt } from '../prototype/prompt.ts'
import type {
  PrototypeCommitResult,
  PrototypeStagedView,
  RequirementSyncStatus,
  StagedPrototype,
  UnaryCall,
} from '../prototype/remote.ts'
import {
  commitStagedPrototype, discardStagedPrototype, getStagedPrototype,
  listPrototypeSnapshots, restorePrototypeSnapshot,
} from '../prototype/remote.ts'
import type { PrototypeSnapshotMeta } from '../prototype/remote.ts'
import { AnchorComposer } from './anchor-composer.tsx'
import { ChangeCard } from './change-card.tsx'
import { CoDesignThread } from './co-design-thread.tsx'
import { studioBridge, type StudioBridge, type StudioSelectionInfo, type StudioViewMode } from './bridge.ts'

/** 工作室根组件属性。 */
export interface PrototypeStudioAppProps {
  readonly requirementId: string
  /** URL 里带来的会话号；缺省时解析当前工作区作用域会话。 */
  readonly initialSessionId?: string | undefined
  readonly t?: Translate | undefined
  readonly bridge?: StudioBridge | undefined
  /** 一元调用注入点；缺省走宿主 preload。 */
  readonly call?: UnaryCall | undefined
}

const PROJECT_KEY = 'lcoder.m2.project'
const ACTIVE_SESSION_KEY = 'lcoder.s1.session'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 会话号兜底：优先 URL，其次本需求上次用过的工作室会话，再取工作区作用域会话。
 * @param requirementId - 需求编号。
 * @param initialSessionId - URL 显式带来的会话号。
 * @returns 会话号或 null。
 */
export function resolveStudioSessionId(requirementId: string, initialSessionId?: string): string | null {
  if (initialSessionId !== undefined && initialSessionId !== '') return initialSessionId
  try {
    const stored = localStorage.getItem(`lcoder.studio.session.${requirementId}`)
    if (stored !== null && stored !== '') return stored
    const raw = localStorage.getItem(PROJECT_KEY)
    if (raw !== null) {
      const value: unknown = JSON.parse(raw)
      if (isRecord(value) && typeof value.scopeSessionId === 'string' && value.scopeSessionId !== '') {
        return value.scopeSessionId
      }
    }
    const active = localStorage.getItem(ACTIVE_SESSION_KEY)
    if (active !== null && active !== '') return active
  } catch {
    // 偏好存储损坏时不猜会话：后续发消息会显式新建。
  }
  return null
}

/**
 * 把同步回执映射成词典键；未知值按 none 处理。
 * @param status - 宿主回执状态。
 * @returns 消息键。
 */
function syncKey(status: RequirementSyncStatus): MessageKey {
  switch (status) {
    case 'patched': return 'studio.sync.patched'
    case 'amended': return 'studio.sync.amended'
    case 'skipped_pending': return 'studio.sync.skippedPending'
    case 'skipped_locked': return 'studio.sync.skippedLocked'
    case 'none': return 'studio.sync.none'
  }
}

function requestId(): string {
  return `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * 画 Prototype Studio 协作端。
 * @param props - 需求编号、可选会话号与注入的宿主/调用替身。
 * @returns 工作室界面。
 */
export function PrototypeStudioApp(props: PrototypeStudioAppProps): JSX.Element {
  const prefs = usePreferences()
  const t: Translate = props.t ?? ((key, params) => translate(prefs.locale, key, params))
  const bridge = useMemo<StudioBridge | undefined>(() => props.bridge ?? studioBridge(), [props.bridge])
  const invoke = useMemo<UnaryCall>(() => props.call ?? ((namespace, method, args) => {
    if (bridge?.call === undefined) return Promise.reject(new Error('宿主桥不可用'))
    return bridge.call(namespace, method, args)
  }), [bridge, props.call])

  const requirementId = props.requirementId
  const [sessionId, setSessionId] = useState<string | null>(
    () => resolveStudioSessionId(requirementId, props.initialSessionId),
  )
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const [staged, setStaged] = useState<StagedPrototype | null>(null)
  const [committedHtml, setCommittedHtml] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<readonly PrototypeSnapshotMeta[]>([])
  const [viewMode, setViewMode] = useState<StudioViewMode>('split')
  const [floatingCollapsed, setFloatingCollapsed] = useState(false)
  const [showingBefore, setShowingBefore] = useState(false)
  const [highlight, setHighlight] = useState(false)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncStatus, setSyncStatus] = useState<RequirementSyncStatus | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [turnRunning, setTurnRunning] = useState(false)

  const loadHtml = useCallback((html: string | null, beforeHtml: string | null): void => {
    if (html === null) return
    void bridge?.loadPrototypeStudioHtml?.({
      html,
      ...(beforeHtml === null ? {} : { beforeHtml }),
    })
  }, [bridge])

  const refreshStaged = useCallback(async (): Promise<PrototypeStagedView> => {
    const view = await getStagedPrototype(sessionIdRef.current ?? '', requirementId, invoke)
    setStaged(view.staged)
    setCommittedHtml(view.committedHtml)
    return view
  }, [invoke, requirementId])

  const refreshSnapshots = useCallback(async (): Promise<void> => {
    const items = await listPrototypeSnapshots(sessionIdRef.current ?? '', requirementId, invoke)
    setSnapshots(items)
  }, [invoke, requirementId])

  useEffect(() => {
    let disposed = false
    void Promise.all([refreshStaged(), refreshSnapshots()]).then(([view]) => {
      if (disposed) return
      loadHtml(view.staged === null ? view.committedHtml : view.staged.html, view.committedHtml)
    }).catch((cause: unknown) => {
      if (!disposed) setNotice(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { disposed = true }
  }, [refreshStaged, refreshSnapshots, loadHtml])

  const changeMode = (next: StudioViewMode): void => {
    setViewMode(next)
    void bridge?.setPrototypeStudioMode?.(next)
  }

  const toggleFloating = (): void => {
    if (floatingCollapsed) {
      setFloatingCollapsed(false)
      void bridge?.setPrototypeStudioFloatingBounds?.({ x: -1, y: -1, width: 380, height: 520, collapsed: false })
      return
    }
    setFloatingCollapsed(true)
    void bridge?.setPrototypeStudioFloatingBounds?.({ x: -1, y: -1, width: 260, height: 48, collapsed: true })
  }

  const switchView = (before: boolean): void => {
    setShowingBefore(before)
    loadHtml(before ? committedHtml : staged?.html ?? null, committedHtml)
  }

  const compareSideBySide = (): void => {
    changeMode('compare-side-by-side')
    loadHtml(staged?.html ?? committedHtml, committedHtml)
  }

  const toggleHighlight = (): void => {
    const next = !highlight
    setHighlight(next)
    void bridge?.highlightPrototypeStudioPaths?.(next && staged !== null ? staged.changedDomPaths : [])
  }

  const commit = async (applyRequirementDiff: boolean, amend: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    try {
      const result: PrototypeCommitResult = await commitStagedPrototype({
        sessionId: sessionIdRef.current ?? '',
        requirementId,
        ...(applyRequirementDiff ? { applyRequirementDiff: true } : {}),
        ...(amend ? { requirementAmendMode: 'amend' as const } : {}),
      }, invoke)
      setSyncStatus(result.requirementSync)
      const view = await refreshStaged()
      await refreshSnapshots()
      setShowingBefore(false)
      setHighlight(false)
      void bridge?.highlightPrototypeStudioPaths?.([])
      loadHtml(view.committedHtml, view.committedHtml)
      setNotice(result.requirementSync === 'skipped_pending'
        ? t('studio.syncSkippedPending')
        : t('studio.commitDone', { sync: t(syncKey(result.requirementSync)) }))
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const discard = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    try {
      await discardStagedPrototype(sessionIdRef.current ?? '', requirementId, invoke)
      const view = await refreshStaged()
      setShowingBefore(false)
      setHighlight(false)
      void bridge?.highlightPrototypeStudioPaths?.([])
      loadHtml(view.committedHtml, view.committedHtml)
      setNotice(t('studio.discardDone'))
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (snapshotId: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    try {
      const restored = await restorePrototypeSnapshot(sessionIdRef.current ?? '', requirementId, snapshotId, invoke)
      await Promise.all([refreshStaged(), refreshSnapshots()])
      loadHtml(restored.html, restored.html)
      setNotice(t('studio.restoreDone'))
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const sendPrompt = async (prompt: string): Promise<boolean> => {
    let sid = sessionIdRef.current
    if (sid === null) {
      const workspaceId = (() => {
        try {
          const raw = localStorage.getItem(PROJECT_KEY)
          const value: unknown = raw === null ? undefined : JSON.parse(raw)
          return isRecord(value) && typeof value.workspaceId === 'string' ? value.workspaceId : undefined
        } catch {
          return undefined
        }
      })()
      const created = await invoke('session', 'create', {
        request: {
          ...(workspaceId === undefined ? {} : { workspaceId }),
          agentPreset: 'maniu-prototype',
        },
      })
      if (!created.ok) {
        setNotice(`${created.error.code}: ${created.error.message}`)
        return false
      }
      const value: unknown = created.value
      if (!isRecord(value) || typeof value.sessionId !== 'string') {
        setNotice(t('studio.sessionCreateFailed'))
        return false
      }
      sid = value.sessionId
      sessionIdRef.current = sid
      setSessionId(sid)
      try {
        localStorage.setItem(`lcoder.studio.session.${requirementId}`, sid)
      } catch {
        // 会话已在内存里生效；存储失败不影响本轮发送。
      }
    }
    const answer = await invoke('session', 'prompt', {
      request: { requestId: requestId(), sessionId: sid, mode: 'queue', content: [{ type: 'text', text: prompt }] },
    })
    if (!answer.ok) {
      setNotice(`${answer.error.code}: ${answer.error.message}`)
      return false
    }
    setNotice(undefined)
    return true
  }

  const sendCoDesign = async (instruction: string, anchors: readonly StudioSelectionInfo[]): Promise<boolean> => {
    const prompt = buildStudioCoDesignPrompt({
      requirementId,
      requirementTitle: requirementId,
      baselineNote: staged === null ? t('studio.baselineCommitted') : t('studio.baselineStaged'),
      instruction,
      anchors,
    })
    return sendPrompt(prompt)
  }

  const isFullscreen = viewMode === 'fullscreen-pinned'

  return (
    <div className={`studio-app${isFullscreen ? ' studio-app-pinned' : ''}`} data-testid="studio-app" data-requirement-id={requirementId}>
      {isFullscreen && (
        <button
          type="button"
          className={floatingCollapsed ? 'studio-floating studio-floating-collapsed' : 'studio-floating'}
          data-testid="studio-floating-collapse"
          aria-expanded={!floatingCollapsed}
          onClick={toggleFloating}
        >
          {floatingCollapsed ? t('studio.collapsedCapsule') : t('studio.expandCapsule')}
        </button>
      )}
      <div className="studio-body" data-testid="studio-body" hidden={isFullscreen && floatingCollapsed}>
        <header className="studio-head">
          <span className="studio-title" data-testid="studio-title">{t('studio.title', { id: requirementId })}</span>
          <button
            type="button"
            className="studio-mode-toggle"
            data-testid="studio-mode-toggle"
            data-mode={viewMode}
            onClick={() => { changeMode(isFullscreen ? 'split' : 'fullscreen-pinned') }}
          >
            {isFullscreen ? t('studio.exitFullscreen') : t('studio.enterFullscreen')}
          </button>
        </header>

        <div className="studio-staged-bar" data-testid="studio-staged-bar" data-staged={staged === null ? 'false' : 'true'}>
          <span className={staged === null ? 'studio-staged-idle' : 'studio-staged-live'} data-testid="studio-staged-state">
            {staged === null ? t('studio.stagedIdle') : t('studio.stagedPending')}
          </span>
          {staged !== null && (
            <>
              <div className="studio-segmented" role="group" aria-label={t('studio.viewSwitch')}>
                <button
                  type="button"
                  className={showingBefore ? 'studio-segment studio-segment-on' : 'studio-segment'}
                  data-testid="studio-view-before"
                  aria-pressed={showingBefore}
                  onClick={() => { switchView(true) }}
                >
                  {t('studio.viewBefore')}
                </button>
                <button
                  type="button"
                  className={!showingBefore ? 'studio-segment studio-segment-on' : 'studio-segment'}
                  data-testid="studio-view-after"
                  aria-pressed={!showingBefore}
                  onClick={() => { switchView(false) }}
                >
                  {t('studio.viewAfter')}
                </button>
              </div>
              <Button size="sm" variant="secondary" data-testid="studio-compare-side-by-side" isDisabled={busy} onPress={compareSideBySide}>
                {t('studio.compareSideBySide')}
              </Button>
              <Button size="sm" variant={highlight ? 'primary' : 'secondary'} data-testid="studio-highlight-toggle" isDisabled={busy} onPress={toggleHighlight}>
                {t('studio.highlightChanges')}
              </Button>
              <Button size="sm" variant="primary" data-testid="studio-commit-staged" isDisabled={busy} onPress={() => { void commit(false, false) }}>
                {t('studio.confirmCommit')}
              </Button>
              <Button size="sm" variant="secondary" data-testid="studio-discard-staged" isDisabled={busy} onPress={() => { void discard() }}>
                {t('studio.discard')}
              </Button>
            </>
          )}
          <button
            type="button"
            className="studio-snapshots-trigger"
            data-testid="studio-snapshots-trigger"
            aria-expanded={snapshotsOpen}
            onClick={() => { setSnapshotsOpen(current => !current) }}
          >
            {t('studio.snapshots')}
          </button>
        </div>

        {snapshotsOpen && (
          <div className="studio-snapshots" data-testid="studio-snapshots">
            {snapshots.length === 0
              ? <p className="studio-empty">{t('studio.snapshotsEmpty')}</p>
              : snapshots.slice(0, 10).map(snapshot => (
                <div key={snapshot.snapshotId} className="studio-snapshot" data-testid="studio-snapshot" data-snapshot-id={snapshot.snapshotId}>
                  <span>{formatTimestamp(snapshot.createdAt)}</span>
                  <span>{t('studio.snapshotBytes', { bytes: snapshot.bytes })}</span>
                  <Button size="sm" variant="secondary" data-testid="studio-snapshot-restore" isDisabled={busy} onPress={() => { void restore(snapshot.snapshotId) }}>
                    {t('studio.restoreSnapshot')}
                  </Button>
                </div>
              ))}
          </div>
        )}

        {staged !== null && (
          <ChangeCard
            t={t}
            staged={staged}
            busy={busy}
            syncStatus={syncStatus}
            onCommit={(applyDiff, amend) => { void commit(applyDiff, amend) }}
            onDiscard={() => { void discard() }}
          />
        )}

        <CoDesignThread
          t={t}
          bridge={bridge}
          sessionId={sessionId}
          onStageComplete={() => { void refreshStaged() }}
          onRunningChange={setTurnRunning}
        />
        <AnchorComposer t={t} bridge={bridge} running={turnRunning || busy} onSend={sendCoDesign} />

        {notice !== undefined && <p className="studio-notice" data-testid="studio-notice">{notice}</p>}
      </div>
    </div>
  )
}
