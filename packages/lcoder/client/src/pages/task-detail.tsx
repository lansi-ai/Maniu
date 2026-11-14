/** 任务详情：契约、范围、证据、交付物、附件、调度与命令动作。 */

import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { SpecProjection } from '../spec/load.ts'
import type { ContractRow, TaskRow } from '../spec/rows.ts'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SessionSummary } from '../store.ts'
import { STATE_LABELS } from '../spec/board.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import { runCommand, type CommandOutcome } from '../commands/run.ts'
import { scheduleTask } from '../flow/scheduling.ts'
import { TaskAttachments } from './task-attachments.tsx'

/** 任务详情属性。 */
export interface TaskDetailProps {
  readonly task: TaskRow
  readonly projection: SpecProjection
  readonly project: ProjectScope
  readonly sessions: readonly SessionSummary[]
  readonly onClose: () => void
  readonly onOpenDoc: (path: string) => void
  readonly onReload: () => void
}

function contractOf(projection: SpecProjection, taskId: string): ContractRow | undefined {
  return projection.contracts.find(contract => contract.id === taskId)
}

function textList(values: readonly string[]): JSX.Element {
  if (values.length === 0) return <p className="empty">—</p>
  return <ul className="plain-list compact">{values.map(value => <li key={value}>{value}</li>)}</ul>
}

/**
 * 画出任务详情抽屉。
 * @param props - 任务、投影与操作回调。
 * @returns 详情面板。
 */
