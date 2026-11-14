/** 需求详情：正文、候选、推荐、关联任务与讨论历史。 */

import { useCallback, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { RequirementDocRow } from '../spec/rows.ts'
import type { SessionSummary } from '../store.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { readDiscussionHistory, type DiscussionHistory } from '../discussion/history.ts'
import { runCommand, type CommandOutcome } from '../commands/run.ts'
import { buildSplitPrompt } from '../intake/prompts.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'

/** 内置轨的显示文本；项目追加轨在调用处补上。 */
const BUILTIN_TRACKS = ['h5（H5 前端）', 'admin（管理端）', 'api（接口）', 'desktop（桌面端）', 'host（宿主端）', 'general（通用）']

/** 需求详情属性。 */
export interface RequirementDetailProps {
  readonly row: RequirementDocRow
  readonly project: ProjectScope
  readonly projection: SpecProjection
  readonly sessions: readonly SessionSummary[]
  readonly onClose: () => void
  readonly onOpenTask: (taskId: string) => void
  readonly onOpenReader: (path: string) => void
  readonly onReload: () => void
  readonly onStartSession: (prompt: string) => Promise<{ readonly ok: boolean; readonly message: string }>
}

/**
 * 画出需求详情。
 * @param props - 需求、项目、投影与会话列表。
 * @returns 详情面板。
 */
export function RequirementDetail(props: RequirementDetailProps): JSX.Element {
  const row = props.row
  const [history, setHistory] = useState<DiscussionHistory | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<CommandOutcome | null>(null)
  const related = props.projection.tasks.filter(task => task.requirement === row.id || task.proposal === row.id)

  const execute = async (kind: string, line: string): Promise<void> => {
    if (busy !== null) return
    setBusy(kind)
    setResult(null)
    try {
      const outcome = await runCommand(props.project.scopeSessionId, line)
      setResult(outcome)
      if (outcome.ok) props.onReload()
    } finally {
      setBusy(null)
    }
  }

  const split = async (): Promise<void> => {
    if (busy !== null) return
    setBusy('split')
    setResult(null)
    try {
      const extra = (props.projection.project?.tracks ?? []).map(track => `${track.id}（${track.name}）`)
      const answer = await props.onStartSession(buildSplitPrompt(
        { id: row.id, title: row.title ?? row.id },
        row.text,
        [...BUILTIN_TRACKS, ...extra],
      ))
      setResult({ ok: answer.ok, text: answer.message })
    } finally {
      setBusy(null)
    }
  }

  const canApprove = row.state === 'draft'
  const canRelease = row.state === 'confirmed'
  const canClose = row.state === 'draft' || row.state === 'confirmed'

  const loadHistory = useCallback(async () => {
    if (historyBusy) return
    setHistoryBusy(true)
    try {
      setHistory(await readDiscussionHistory(props.project.path, props.sessions, row.id))
    } catch (cause: unknown) {
      setHistory({
        status: 'failed',
        groups: [],
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setHistoryBusy(false)
    }
  }, [historyBusy, props.project.path, props.sessions, row.id])

  return (
    <aside className="detail-drawer lg-glass" data-testid="requirement-detail" data-requirement-id={row.id}>
      <div className="detail-drawer-head">
        <div>
          <span className="mono">{row.id}</span>
          <span className="tag">{requirementStateLabel(row.state)}</span>
        </div>
        <button type="button" className="pill" data-testid="requirement-detail-close" onClick={props.onClose}>关闭</button>
      </div>
      <h3 data-testid="requirement-detail-title">{row.title ?? row.id}</h3>

      <section className="detail-section">
        <div className="detail-drawer-head">
          <h4>需求正文</h4>
          <button type="button" className="pill" data-testid="requirement-open-reader" onClick={() => { props.onOpenReader(`.spec/requirements/${row.id}.md`) }}>
            在阅读器中打开
          </button>
        </div>
        {row.text.trim() === ''
          ? <p className="empty">正文缺失。</p>
          : <div className="markdown-body tall" data-testid="requirement-document-body">{renderMarkdown(row.text)}</div>}
      </section>

      {row.options.length > 0 && (
        <section className="detail-section" data-testid="requirement-options">
          <h4>候选做法</h4>
          <ul className="plain-list compact">
            {row.options.map(option => (
              <li key={option.name}>
                <strong>{option.name}</strong>
                <span>{option.summary}</span>
                {option.cost !== undefined && <em>{option.cost}</em>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {row.recommendation !== undefined && (
        <section className="detail-section" data-testid="requirement-recommendation">
          <h4>推荐</h4>
          <p className="detail-line">{row.recommendation}</p>
        </section>
      )}

      <section className="detail-section" data-testid="requirement-timeline">
        <h4>时间线</h4>
        <dl className="kv">
          <dt>开立</dt><dd>{row.openedAt ?? '—'}</dd>
          <dt>确认</dt><dd>{row.confirmedAt ?? '—'}</dd>
          <dt>上线</dt><dd>{row.releasedAt ?? '—'}</dd>
          <dt>关闭</dt><dd>{row.closedAt ?? '—'}</dd>
        </dl>
      </section>

      <section className="detail-section" data-testid="requirement-related">
        <h4>关联任务</h4>
        {related.length === 0
          ? <p className="empty">还没有拆出任务。</p>
          : (
            <ul className="plain-list compact">
              {related.map(task => (
                <li key={task.id}>
                  <button type="button" className="link-button" data-testid="requirement-related-task" onClick={() => { props.onOpenTask(task.id) }}>
                    <span className="mono">{task.id}</span> {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="detail-section" data-testid="requirement-history">
        <div className="detail-drawer-head">
          <h4>讨论历史</h4>
          <button type="button" className="pill" data-testid="requirement-history-load" disabled={historyBusy} onClick={() => { void loadHistory() }}>
            {historyBusy ? '读取中…' : history === null ? '读取讨论历史' : '重读'}
          </button>
        </div>
        {history === null && <p className="empty">按参会身份与需求编号聚合讨论会话。</p>}
        {history !== null && history.groups.length === 0 && (
          <p className={history.status === 'failed' ? 'problem' : 'empty'} data-testid="requirement-history-empty">{history.message}</p>
        )}
        {history !== null && history.groups.map(group => (
          <div key={group.roleId} className="history-round" data-testid="requirement-history-round" data-role={group.roleId}>
            <h5>{group.roleName}</h5>
            {group.statements.map((statement, index) => (
              <p key={`${group.roleId}-${String(index)}`} className="detail-line">{statement}</p>
            ))}
          </div>
        ))}
      </section>

      <section className="detail-section" data-testid="requirement-actions">
        <h4>动作（命令通道）</h4>
        <div className="action-row">
          <button type="button" className="pill" data-testid="requirement-approve" disabled={!canApprove || busy !== null} onClick={() => { void execute('approve', `/requirement_approve ${row.id}`) }}>确认需求</button>
          <button type="button" className="pill" data-testid="requirement-split" disabled={!canRelease || busy !== null} onClick={() => { void split() }}>拆分任务</button>
          <button type="button" className="pill" data-testid="requirement-release" disabled={!canRelease || busy !== null} onClick={() => { void execute('release', `/requirement_release ${row.id}`) }}>上线</button>
          <button type="button" className="pill" data-testid="requirement-close" disabled={!canClose || busy !== null} onClick={() => { void execute('close', `/requirement_close ${row.id}`) }}>关闭</button>
        </div>
        {result !== null && (
          <p className={result.ok ? 'detail-line' : 'problem'} data-testid="requirement-action-result" data-ok={result.ok ? 'true' : 'false'}>
            {result.text}
          </p>
        )}
        <p className="detail-note">拆分通过工作台会话执行项目经理指令；确认、上线、关闭走 kernel 人机命令。</p>
      </section>
    </aside>
  )
}
