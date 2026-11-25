/** 提案对比视图：new 给新条目全文，revise 与 patch 给逐条目差异加全文对照；确认与拒绝走人机命令。patch 的基线是提案绑定的当前草稿正文。 */

import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@heroui/react'
import type { ProposalRow, RequirementChangeRow, RequirementDocRow } from '../spec/rows.ts'
import { readWorkspaceText, WORKSPACE_READ_LINES } from '../spec/files.ts'
import { changedEntries, diffLines } from '../spec/diff.ts'
import type { DiffLine } from '../spec/diff.ts'
import { runCommand, type CommandOutcome } from '../commands/run.ts'
import { MarkdownDocumentViewer } from '../markdown/document-viewer.tsx'
import { translate, type Translate } from '../locale.ts'

const zhText: Translate = (key, params) => translate('zh', key, params)

/** 基线快照的单次读取行数上限；与阅读器一致。 */
const BASELINE_LINES = WORKSPACE_READ_LINES

/** 基线正文的读取状态；快照读不到时退回当前正文。 */
type BaselineState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly text: string }
  | { readonly status: 'fallback'; readonly text: string }

/** 可内嵌的差异内容属性；独立对比层与详情内嵌共用同一套命令与回执逻辑。 */
export interface ProposalDiffProps {
  readonly proposal: ProposalRow
  readonly change: RequirementChangeRow
  readonly requirements: readonly RequirementDocRow[]
  readonly scopeSessionId: string
  /** 关闭或返回正文；不写数据。 */
  readonly onClose: () => void
  readonly onReload: () => void
  /** 应用成功后由调用方收起说明栏或差异视图；独立对比层不传。 */
  readonly onApplied?: (() => void) | undefined
  /** 顶部关闭按钮文案；详情内嵌传「返回正文」。 */
  readonly closeLabel?: string | undefined
  readonly t?: Translate
}

/**
 * 画差异内容：分析结论、变更条目与全文对照；确认走 `/proposal_approve`，拒绝走 `/proposal_reject`。
 *
 * 只渲染差异本体，外壳（独立弹层或详情内嵌宿主）由调用方提供，批准逻辑只在这里实现一次。
 * @param props - 提案、载荷、需求投影与命令通道。
 * @returns 差异栏、正文与操作区。
 */
