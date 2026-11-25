/**
 * 原型页：左窄版本列表（待确认修改 / 当前正式版 / 历史版本）+ 右宽实时画布。
 *
 * 预览 iframe 使用 `sandbox="allow-scripts allow-forms"`（无 `allow-same-origin`）叠加离线 CSP，
 * 实现窗口内直接交互的同时隔离主窗权限与外网请求；页面只读 `prototype/*` Remote，
 * 不直连磁盘或网络，也不展示开发机理黑话。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button, Modal, useOverlayState } from '@heroui/react'
import { Loader2 } from 'lucide-react'

import type { SessionSummary } from '../store.ts'
import { useOpLiveFeeds, type OpLiveFeed } from '../shell/op-live-feed.ts'
import type { Translate } from '../locale.ts'
import type { PrototypeSnapshotMeta, PrototypeStagedView, UnaryCall } from '../prototype/remote.ts'
import {
  commitStagedPrototype,
  discardStagedPrototype,
  getPrototypeSnapshot,
  getStagedPrototype,
  listPrototypeSnapshots,
  restorePrototypeSnapshot,
} from '../prototype/remote.ts'
import { buildProjectPrototypeRegeneratePrompt } from '../prototype/prompt.ts'
import { resolveLibraryCopy, resolvePrototypeLibrary, usePrototypeLibraryState } from '../prototype/libraries.ts'
import { causeText, openStudio as openStudioWindow } from '../prototype/open.ts'
import { PROTOTYPE_INTERACTIVE_SANDBOX, withOfflineInteractiveCsp } from '../prototype/sandbox-html.ts'
import type { RequirementDocRow } from '../spec/rows.ts'
import { PROTOTYPE_PRESET_ID } from '../talents/model.ts'
import { formatTimestamp } from './requirement-report.ts'

/** 原型页属性。 */
export interface PrototypePageProps {
  readonly t: Translate
  /** 作用域会话号；没有项目时为 null，页面只画空态。 */
  readonly scopeSessionId: string | null
  /** 现有需求编号，按新到旧排列；打开协作修改时需要一个需求作为上下文。 */
  readonly requirementIds: readonly string[]
  /** 投影里的需求列表，用于多需求汇总重新生成与增量补充。 */
  readonly requirements?: readonly RequirementDocRow[] | undefined
  /** 会话列表，用于感知后台生成会话完成并自动刷新画布。 */
  readonly sessions?: readonly SessionSummary[] | undefined
  /** 后台发起一条 maniu-prototype 会话。 */
  readonly onStartSession?: ((
    prompt: string,
    agentPreset?: string,
  ) => Promise<{ readonly ok: boolean; readonly message: string; readonly sessionId?: string }>) | undefined
  /** 跳转到指定会话查看生成过程。 */
  readonly onOpenSession?: ((sessionId: string) => void) | undefined
  /** 从需求详情带来的上下文；缺省用最新一条需求。 */
  readonly initialRequirementId?: string | undefined
  /** 当前页面是否处于可见态；从其它页面切回时刷新一次。 */
  readonly visible?: boolean | undefined
  /** 跳到需求页新建或查看需求。 */
  readonly onOpenRequirements: () => void
  /** 一元调用注入点；缺省走宿主 preload。 */
  readonly call?: UnaryCall | undefined
}

type RegenMode = 'all' | 'single' | 'incremental'

function requirementStateLabel(state: RequirementDocRow['state'], t: Translate): string {
  if (state === 'confirmed') return t('prototypePage.regenStateConfirmed')
  if (state === 'released') return t('prototypePage.regenStateReleased')
  return t('prototypePage.regenStateDraft')
}

function livePhaseText(feed: OpLiveFeed | undefined, t: Translate): string {
  if (feed === undefined || feed.phase === 'connecting') return t('prototypePage.regenPhaseConnecting')
  if (feed.phase === 'thinking') return t('prototypePage.regenPhaseThinking')
  if (feed.phase === 'streaming') return t('prototypePage.regenPhaseStreaming')
  if (feed.phase === 'retrying') return t('prototypePage.regenPhaseRetrying', { attempt: feed.retryAttempt ?? 1 })
  if (feed.phase === 'tool-streaming' || feed.phase === 'tool-running') {
    const tool = feed.toolName ?? 'prototype_stage'
    if (feed.toolChars !== undefined && feed.toolChars > 0) {
      return t('prototypePage.regenPhaseToolChars', { tool, chars: feed.toolChars })
    }
    return t('prototypePage.regenPhaseTool', { tool })
  }
  return t('prototypePage.regenBanner')
}