export function TaskDetail(props: TaskDetailProps): JSX.Element {
  const task = props.task
  const contract = contractOf(props.projection, task.id)
  const [role, setRole] = useState(task.role ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<CommandOutcome | null>(null)
  const schedule = useMemo(() => {
    const ruleModules: Record<string, string> = {}
    for (const rule of props.projection.rules) ruleModules[rule.id] = rule.module
    return scheduleTask(task, props.projection.tasks, props.sessions, props.project.path, ruleModules)
  }, [props.project.path, props.projection.rules, props.projection.tasks, props.sessions, task])

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
  return (
    <aside className="detail-drawer lg-glass" data-testid="task-detail" data-task-id={task.id}>
      <div className="detail-drawer-head">
        <div>
          <span className="mono">{task.id}</span>
          <span className="tag">{task.grade}</span>
          <span className="tag">{STATE_LABELS[task.state] ?? task.state}</span>
        </div>
        <button type="button" className="pill" data-testid="task-detail-close" onClick={props.onClose}>关闭</button>
      </div>
      <h3 data-testid="task-detail-title">{task.title}</h3>

      <section className="detail-section" data-testid="task-description">
        <h4>说明</h4>
        {task.description.trim() === '' ? <p className="empty">（没有描述）</p> : <div className="markdown-body">{renderMarkdown(task.description)}</div>}
      </section>

      <section className="detail-section" data-testid="task-contract-section">
        <h4>契约</h4>
        {contract === undefined
          ? <p className="empty" data-testid="task-contract-missing">还没有契约（`.spec/contracts/{task.id}.contract.yaml`）。</p>
          : (
            <>
              <p className="detail-line">
                签署：
                <span data-testid="task-contract-signed">
                  {contract.signedBy === null ? '未签署' : contract.signedBy === 'human' ? '人签' : `AI 自签（${contract.signedActor ?? '未知角色'}）`}
                </span>
                {contract.signedAt === null ? '' : ` · ${contract.signedAt}`}
              </p>
              <h5>要改什么</h5>
              {textList(contract.change)}
              <h5>不改什么</h5>
              {textList(contract.notChange)}
              <h5>验收</h5>
              <ul className="plain-list compact" data-testid="task-acceptance">
                {contract.acceptance.map(item => <li key={item}>{item}</li>)}
              </ul>
              <h5>失败条件</h5>
              {textList(contract.failIf)}
            </>
          )}
      </section>

      <section className="detail-section" data-testid="task-scope">
        <h4>范围与证据</h4>
        <dl className="kv">
          <dt>允许路径</dt><dd data-testid="task-paths">{task.paths.length === 0 ? '—' : task.paths.join('、')}</dd>
          <dt>不可逆动作</dt><dd>{task.irreversible.length === 0 ? '—' : task.irreversible.join('、')}</dd>
          <dt>证据要求</dt><dd data-testid="task-evidence">{task.evidence.length === 0 ? '—' : task.evidence.join('、')}</dd>
          <dt>规则</dt><dd>{task.rules.length === 0 ? '—' : task.rules.join('、')}</dd>
          <dt>依赖</dt><dd>{task.dependsOn.length === 0 ? '—' : task.dependsOn.join('、')}</dd>
          <dt>轨 / 岗位</dt><dd>{`${task.track ?? '—'} / ${task.role ?? '—'}`}</dd>
          <dt>认领会话</dt><dd className="mono">{task.session ?? '—'}</dd>
          <dt>需求 / 方案</dt><dd>{task.requirement ?? task.proposal ?? '—'}</dd>
        </dl>
      </section>

      <section className="detail-section" data-testid="task-deliverable">
        <h4>交付物</h4>
        {task.deliverable === undefined
          ? <p className="empty">没有交付索引。</p>
          : (
            <>
              <p className="detail-line">{task.deliverable.summary}</p>
              <ul className="plain-list compact">
                {task.deliverable.docs.map(doc => (
                  <li key={doc}>
                    <button type="button" className="link-button" data-testid="task-doc" onClick={() => { props.onOpenDoc(doc) }}>{doc}</button>
                  </li>
                ))}
                {task.deliverable.commands.map(command => <li key={command}><code>{command}</code></li>)}
              </ul>
            </>
          )}
      </section>

      <section className="detail-section" data-testid="task-attachments">
        <h4>附件</h4>
        {task.attachments.length === 0
          ? <p className="empty">没有附件。</p>
          : (
            <>
              <ul className="plain-list compact">
                {task.attachments.map(path => <li key={path}><code>{path}</code></li>)}
              </ul>
              <TaskAttachments scopeSessionId={props.project.scopeSessionId} paths={task.attachments} />
            </>
          )}
      </section>

      <section className="detail-section" data-testid="task-schedule">
        <h4>调度建议</h4>
        <p className="detail-line" data-testid="schedule-verdict" data-verdict={schedule.verdict}>
          判定：<strong>{schedule.verdict}</strong>
          {schedule.chosen === undefined ? '' : ` · ${schedule.chosen.slice(0, 8)}`}
        </p>
        <ul className="plain-list compact">
          {schedule.reasons.map(reason => <li key={reason}>{reason}</li>)}
          {schedule.candidates.filter(candidate => candidate.rejected !== undefined).slice(0, 4).map(candidate => (
            <li key={candidate.sessionId}>
              <strong className="mono">{candidate.sessionId.slice(0, 8)}</strong>
              <span>{candidate.rejected}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="pill"
          data-testid="schedule-record"
          disabled={busy !== null}
          onClick={() => {
            void execute('schedule', `/task_schedule ${task.id} ${JSON.stringify({ verdict: schedule.verdict, reasons: schedule.reasons })}`)
          }}
        >
          记录调度判定
        </button>
        <p className="detail-note">待审批/队列信息不在窄 IPC 面内，判定按会话忙闲与认领历史给出。</p>
      </section>

      <section className="detail-section" data-testid="task-actions">
        <h4>动作（命令通道）</h4>
        <div className="action-row">
          <button type="button" className="pill" data-testid="task-sign" disabled={busy !== null || contract === undefined} onClick={() => { void execute('sign', `/contract_sign ${task.id}`) }}>签署契约</button>
          <button type="button" className="pill" data-testid="task-bind" disabled={busy !== null} onClick={() => { void execute('bind', `/task_bind ${task.id}`) }}>认领到当前会话</button>
          <button type="button" className="pill" data-testid="task-contract" disabled={busy !== null || contract === undefined} onClick={() => { void execute('contract', `/task_contract ${task.id}`) }}>确认契约签约</button>
          <button type="button" className="pill" data-testid="task-split-ready" disabled={busy !== null} onClick={() => { void execute('ready', `/task_split_ready ${task.id}`) }}>推进到待开发</button>
        </div>
        <div className="action-row">
          <input className="search" data-testid="task-role-input" value={role} placeholder="岗位 id" onChange={(event) => { setRole(event.target.value) }} />
          <button type="button" className="pill" data-testid="task-assign" disabled={busy !== null || role.trim() === ''} onClick={() => { void execute('assign', `/task_assign ${task.id} ${role.trim()}`) }}>分配岗位</button>
        </div>
        {result !== null && (
          <p className={result.ok ? 'detail-line' : 'problem'} data-testid="task-action-result" data-ok={result.ok ? 'true' : 'false'}>
            {result.text}
          </p>
        )}
      </section>
    </aside>
  )
}
