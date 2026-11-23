/**
 * 暂存改动卡：视觉调整与需求变更两种形态。
 * 需求正文 Diff 直接复用 spec/diff 的 diffLines，不另写比较算法。
 */

import { useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { Button } from '@heroui/react'
import type { RequirementSyncStatus, StagedPrototype } from '../prototype/remote.ts'
import { diffLines } from '../spec/diff.ts'
import type { MessageKey, Translate } from '../locale.ts'

/** 改动卡属性。 */
export interface ChangeCardProps {
  readonly t: Translate
  readonly staged: StagedPrototype
  readonly busy: boolean
  /** 最近一次落盘的需求同步回执；未落盘时不传。 */
  readonly syncStatus?: RequirementSyncStatus | undefined
  /** applyRequirementDiff 为真表示同步需求正文，amend 为真时用 amend 模式。 */
  readonly onCommit: (applyRequirementDiff: boolean, amend: boolean) => void
  readonly onDiscard: () => void
}

/**
 * 把同步回执映射成词典键；信封里的未知值按 none 处理。
 * @param status - 宿主回执的同步状态。
 * @returns 对应的消息键。
 */
function syncMessageKey(status: RequirementSyncStatus): MessageKey {
  switch (status) {
    case 'patched': return 'studio.sync.patched'
    case 'amended': return 'studio.sync.amended'
    case 'skipped_pending': return 'studio.sync.skippedPending'
    case 'skipped_locked': return 'studio.sync.skippedLocked'
    case 'none': return 'studio.sync.none'
  }
}

/**
 * 画一张暂存改动卡。
 * @param props - 暂存条目、忙碌与提交/放弃回调。
 * @returns 改动卡。
 */
export function ChangeCard(props: ChangeCardProps): JSX.Element {
  const { t, staged, busy, syncStatus } = props
  const [diffOpen, setDiffOpen] = useState(false)
  const [amend, setAmend] = useState(false)
  const isBusiness = staged.changeKind === 'business' || staged.requirementDiff !== undefined

  const summaryList = (
    <ul className="studio-summary" data-testid="studio-change-summary">
      {staged.summary.map((item, index) => <li key={`${String(index)}-${item}`}>{item}</li>)}
    </ul>
  )

  const statusLine = syncStatus === undefined
    ? null
    : <p className="studio-sync" data-testid="studio-change-sync" data-sync={syncStatus}>{t('studio.requirementSync', { status: t(syncMessageKey(syncStatus)) })}</p>

  if (!isBusiness) {
    return (
      <CardFrame testId="studio-change-card-visual" title={t('studio.changeVisual')}>
        {summaryList}
        <p className="studio-meta" data-testid="studio-change-dom-count">{t('studio.domAreaCount', { count: staged.changedDomPaths.length })}</p>
        {statusLine}
        <div className="studio-card-actions">
          <Button size="sm" variant="primary" data-testid="studio-change-card-confirm" isDisabled={busy} onPress={() => { props.onCommit(false, false) }}>
            {t('studio.confirmCommit')}
          </Button>
          <Button size="sm" variant="secondary" data-testid="studio-change-card-discard" isDisabled={busy} onPress={() => { props.onDiscard() }}>
            {t('studio.discard')}
          </Button>
        </div>
      </CardFrame>
    )
  }

  const diff = staged.requirementDiff
  return (
    <CardFrame testId="studio-change-card-business" title={t('studio.changeBusiness')}>
      {summaryList}
      {diff === undefined
        ? null
        : (
          <>
            <p className="studio-meta" data-testid="studio-change-requirement-summary">{diff.summary}</p>
            <button
              type="button"
              className="studio-diff-toggle"
              data-testid="studio-diff-toggle"
              aria-expanded={diffOpen}
              onClick={() => { setDiffOpen(current => !current) }}
            >
              {diffOpen ? t('studio.diffCollapse') : t('studio.diffExpand')}
            </button>
            {diffOpen && (
              <div className="studio-diff" data-testid="studio-requirement-diff">
                {diffLines(diff.baseContent, diff.proposedContent).map((line, index) => (
                  <p key={`${String(index)}-${line.kind}`} className={`studio-diff-line studio-diff-${line.kind}`} data-testid="studio-diff-line" data-kind={line.kind}>
                    <code>{line.kind === 'added' ? `+ ${line.text}` : line.kind === 'removed' ? `- ${line.text}` : `  ${line.text}`}</code>
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      <label className="studio-amend">
        <input
          type="checkbox"
          data-testid="studio-amend-toggle"
          checked={amend}
          onChange={(event) => { setAmend(event.target.checked) }}
        />
        <span>{t('studio.amendMode')}</span>
      </label>
      {statusLine}
      <div className="studio-card-actions">
        <Button size="sm" variant="primary" data-testid="studio-change-card-confirm-sync" isDisabled={busy} onPress={() => { props.onCommit(true, amend) }}>
          {t('studio.confirmCommitSync')}
        </Button>
        <Button size="sm" variant="secondary" data-testid="studio-change-card-commit-only" isDisabled={busy} onPress={() => { props.onCommit(false, false) }}>
          {t('studio.commitOnly')}
        </Button>
        <Button size="sm" variant="secondary" data-testid="studio-change-card-discard" isDisabled={busy} onPress={() => { props.onDiscard() }}>
          {t('studio.discard')}
        </Button>
      </div>
    </CardFrame>
  )
}

/**
 * 改动卡外框：两种形态共用标题与容器，避免样式漂移。
 * @param props - 测试标识、标题与内容。
 * @returns 卡片外框。
 */
function CardFrame(props: {
  readonly testId: string
  readonly title: string
  readonly children: ReactNode
}): JSX.Element {
  return (
    <article className="studio-change-card" data-testid={props.testId}>
      <h4>{props.title}</h4>
      {props.children}
    </article>
  )
}
