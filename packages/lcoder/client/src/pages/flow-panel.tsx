/** 流程面板：`/flow_status` 判定与最近动作流水。 */

import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import { runCommand } from '../commands/run.ts'
import { parseFlowStatus, type FlowStatus } from '../flow/status.ts'
import { loadActionLog, type ActionLogEntry } from '../flow/history.ts'

/** 流程面板属性。 */
export interface FlowPanelProps {
  readonly project: ProjectScope
  readonly projection: SpecProjection
  readonly onClose: () => void
}

/**
 * 画流程面板。
 * @param props - 项目、投影与关闭回调。
 * @returns 流程抽屉。
 */
export function FlowPanel(props: FlowPanelProps): JSX.Element {
  const [status, setStatus] = useState<FlowStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [entries, setEntries] = useState<readonly ActionLogEntry[]>([])
  const [problems, setProblems] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    setStatusError(null)
    try {
      const outcome = await runCommand(props.project.scopeSessionId, '/flow_status')
      if (!outcome.ok) {
        setStatus(null)
        setStatusError(outcome.text)
      } else {
        const parsed = parseFlowStatus(outcome.text)
        setStatus(parsed ?? null)
        if (parsed === undefined) setStatusError('`/flow_status` 的回执读不懂')
      }
      const log = await loadActionLog(props.project.scopeSessionId, props.projection.tasks.map(task => task.id))
      setEntries(log.entries)
      setProblems(log.problems)
    } catch (cause: unknown) {
      setStatusError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [props.project.scopeSessionId, props.projection.tasks])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <aside className="detail-drawer lg-glass" data-testid="flow-panel">
      <div className="detail-drawer-head">
        <h3>流程状态</h3>
        <div>
          <button type="button" className="pill" data-testid="flow-refresh" disabled={busy} onClick={() => { void refresh() }}>
            {busy ? '求值中…' : '重跑判定'}
          </button>
          <button type="button" className="pill" data-testid="flow-close" onClick={props.onClose}>关闭</button>
        </div>
      </div>

      {statusError !== null && <p className="problem" data-testid="flow-error">{statusError}</p>}

      {status !== null && (
        <section className="detail-section" data-testid="flow-decision">
          <h4>下一步</h4>
          <p className="detail-line">
            <strong>{status.decision.action}</strong>
            {' · '}
            {status.decision.mode}
            {status.decision.taskId === null ? '' : ` · ${status.decision.taskId}`}
          </p>
          <p className="detail-line">{status.decision.reason}</p>
          {status.decision.blockers.length > 0 && (
            <ul className="plain-list compact">
              {status.decision.blockers.map(blocker => (
                <li key={`${blocker.kind}-${blocker.detail}`}><strong>{blocker.kind}</strong><span>{blocker.detail}</span></li>
              ))}
            </ul>
          )}
          <p className="detail-note">策略：{status.policySource} · {status.policyPath}</p>
        </section>
      )}

      {status !== null && status.tasks.length > 0 && (
        <section className="detail-section" data-testid="flow-plans">
          <h4>逐任务计划</h4>
          <ul className="plain-list compact">
            {status.tasks.map(plan => (
              <li key={plan.id} data-testid="flow-task" data-task-id={plan.id}>
                <strong>{plan.id} · {plan.state}</strong>
                <span>{plan.decision.action}（{plan.decision.mode}）：{plan.decision.reason}</span>
                <em>{plan.startable ? '可开工' : '按住'}</em>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="detail-section" data-testid="flow-log">
        <h4>最近动作</h4>
        {entries.length === 0
          ? <p className="empty" data-testid="flow-log-empty">还没有动作日志（`.spec/evidence/*/flow.jsonl`）。</p>
          : (
            <ul className="plain-list compact">
              {entries.map(entry => (
                <li key={`${entry.taskId}-${entry.source}-${entry.at}-${entry.action}`} data-testid="flow-log-entry">
                  <strong>{entry.taskId} · {entry.action}</strong>
                  <span>{entry.result}</span>
                  <em>{entry.at === '' ? entry.source : entry.at}</em>
                </li>
              ))}
            </ul>
          )}
        {problems.length > 0 && <pre className="problem">{problems.join('\n')}</pre>}
      </section>
    </aside>
  )
}