export function ProposalDiff(props: ProposalDiffProps): JSX.Element {
  const t = props.t ?? zhText
  const change = props.change
  const targetRow = change.target === undefined
    ? undefined
    : props.requirements.find(row => row.id === change.target)
  const baselinePath = change.mode === 'revise' && change.target !== undefined && change.baseVersion !== undefined
    ? `.spec/requirements/${change.target}/versions/v${String(change.baseVersion)}.md`
    : null
  const [baseline, setBaseline] = useState<BaselineState>(() =>
    change.mode === 'patch' && change.baseContent !== undefined
      ? { status: 'ready', text: change.baseContent }
      : { status: 'loading' })
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [result, setResult] = useState<CommandOutcome | null>(null)

  // patch 的基线就是提案生成时宿主绑定的当前草稿正文，不读旧 vN.md 快照。
  // revise 的基线快照与阅读器走同一条宿主文件通道；读不到时退回当前正文，卸载后不再落状态。
  useEffect(() => {
    if (change.mode === 'patch') {
      setBaseline(change.baseContent === undefined
        ? { status: 'fallback', text: targetRow?.text ?? '' }
        : { status: 'ready', text: change.baseContent })
      return
    }
    if (baselinePath === null) return
    let disposed = false
    setBaseline({ status: 'loading' })
    const fallback = targetRow?.text ?? ''
    void readWorkspaceText(props.scopeSessionId, baselinePath, BASELINE_LINES)
      .then((answer) => {
        if (disposed) return
        setBaseline(answer.ok ? { status: 'ready', text: answer.text } : { status: 'fallback', text: fallback })
      })
      .catch(() => {
        if (!disposed) setBaseline({ status: 'fallback', text: fallback })
      })
    return () => { disposed = true }
  }, [baselinePath, change.mode, change.baseContent, props.scopeSessionId, targetRow?.text])

  const baselineText = baseline.status === 'loading' ? null : baseline.text
  const diff = useMemo(
    () => change.mode !== 'new' && baselineText !== null ? diffLines(baselineText, change.content) : null,
    [change.mode, change.content, baselineText],
  )
  const entries = diff === null ? [] : changedEntries(diff)
  const otherLines = diff === null ? 0 : diff.filter(line => line.kind !== 'same').length - entries.length

  const decide = async (kind: 'approve' | 'reject'): Promise<void> => {
    if (busy !== null) return
    setBusy(kind)
    setResult(null)
    try {
      const outcome = await runCommand(props.scopeSessionId, `/${kind === 'approve' ? 'proposal_approve' : 'proposal_reject'} ${props.proposal.id}`)
      setResult(outcome)
      if (outcome.ok) {
        props.onReload()
        if (kind === 'approve') props.onApplied?.()
        props.onClose()
      }
    } finally {
      setBusy(null)
    }
  }

  const columnOf = (lines: readonly DiffLine[], side: 'old' | 'new'): readonly DiffLine[] =>
    lines.filter(line => side === 'old' ? line.kind !== 'added' : line.kind !== 'removed')

  return (
    <>
      <div className="compare-bar">
        <div>
          <h3 data-testid="compare-title">{props.proposal.title}</h3>
          <p className="compare-sub" data-testid="compare-mode">
            {props.proposal.id} · {change.mode === 'new'
              ? t('compare.modeNew')
              : change.mode === 'patch'
                ? t('compare.modePatch', { target: change.target ?? '' })
                : t('compare.modeRevise', { target: change.target ?? '', version: change.baseVersion ?? 0 })}
          </p>
        </div>
        <Button variant="secondary" data-testid="compare-close" onPress={props.onClose}>{props.closeLabel ?? t('compare.close')}</Button>
      </div>
      <div className="compare-scroll">
        <section className="detail-section">
          <h4>{t('compare.analysis')}</h4>
          <p className="detail-line" data-testid="compare-analysis">{change.analysis}</p>
        </section>

        {change.mode === 'new' && (
          <section className="detail-section">
            <h4>{t('compare.newBody')}</h4>
            <MarkdownDocumentViewer text={change.content} t={t} bodyTestId="compare-new-body" compact tall />
          </section>
        )}

        {change.mode !== 'new' && (
          <>
            <section className="detail-section" data-testid="compare-entries">
              <h4>{t('compare.entries')}</h4>
              {diff === null && <p className="empty" data-testid="compare-loading">{t('compare.loading')}</p>}
              {baseline.status === 'fallback' && (
                <p className="detail-note" data-testid="compare-baseline-fallback">{t('compare.baselineFallback')}</p>
              )}
              {diff !== null && entries.length === 0 && otherLines === 0 && (
                <p className="empty" data-testid="compare-no-change">{t('compare.noChange')}</p>
              )}
              {entries.length > 0 && (
                <ul className="plain-list compact">
                  {entries.map((entry, index) => (
                    <li
                      key={`${entry.kind}-${String(index)}`}
                      className={`compare-entry-${entry.kind}`}
                      data-testid="compare-entry"
                      data-kind={entry.kind}
                    >
                      <span className="compare-entry-mark" aria-hidden="true">{entry.kind === 'added' ? '＋' : '－'}</span>
                      {entry.text}
                    </li>
                  ))}
                </ul>
              )}
              {otherLines > 0 && (
                <p className="detail-note" data-testid="compare-other-lines">{t('compare.otherLines', { count: otherLines })}</p>
              )}
            </section>
            <section className="detail-section">
              <h4>{t('compare.fullText')}</h4>
              {diff === null
                ? <p className="empty">{t('compare.loading')}</p>
                : (
                  <div className="compare-columns">
                    <div className="compare-col" data-testid="compare-old">
                      <h5>{change.mode === 'patch'
                        ? t('compare.patchOldBody')
                        : t('compare.oldBody', { version: change.baseVersion ?? 0 })}</h5>
                      <div className="compare-text">
                        {columnOf(diff, 'old').map((line, index) => (
                          <div key={index} className={line.kind === 'removed' ? 'compare-line removed' : 'compare-line'}>
                            {line.text === '' ? '\u00A0' : line.text}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="compare-col" data-testid="compare-new">
                      <h5>{t('compare.newBody')}</h5>
                      <div className="compare-text">
                        {columnOf(diff, 'new').map((line, index) => (
                          <div key={index} className={line.kind === 'added' ? 'compare-line added' : 'compare-line'}>
                            {line.text === '' ? '\u00A0' : line.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
            </section>
          </>
        )}
      </div>
      <div className="compare-actions">
        <Button
          variant="primary"
          data-testid="compare-approve"
          isDisabled={busy !== null}
          onPress={() => { void decide('approve') }}
        >
          {change.mode === 'patch' ? t('compare.apply') : t('compare.approve')}
        </Button>
        <Button
          variant="secondary"
          data-testid="compare-reject"
          isDisabled={busy !== null}
          onPress={() => { void decide('reject') }}
        >
          {t('compare.reject')}
        </Button>
        {change.mode === 'patch' && (
          <p className="detail-note" data-testid="compare-apply-hint">{t('compare.applyHint')}</p>
        )}
        {result !== null && !result.ok && (
          <p className="problem" data-testid="compare-result">{result.text}</p>
        )}
      </div>
    </>
  )
}

/** 独立提案对比层属性。 */
export interface ProposalCompareProps {
  readonly proposal: ProposalRow
  readonly change: RequirementChangeRow
  readonly requirements: readonly RequirementDocRow[]
  readonly scopeSessionId: string
  readonly onClose: () => void
  readonly onReload: () => void
  readonly t?: Translate
}

/**
 * 画独立提案对比层：外壳负责弹层与 Esc，差异本体交给 `ProposalDiff`，调用方行为保持不变。
 * @param props - 提案、载荷、需求投影与命令通道。
 * @returns 对比层。
 */
export function ProposalCompare(props: ProposalCompareProps): JSX.Element {
  const t = props.t ?? zhText

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      props.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [props.onClose])

  return (
    <div className="compare-layer" data-testid="proposal-compare" data-proposal-id={props.proposal.id}>
      <div className="compare-panel" role="dialog" aria-modal="true" aria-label={props.proposal.title}>
        <ProposalDiff
          proposal={props.proposal}
          change={props.change}
          requirements={props.requirements}
          scopeSessionId={props.scopeSessionId}
          onClose={props.onClose}
          onReload={props.onReload}
          t={t}
        />
      </div>
    </div>
  )
}
