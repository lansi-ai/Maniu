/**
 * 原型页：项目级统一活原型的实时预览、工作室与独立窗口入口、暂存提示与历史快照。
 *
 * 预览 iframe 固定 `sandbox=""`（无脚本、无同源权限），与需求详情的原型区同一条
 * 隔离规则。页面只读 `prototype/*` Remote，渲染端不直连磁盘或网络。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@heroui/react'
import { History, RefreshCw } from 'lucide-react'

import type { Translate } from '../locale.ts'
import type { PrototypeSnapshotMeta, PrototypeStagedView, UnaryCall } from '../prototype/remote.ts'
import { getStagedPrototype, listPrototypeSnapshots, restorePrototypeSnapshot } from '../prototype/remote.ts'
import { causeText, openPreview, openStudio as openStudioWindow } from '../prototype/open.ts'
import { formatTimestamp } from './requirement-report.ts'

/** 原型页属性。 */
export interface PrototypePageProps {
  readonly t: Translate
  /** 作用域会话号；没有项目时为 null，页面只画空态。 */
  readonly scopeSessionId: string | null
  /** 现有需求编号，按新到旧排列；工作室需要一个需求作为上下文。 */
  readonly requirementIds: readonly string[]
  /** 从需求详情带来的上下文；缺省用最新一条需求。 */
  readonly initialRequirementId?: string | undefined
  /** 跳到需求页新建或查看需求。 */
  readonly onOpenRequirements: () => void
  /** 一元调用注入点；缺省走宿主 preload。 */
  readonly call?: UnaryCall | undefined
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
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  /**
   * 读项目级暂存视图与历史快照；快照读取失败不挡预览。
   * @returns 读取完成。
   */
  const load = useCallback(async (): Promise<void> => {
    if (scopeSessionId === null) {
      setView(null)
      setSnapshots([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      setView(await getStagedPrototype(scopeSessionId, undefined, invoke))
    } catch (cause: unknown) {
      setError(causeText(cause))
    } finally {
      setLoading(false)
    }
    try {
      setSnapshots(await listPrototypeSnapshots(scopeSessionId, undefined, invoke))
    } catch {
      // 快照列表是次要信息：读不到时保留上一次结果，不遮住原型预览。
      setSnapshots([])
    }
  }, [invoke, scopeSessionId])

  useEffect(() => {
    void load()
  }, [load])

  // 工作室是独立窗口：回到主窗时重读，提交后的正式版立刻出现在预览里。
  useEffect(() => {
    const refresh = (): void => { void load() }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [load])

  const staged = view?.staged ?? null
  const committedHtml = view?.committedHtml ?? null
  const html = staged === null ? committedHtml : staged.html
  const studioRequirementId = props.initialRequirementId ?? props.requirementIds[0]

  const openStudio = async (): Promise<void> => {
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

  const openWindow = async (): Promise<void> => {
    if (html === null) return
    setNotice(undefined)
    try {
      await openPreview(html)
    } catch (cause: unknown) {
      setNotice(t('prototypePage.openFailed', { detail: causeText(cause) }))
    }
  }

  const restore = async (snapshotId: string): Promise<void> => {
    if (scopeSessionId === null || busy) return
    setBusy(true)
    setNotice(undefined)
    try {
      const restored = await restorePrototypeSnapshot(scopeSessionId, undefined, snapshotId, invoke)
      setView(current => current === null ? current : { ...current, committedHtml: restored.html })
      setNotice(t('prototypePage.restored', { at: formatTimestamp(restored.restoredAt) }))
      await load()
    } catch (cause: unknown) {
      setError(causeText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page prototype-page" data-testid="page-prototype">
      <header className="page-head">
        <div>
          <h2>{t('prototypePage.title')}</h2>
          <p className="page-sub">{t('prototypePage.subtitle')}</p>
        </div>
        <div className="page-actions">
          <Button
            size="sm"
            variant="ghost"
            data-testid="prototype-page-refresh"
            isDisabled={loading || scopeSessionId === null}
            onPress={() => { void load() }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t('prototypePage.refresh')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="prototype-page-snapshots-toggle"
            aria-expanded={snapshotsOpen}
            onPress={() => { setSnapshotsOpen(current => !current) }}
          >
            <History size={14} aria-hidden="true" />
            {t('prototypePage.snapshots')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="prototype-page-open-window"
            isDisabled={html === null}
            onPress={() => { void openWindow() }}
          >
            {t('prototypePage.openWindow')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            data-testid="prototype-page-open-studio"
            isDisabled={html === null || studioRequirementId === undefined}
            onPress={() => { void openStudio() }}
          >
            {t('prototypePage.openStudio')}
          </Button>
        </div>
      </header>

      {staged !== null && (
        <div className="prototype-page-staged" data-testid="prototype-page-staged-notice" role="status">
          <div className="prototype-page-staged-text">
            <strong>{t('prototypePage.stagedTitle')}</strong>
            <p>{t('prototypePage.stagedBody', { count: staged.summary.length })}</p>
          </div>
          <Button
            size="sm"
            variant="primary"
            data-testid="prototype-page-staged-confirm"
            isDisabled={studioRequirementId === undefined}
            onPress={() => { void openStudio() }}
          >
            {t('prototypePage.stagedConfirm')}
          </Button>
        </div>
      )}

      {studioRequirementId === undefined
        ? <p className="detail-note" data-testid="prototype-page-studio-unavailable">{t('prototypePage.studioUnavailable')}</p>
        : <p className="detail-note" data-testid="prototype-page-studio-context">{t('prototypePage.studioContext', { id: studioRequirementId })}</p>}

      {snapshotsOpen && (
        <div className="info-card prototype-page-snapshots" data-testid="prototype-page-snapshots">
          <h4>{t('prototypePage.snapshots')}</h4>
          {snapshots.length === 0
            ? <p className="empty" data-testid="prototype-page-snapshots-empty">{t('prototypePage.snapshotsEmpty')}</p>
            : (
              <ul className="plain-list compact">
                {snapshots.map(snapshot => (
                  <li
                    key={snapshot.snapshotId}
                    className="prototype-page-snapshot"
                    data-testid="prototype-page-snapshot"
                    data-snapshot-id={snapshot.snapshotId}
                  >
                    <span className="mono">{formatTimestamp(snapshot.createdAt)}</span>
                    <span className="detail-note">{t('prototypePage.snapshotBytes', { bytes: snapshot.bytes })}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid="prototype-page-snapshot-restore"
                      isDisabled={busy}
                      onPress={() => { void restore(snapshot.snapshotId) }}
                    >
                      {t('prototypePage.snapshotRestore')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

      <div className="info-card prototype-page-preview" data-testid="prototype-page-preview">
        {error !== null && (
          <p className="problem" data-testid="prototype-page-error">{t('prototypePage.error', { detail: error })}</p>
        )}
        {html === null
          ? loading
            ? <p className="empty" data-testid="prototype-page-loading">{t('prototypePage.loading')}</p>
            : (
              <div className="prototype-page-empty" data-testid="prototype-page-empty">
                <p>{t('prototypePage.empty')}</p>
                <Button size="sm" variant="secondary" data-testid="prototype-page-empty-action" onPress={props.onOpenRequirements}>
                  {t('prototypePage.emptyAction')}
                </Button>
              </div>
            )
          : (
            <>
              <iframe
                title={t('prototypePage.title')}
                className="prototype-frame prototype-page-frame"
                data-testid="prototype-page-iframe"
                sandbox=""
                srcDoc={html}
              />
              <p className="detail-note" data-testid="prototype-page-preview-note">{t('prototypePage.previewNote')}</p>
            </>
          )}
      </div>

      {notice !== undefined && <p className="detail-note" data-testid="prototype-page-notice">{notice}</p>}
    </section>
  )
}