type VersionSelection =
  | { readonly kind: 'staged' }
  | { readonly kind: 'committed' }
  | { readonly kind: 'snapshot'; readonly snapshotId: string }

function formatLocalTimestamp(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return formatTimestamp(iso)
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultSelectionOf(
  view: PrototypeStagedView | null,
  snapshots: readonly PrototypeSnapshotMeta[],
): VersionSelection | null {
  if (view?.staged !== null && view?.staged !== undefined) return { kind: 'staged' }
  if (view?.committedHtml !== null && view?.committedHtml !== undefined) return { kind: 'committed' }
  const first = snapshots[0]
  return first === undefined ? null : { kind: 'snapshot', snapshotId: first.snapshotId }
}

function isSelectionValid(
  selection: VersionSelection | null,
  view: PrototypeStagedView | null,
  snapshots: readonly PrototypeSnapshotMeta[],
): boolean {
  if (selection === null) return false
  if (selection.kind === 'staged') return view?.staged !== null && view?.staged !== undefined
  if (selection.kind === 'committed') return view?.committedHtml !== null && view?.committedHtml !== undefined
  return snapshots.some(item => item.snapshotId === selection.snapshotId)
}

/**
 * 画出项目级统一活原型页。
 * @param props - 作用域会话、需求上下文与宿主调用。
 * @returns 原型页。
 */
export function PrototypePage(props: PrototypePageProps): JSX.Element {
  const t = props.t
  const scopeSessionId = props.scopeSessionId
  // 默认调用闭包按 props.call 记忆：否则每次渲染都换新函数，load 跟着换身份，effect 会反复重读。
  const invoke = useMemo<UnaryCall>(
    () => props.call ?? ((namespace, method, args) => window.lcoder.call(namespace, method, args)),
    [props.call],
  )
  const [view, setView] = useState<PrototypeStagedView | null>(null)
  const [snapshots, setSnapshots] = useState<readonly PrototypeSnapshotMeta[]>([])
  const [selection, setSelection] = useState<VersionSelection | null>(null)
  const [snapshotCache, setSnapshotCache] = useState<Readonly<Record<string, string>>>({})
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenMode, setRegenMode] = useState<RegenMode>('all')
  const [includeDraft, setIncludeDraft] = useState(true)
  const [targetRequirementId, setTargetRequirementId] = useState('')
  const [extraInstruction, setExtraInstruction] = useState('')
  const [submittingRegen, setSubmittingRegen] = useState(false)
  const [generatingSessionId, setGeneratingSessionId] = useState<string | null>(null)
  const [lastSessionId, setLastSessionId] = useState<string | null>(null)
  const [noticeHasSessionLink, setNoticeHasSessionLink] = useState(false)
  const sawGeneratingRunningRef = useRef(false)
  const baselineStagedAtRef = useRef<string | null>(null)
  const liveSessionIds = useMemo(
    () => (generatingSessionId === null ? [] : [generatingSessionId]),
    [generatingSessionId],
  )
  const liveFeeds = useOpLiveFeeds(liveSessionIds)
  const activeFeed = generatingSessionId === null ? undefined : liveFeeds[generatingSessionId]
  const libraryState = usePrototypeLibraryState()
  const [selectedLibraryId, setSelectedLibraryId] = useState(libraryState.defaultLibraryId)
  const activeLibrary = useMemo(() => {
    const lib = resolvePrototypeLibrary(selectedLibraryId, libraryState)
    const copy = resolveLibraryCopy(lib, t)
    return { ...lib, name: copy.name, summary: copy.summary }
  }, [libraryState, selectedLibraryId, t])
  const regenOverlay = useOverlayState({
    isOpen: regenOpen,
    onOpenChange: (open) => {
      if (!submittingRegen) setRegenOpen(open)
    },
  })

  /**
   * 读项目级暂存视图与历史快照；快照读取失败不挡预览。
   * @param preferStaged - 为 true 且存在待确认修改时强制切换到待确认修改视图。
   * @returns 最新暂存视图。
   */
  const load = useCallback(async (preferStaged = false): Promise<PrototypeStagedView | null> => {
    if (scopeSessionId === null) {
      setView(null)
      setSnapshots([])
      setSelection(null)
      return null
    }
    setLoading(true)
    setError(null)
    let nextView: PrototypeStagedView | null = null
    try {
      nextView = await getStagedPrototype(scopeSessionId, undefined, invoke)
      setView(nextView)
    } catch (cause: unknown) {
      setError(causeText(cause))
    } finally {
      setLoading(false)
    }
    let nextSnapshots: readonly PrototypeSnapshotMeta[] = []
    try {
      nextSnapshots = await listPrototypeSnapshots(scopeSessionId, undefined, invoke)
      setSnapshots(nextSnapshots)
    } catch {
      setSnapshots([])
    }
    if (nextView !== null) {
      if (preferStaged && nextView.staged !== null) {
        setSelection({ kind: 'staged' })
      } else {
        setSelection(current => (
          isSelectionValid(current, nextView, nextSnapshots)
            ? current
            : defaultSelectionOf(nextView, nextSnapshots)
        ))
      }
    }
    return nextView
  }, [invoke, scopeSessionId])

  useEffect(() => {
    setSnapshotCache({})
    void load()
  }, [load])

  useEffect(() => {
    if (props.visible === true) void load()
  }, [load, props.visible])

  // 独立协作窗提交/放弃后切回主窗时自动刷新。
  useEffect(() => {
    const refresh = (): void => { void load() }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [load])

  const staged = view?.staged ?? null
  const committedHtml = view?.committedHtml ?? null
  const hasPrototype = staged !== null || committedHtml !== null
  const studioRequirementId = props.initialRequirementId ?? props.requirementIds[0]
  const activeSelection = selection ?? defaultSelectionOf(view, snapshots)

  const openStudio = async (): Promise<void> => {
    const html = staged?.html ?? committedHtml
    if (html === null || studioRequirementId === undefined) return
    setNotice(undefined)
    try {
      await openStudioWindow({
        requirementId: studioRequirementId,
        ...(scopeSessionId === null ? {} : { sessionId: scopeSessionId }),
        html,
        beforeHtml: committedHtml ?? html,
      })
    } catch (cause: unknown) {
      setNotice(t('prototypePage.openFailed', { detail: causeText(cause) }))
    }
  }

  const selectVersion = async (next: VersionSelection): Promise<void> => {
    setSelection(next)
    setNotice(undefined)
    if (next.kind !== 'snapshot' || scopeSessionId === null) return
    if (snapshotCache[next.snapshotId] !== undefined) return
    setSnapshotLoading(true)
    setError(null)
    try {
      const value = await getPrototypeSnapshot(scopeSessionId, undefined, next.snapshotId, invoke)
      setSnapshotCache(current => ({ ...current, [next.snapshotId]: value.html }))
    } catch (cause: unknown) {
      setError(causeText(cause))
    } finally {
      setSnapshotLoading(false)
    }
  }

  const commitStaged = async (): Promise<void> => {
    if (scopeSessionId === null || busy) return
    setBusy(true)
    setError(null)
    setNotice(undefined)
    try {
      await commitStagedPrototype({ sessionId: scopeSessionId }, invoke)
      setSelection({ kind: 'committed' })
      setNotice(t('prototypePage.committed'))
      await load()
    } catch (cause: unknown) {
      setError(causeText(cause))
    } finally {
      setBusy(false)
    }
  }

  const discardStaged = async (): Promise<void> => {
    if (scopeSessionId === null || busy) return
    setBusy(true)
    setError(null)
    setNotice(undefined)
    try {
      await discardStagedPrototype(scopeSessionId, undefined, invoke)
      setSelection({ kind: 'committed' })
      setNotice(t('prototypePage.discarded'))
      await load()
    } catch (cause: unknown) {
      setError(causeText(cause))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (snapshotId: string): Promise<void> => {
    if (scopeSessionId === null || busy) return
    setBusy(true)
    setError(null)
    setNotice(undefined)
    try {
      const restored = await restorePrototypeSnapshot(scopeSessionId, undefined, snapshotId, invoke)
      setView(current => current === null ? current : { ...current, committedHtml: restored.html })
      setSelection({ kind: 'committed' })
      setNotice(t('prototypePage.restored', { at: formatLocalTimestamp(restored.restoredAt) }))
      await load()
    } catch (cause: unknown) {
      setError(causeText(cause))
    } finally {
      setBusy(false)
    }
  }

  const activeRequirements = useMemo(
    () => (props.requirements ?? []).filter(row => row.state !== 'closed'),
    [props.requirements],
  )
  const allModeRequirements = useMemo(
    () => (includeDraft
      ? activeRequirements
      : activeRequirements.filter(row => row.state === 'confirmed' || row.state === 'released')),
    [activeRequirements, includeDraft],
  )
  const selectedTargetRequirement = useMemo(
    () => activeRequirements.find(row => row.id === targetRequirementId) ?? activeRequirements[0],
    [activeRequirements, targetRequirementId],
  )
  const canStartGenerate = props.onStartSession !== undefined && activeRequirements.length > 0
  const isGenerating = generatingSessionId !== null

  const finishGenerating = useCallback(async (turnEnd?: OpLiveFeed['turnEnd']): Promise<void> => {
    sawGeneratingRunningRef.current = false
    setGeneratingSessionId(null)
    const nextView = await load(true)
    const hasNewStaged = nextView?.staged !== null && nextView?.staged !== undefined
      && nextView.staged.createdAt !== baselineStagedAtRef.current
    if (hasNewStaged) {
      setNoticeHasSessionLink(false)
      setNotice(t('prototypePage.regenFinished'))
      return
    }
    setNoticeHasSessionLink(true)
    if (turnEnd?.kind === 'error') {
      setNotice(t('prototypePage.regenStartFailed', { detail: turnEnd.message }))
      return
    }
    if (turnEnd?.kind === 'max-tokens') {
      setNotice(t('prototypePage.regenTruncated'))
      return
    }
    setNotice(t('prototypePage.regenNoResult'))
  }, [load, t])

  useEffect(() => {
    if (generatingSessionId === null || activeFeed?.turnEnd === undefined) return
    void finishGenerating(activeFeed.turnEnd)
  }, [activeFeed?.turnEnd, finishGenerating, generatingSessionId])

  useEffect(() => {
    if (generatingSessionId === null || props.sessions === undefined) return
    const session = props.sessions.find(item => item.sessionId === generatingSessionId)
    if (session?.running === true) {
      sawGeneratingRunningRef.current = true
      return
    }
    if (sawGeneratingRunningRef.current) {
      void finishGenerating(activeFeed?.turnEnd)
    }
  }, [activeFeed?.turnEnd, finishGenerating, generatingSessionId, props.sessions])

  // 兜底轮询：即使会话状态推送延迟或漏帧，一旦暂存原型落盘就立即切换预览。
  useEffect(() => {
    if (generatingSessionId === null || scopeSessionId === null) return
    const timer = window.setInterval(() => {
      void getStagedPrototype(scopeSessionId, undefined, invoke).then((nextView) => {
        if (nextView.staged !== null && nextView.staged.createdAt !== baselineStagedAtRef.current) {
          void finishGenerating()
        }
      }).catch(() => {
        // 轮询期间偶发读取失败忽略，等待下一轮或会话结束事件。
      })
    }, 2500)
    return () => { window.clearInterval(timer) }
  }, [finishGenerating, generatingSessionId, invoke, scopeSessionId])

  const openRegenModal = (): void => {
    if (isGenerating || busy || activeRequirements.length === 0) return
    const defaultTarget = (studioRequirementId !== undefined && activeRequirements.some(row => row.id === studioRequirementId))
      ? studioRequirementId
      : activeRequirements[0]?.id ?? ''
    setRegenMode('all')
    setIncludeDraft(true)
    setTargetRequirementId(defaultTarget)
    setSelectedLibraryId(libraryState.defaultLibraryId)
    setExtraInstruction('')
    setRegenOpen(true)
  }

  const submitRegenerate = async (): Promise<void> => {
    if (props.onStartSession === undefined || submittingRegen || isGenerating) return
    let prompt: string | null = null
    if (regenMode === 'all') {
      if (allModeRequirements.length === 0) return
      prompt = buildProjectPrototypeRegeneratePrompt({
        mode: 'all',
        requirements: allModeRequirements.map(row => ({
          id: row.id,
          title: row.title ?? row.id,
          state: requirementStateLabel(row.state, t),
          text: row.text,
        })),
        library: activeLibrary,
        extraInstruction,
      })
    } else if (regenMode === 'single') {
      if (selectedTargetRequirement === undefined) return
      prompt = buildProjectPrototypeRegeneratePrompt({
        mode: 'single',
        requirement: {
          id: selectedTargetRequirement.id,
          title: selectedTargetRequirement.title ?? selectedTargetRequirement.id,
          state: requirementStateLabel(selectedTargetRequirement.state, t),
          text: selectedTargetRequirement.text,
        },
        library: activeLibrary,
        extraInstruction,
      })
    } else {
      if (selectedTargetRequirement === undefined || committedHtml === null) return
      prompt = buildProjectPrototypeRegeneratePrompt({
        mode: 'incremental',
        requirement: {
          id: selectedTargetRequirement.id,
          title: selectedTargetRequirement.title ?? selectedTargetRequirement.id,
          state: requirementStateLabel(selectedTargetRequirement.state, t),
          text: selectedTargetRequirement.text,
        },
        currentHtml: committedHtml,
        library: activeLibrary,
        extraInstruction,
      })
    }
    setSubmittingRegen(true)
    setError(null)
    setNotice(undefined)
    setNoticeHasSessionLink(false)
    baselineStagedAtRef.current = staged?.createdAt ?? null
    try {
      const result = await props.onStartSession(prompt, PROTOTYPE_PRESET_ID)
      if (!result.ok) {
        setNotice(t('prototypePage.regenStartFailed', { detail: result.message }))
        return
      }
      setRegenOpen(false)
      setNotice(t('prototypePage.regenStarted'))
      if (result.sessionId !== undefined) {
        sawGeneratingRunningRef.current = false
        setLastSessionId(result.sessionId)
        setGeneratingSessionId(result.sessionId)
      }
    } catch (cause: unknown) {
      setNotice(t('prototypePage.regenStartFailed', { detail: causeText(cause) }))
    } finally {
      setSubmittingRegen(false)
    }
  }

  const activeSnapshot = activeSelection?.kind === 'snapshot'
    ? snapshots.find(item => item.snapshotId === activeSelection.snapshotId)
    : undefined
  const activeHtml = activeSelection?.kind === 'staged'
    ? staged?.html ?? null
    : activeSelection?.kind === 'committed'
      ? committedHtml
      : activeSelection?.kind === 'snapshot'
        ? snapshotCache[activeSelection.snapshotId] ?? null
        : null
  const interactiveHtml = useMemo(
    () => (activeHtml === null ? null : withOfflineInteractiveCsp(activeHtml)),
    [activeHtml],
  )
  const activeBarTitle = activeSelection?.kind === 'staged'
    ? t('prototypePage.versionStaged')
    : activeSelection?.kind === 'committed'
      ? t('prototypePage.versionCommitted')
      : activeSnapshot !== undefined
        ? formatLocalTimestamp(activeSnapshot.createdAt)
        : t('prototypePage.title')

  return (
    <section className="page prototype-page" data-testid="page-prototype">
      <header className="page-head prototype-page-head">
        <h2>{t('prototypePage.title')}</h2>
      </header>

      {error !== null && (
        <p className="problem" data-testid="prototype-page-error">{t('prototypePage.error', { detail: error })}</p>
      )}
      {generatingSessionId !== null && (
        <div className="prototype-generating-bar" data-testid="prototype-generating-bar" role="status">
          <span className="prototype-generating-bar-main">
            <Loader2 className="prototype-spin" size={15} aria-hidden="true" />
            <span className="prototype-generating-text">
              <span>{livePhaseText(activeFeed, t)}</span>
              {activeFeed !== undefined && activeFeed.snippet.trim() !== '' && (
                <span className="prototype-generating-snippet" data-testid="prototype-generating-snippet">
                  {activeFeed.snippet}
                </span>
              )}
            </span>
          </span>
          {props.onOpenSession !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="prototype-generating-view-session"
              onPress={() => { props.onOpenSession?.(generatingSessionId) }}
            >
              {t('prototypePage.regenViewSession')}
            </Button>
          )}
        </div>
      )}
      {!isGenerating && notice !== undefined && (
        <div className="prototype-generating-bar" data-testid="prototype-page-notice-row">
          <p className="detail-note" data-testid="prototype-page-notice">{notice}</p>
          {noticeHasSessionLink && props.onOpenSession !== undefined && lastSessionId !== null && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="prototype-no-result-view-session"
              onPress={() => { props.onOpenSession?.(lastSessionId) }}
            >
              {t('prototypePage.regenViewSession')}
            </Button>
          )}
        </div>
      )}

      {!hasPrototype
        ? (
          <div className="prototype-page-empty-wrap">
            {loading
              ? <p className="empty" data-testid="prototype-page-loading">{t('prototypePage.loading')}</p>
              : (
                <div className="info-card prototype-page-empty" data-testid="prototype-page-empty">
                  <p>{t('prototypePage.empty')}</p>
                  <div className="prototype-page-empty-actions">
                    {canStartGenerate && (
                      <Button
                        size="sm"
                        variant="primary"
                        {...(isGenerating ? { className: 'prototype-regen-btn-loading' } : {})}
                        data-testid="prototype-page-empty-generate"
                        isDisabled={isGenerating || busy}
                        onPress={openRegenModal}
                      >
                        {isGenerating && <Loader2 className="prototype-spin" size={14} aria-hidden="true" />}
                        <span>{isGenerating ? t('prototypePage.actionRegenerateRunning') : t('prototypePage.emptyGenerate')}</span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={canStartGenerate ? 'secondary' : 'primary'}
                      data-testid="prototype-page-empty-action"
                      onPress={props.onOpenRequirements}
                    >
                      {t('prototypePage.emptyAction')}
                    </Button>
                  </div>
                </div>
              )}
          </div>
        )
        : (
          <div className="prototype-page-workspace" data-testid="prototype-page-workspace">
            <aside className="info-card prototype-version-list" data-testid="prototype-version-list" aria-label={t('prototypePage.versionsAria')}>
              <div className="prototype-version-primary">
                {staged !== null && (
                  <button
                    type="button"
                    className={`prototype-version-item${activeSelection?.kind === 'staged' ? ' prototype-version-item-active' : ''}`}
                    data-testid="prototype-version-staged"
                    aria-current={activeSelection?.kind === 'staged' ? 'true' : undefined}
                    onClick={() => { void selectVersion({ kind: 'staged' }) }}
                  >
                    <span className="prototype-version-dot" aria-hidden="true" />
                    <span className="prototype-version-label">{t('prototypePage.versionStaged')}</span>
                  </button>
                )}
                {committedHtml !== null && (
                  <button
                    type="button"
                    className={`prototype-version-item${activeSelection?.kind === 'committed' ? ' prototype-version-item-active' : ''}`}
                    data-testid="prototype-version-committed"
                    aria-current={activeSelection?.kind === 'committed' ? 'true' : undefined}
                    onClick={() => { void selectVersion({ kind: 'committed' }) }}
                  >
                    <span className="prototype-version-label">{t('prototypePage.versionCommitted')}</span>
                  </button>
                )}
              </div>

              <div className="prototype-version-history">
                <h4 className="prototype-version-heading">{t('prototypePage.historyHeading')}</h4>
                {snapshots.length === 0
                  ? <p className="prototype-version-empty" data-testid="prototype-version-history-empty">{t('prototypePage.historyEmptyHint')}</p>
                  : (
                    <ul className="prototype-version-snapshots">
                      {snapshots.map((snapshot) => {
                        const isActive = activeSelection?.kind === 'snapshot' && activeSelection.snapshotId === snapshot.snapshotId
                        return (
                          <li key={snapshot.snapshotId}>
                            <button
                              type="button"
                              className={`prototype-version-item${isActive ? ' prototype-version-item-active' : ''}`}
                              data-testid="prototype-version-snapshot"
                              data-snapshot-id={snapshot.snapshotId}
                              aria-current={isActive ? 'true' : undefined}
                              onClick={() => { void selectVersion({ kind: 'snapshot', snapshotId: snapshot.snapshotId }) }}
                            >
                              <span className="mono prototype-version-time">{formatLocalTimestamp(snapshot.createdAt)}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
              </div>
            </aside>

            <div className="info-card prototype-canvas" data-testid="prototype-page-preview">
              <div className="prototype-canvas-bar" data-testid="prototype-canvas-bar">
                <strong className="prototype-canvas-title" data-testid="prototype-canvas-title">{activeBarTitle}</strong>
                <div className="prototype-canvas-actions">
                  {activeSelection?.kind === 'staged' && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid="prototype-action-continue"
                        isDisabled={busy || studioRequirementId === undefined}
                        onPress={() => { void openStudio() }}
                      >
                        {t('prototypePage.actionContinue')}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        data-testid="prototype-action-commit"
                        isDisabled={busy || scopeSessionId === null}
                        onPress={() => { void commitStaged() }}
                      >
                        {t('prototypePage.actionCommit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid="prototype-action-discard"
                        isDisabled={busy || scopeSessionId === null}
                        onPress={() => { void discardStaged() }}
                      >
                        {t('prototypePage.actionDiscard')}
                      </Button>
                    </>
                  )}
                  {staged !== null && (activeSelection?.kind === 'committed' || (activeSelection?.kind === 'snapshot' && activeSnapshot !== undefined)) && (
                    <>
                      <span className="prototype-canvas-hint" data-testid="prototype-pending-hint">
                        {t('prototypePage.pendingHint')}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid="prototype-action-go-pending"
                        isDisabled={busy}
                        onPress={() => { void selectVersion({ kind: 'staged' }) }}
                      >
                        {t('prototypePage.actionGoPending')}
                      </Button>
                    </>
                  )}
                  {staged === null && activeSelection?.kind === 'committed' && (
                    <>
                      {props.onStartSession !== undefined && (
                        <Button
                          size="sm"
                          variant="secondary"
                          {...(isGenerating ? { className: 'prototype-regen-btn-loading' } : {})}
                          data-testid="prototype-action-regenerate"
                          isDisabled={busy || isGenerating || activeRequirements.length === 0}
                          onPress={openRegenModal}
                        >
                          {isGenerating && <Loader2 className="prototype-spin" size={14} aria-hidden="true" />}
                          <span>{isGenerating ? t('prototypePage.actionRegenerateRunning') : t('prototypePage.actionRegenerate')}</span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="primary"
                        data-testid="prototype-action-edit"
                        isDisabled={busy || isGenerating || studioRequirementId === undefined}
                        onPress={() => { void openStudio() }}
                      >
                        {t('prototypePage.actionEdit')}
                      </Button>
                    </>
                  )}
                  {staged === null && activeSelection?.kind === 'snapshot' && activeSnapshot !== undefined && (
                    <Button
                      size="sm"
                      variant="primary"
                      data-testid="prototype-action-restore"
                      isDisabled={busy || scopeSessionId === null}
                      onPress={() => { void restore(activeSnapshot.snapshotId) }}
                    >
                      {t('prototypePage.actionRestore')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="prototype-canvas-stage">
                {snapshotLoading && activeHtml === null
                  ? <p className="empty prototype-canvas-loading" data-testid="prototype-snapshot-loading">{t('prototypePage.snapshotLoading')}</p>
                  : interactiveHtml !== null
                    ? (
                      <iframe
                        title={t('prototypePage.title')}
                        className="prototype-frame prototype-page-frame"
                        data-testid="prototype-page-iframe"
                        sandbox={PROTOTYPE_INTERACTIVE_SANDBOX}
                        srcDoc={interactiveHtml}
                      />
                    )
                    : null}
              </div>
            </div>
          </div>
        )}

      <Modal.Root state={regenOverlay}>
        <Modal.Backdrop isDismissable={!submittingRegen} variant="transparent" className="glass-modal-backdrop">
          <Modal.Container placement="center" size="md" className="glass-modal">
            <Modal.Dialog className="glass-modal-panel" data-testid="prototype-regen-modal">
              <Modal.Header>
                <Modal.Heading>
                  {committedHtml === null ? t('prototypePage.regenModalTitleCreate') : t('prototypePage.regenModalTitle')}
                </Modal.Heading>
                <Modal.CloseTrigger data-testid="prototype-regen-close" aria-label={t('prototypePage.regenCloseAria')} />
              </Modal.Header>
              <Modal.Body>
                <div className="prototype-regen-form">
                  <div className="prototype-regen-field">
                    <span className="prototype-regen-label">{t('prototypePage.regenModeLabel')}</span>
                    <div className="prototype-regen-modes" role="radiogroup" aria-label={t('prototypePage.regenModeLabel')}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={regenMode === 'all'}
                        data-selected={regenMode === 'all' ? 'true' : 'false'}
                        data-testid="prototype-regen-mode-all"
                        className="prototype-regen-mode"
                        onClick={() => { setRegenMode('all') }}
                      >
                        <span className="prototype-regen-mode-title">{t('prototypePage.regenModeAllTitle')}</span>
                        <span className="prototype-regen-mode-desc">{t('prototypePage.regenModeAllDesc')}</span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={regenMode === 'single'}
                        data-selected={regenMode === 'single' ? 'true' : 'false'}
                        data-testid="prototype-regen-mode-single"
                        className="prototype-regen-mode"
                        onClick={() => { setRegenMode('single') }}
                      >
                        <span className="prototype-regen-mode-title">{t('prototypePage.regenModeSingleTitle')}</span>
                        <span className="prototype-regen-mode-desc">{t('prototypePage.regenModeSingleDesc')}</span>
                      </button>
                      {committedHtml !== null && (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={regenMode === 'incremental'}
                          data-selected={regenMode === 'incremental' ? 'true' : 'false'}
                          data-testid="prototype-regen-mode-incremental"
                          className="prototype-regen-mode"
                          onClick={() => { setRegenMode('incremental') }}
                        >
                          <span className="prototype-regen-mode-title">{t('prototypePage.regenModeIncrementalTitle')}</span>
                          <span className="prototype-regen-mode-desc">{t('prototypePage.regenModeIncrementalDesc')}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {regenMode === 'all' && (
                    <div className="prototype-regen-field" data-testid="prototype-regen-all-options">
                      <label className="prototype-regen-check">
                        <input
                          type="checkbox"
                          data-testid="prototype-regen-include-draft"
                          checked={includeDraft}
                          onChange={(event) => { setIncludeDraft(event.target.checked) }}
                        />
                        <span>{t('prototypePage.regenIncludeDraft')}</span>
                      </label>
                      {allModeRequirements.length > 0
                        ? (
                          <p className="detail-note" data-testid="prototype-regen-matched">
                            {t('prototypePage.regenAllMatched', {
                              count: allModeRequirements.length,
                              ids: allModeRequirements.map(row => row.id).join(', '),
                            })}
                          </p>
                        )
                        : (
                          <p className="problem" data-testid="prototype-regen-all-empty">
                            {t('prototypePage.regenAllEmpty')}
                          </p>
                        )}
                    </div>
                  )}

                  {(regenMode === 'single' || regenMode === 'incremental') && (
                    <label className="prototype-regen-field">
                      <span className="prototype-regen-label">{t('prototypePage.regenTargetLabel')}</span>
                      <select
                        className="prototype-regen-select"
                        data-testid="prototype-regen-target-select"
                        value={selectedTargetRequirement?.id ?? ''}
                        onChange={(event) => { setTargetRequirementId(event.target.value) }}
                      >
                        {activeRequirements.map(row => (
                          <option key={row.id} value={row.id}>
                            {row.id}{row.title !== undefined && row.title !== '' ? ` · ${row.title}` : ''} ({requirementStateLabel(row.state, t)})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="prototype-regen-field">
                    <span className="prototype-regen-label">{t('prototypePage.regenLibraryLabel')}</span>
                    <select
                      className="prototype-regen-select"
                      data-testid="prototype-regen-library-select"
                      value={activeLibrary.id}
                      onChange={(event) => { setSelectedLibraryId(event.target.value) }}
                    >
                      {libraryState.libraries.map((lib) => {
                        const copy = resolveLibraryCopy(lib, t)
                        return (
                          <option key={lib.id} value={lib.id}>
                            {copy.name}
                          </option>
                        )
                      })}
                    </select>
                    <span className="detail-note" data-testid="prototype-regen-library-summary">{activeLibrary.summary}</span>
                  </label>

                  <label className="prototype-regen-field">
                    <span className="prototype-regen-label">{t('prototypePage.regenExtraLabel')}</span>
                    <textarea
                      className="prototype-regen-textarea"
                      data-testid="prototype-regen-extra"
                      value={extraInstruction}
                      placeholder={t('prototypePage.regenExtraPlaceholder')}
                      onChange={(event) => { setExtraInstruction(event.target.value) }}
                    />
                  </label>

                  {activeRequirements.length === 0 && (
                    <p className="problem" data-testid="prototype-regen-no-requirements">{t('prototypePage.regenNoRequirements')}</p>
                  )}

                  <div className="prototype-regen-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="prototype-regen-cancel"
                      isDisabled={submittingRegen}
                      onPress={() => { setRegenOpen(false) }}
                    >
                      {t('prototypePage.regenCancel')}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      data-testid="prototype-regen-submit"
                      isDisabled={
                        submittingRegen
                        || isGenerating
                        || (regenMode === 'all' ? allModeRequirements.length === 0 : selectedTargetRequirement === undefined)
                      }
                      onPress={() => { void submitRegenerate() }}
                    >
                      {t('prototypePage.regenSubmit')}
                    </Button>
                  </div>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </section>
  )
}
