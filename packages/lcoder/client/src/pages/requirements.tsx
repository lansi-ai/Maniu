/** 需求页：列表、搜索、状态筛选；详情在阶段 B 接入。 */

import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { SessionSummary } from '../store.ts'
import type { RequirementDocRow } from '../spec/rows.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { hasIntakeWork } from '../intake/eligibility.ts'
import { buildManagerSplitPrompt, buildReviewPrompt, buildRevisePrompt, BUILTIN_SPLIT_TRACKS } from '../intake/prompts.ts'
import { INTAKE_PRESET_ID, MANAGER_PRESET_ID, PM_PRESET_ID } from '../talents/model.ts'
import { translate, type Translate } from '../locale.ts'
import { RequirementDetail } from './requirement-detail.tsx'
import { TaskDetail } from './task-detail.tsx'
import { ReaderOverlay } from './reader.tsx'
import { IntakeWizard, type IntakeResult } from './intake-wizard.tsx'

/** 工作台页面尚未全面接入词典，未传取词函数时沿用中文；新客户端可传入自己的取词函数。 */
const zhText: Translate = (key, params) => translate('zh', key, params)

/** 需求页属性。 */
export interface RequirementsPageProps {
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly sessions: readonly SessionSummary[]
  readonly loading: boolean
  readonly error: string | null
  readonly intakeResult: IntakeResult | null
  readonly onClearIntakeResult: () => void
  readonly onReload: () => void
  readonly onStartIntake: (prompt: string) => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 新建会话并发送指令；`preset` 缺省沿用工作台角色。 */
  readonly onStartSession: (
    prompt: string,
    preset?: string,
  ) => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 跳到任务页并只显示该需求关联的任务。 */
  readonly onOpenTasks: (requirementId: string) => void
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
}

/**
 * 需求页。
 * @param props - 投影与项目。
 * @returns 页面。
 */
export function RequirementsPage(props: RequirementsPageProps): JSX.Element {
  const t = props.t ?? zhText
  const [text, setText] = useState('')
  const [state, setState] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [readerPath, setReaderPath] = useState<string | null>(null)
  const [wizard, setWizard] = useState(false)
  const [opBusy, setOpBusy] = useState<string | null>(null)
  const [opNotice, setOpNotice] = useState<string | null>(null)

  const rows = useMemo(() => {
    const query = text.trim().toLowerCase()
    return props.projection.requirements.filter((row) => {
      if (state !== '' && row.state !== state) return false
      if (query === '') return true
      return `${row.id} ${row.title ?? ''} ${row.text}`.toLowerCase().includes(query)
    })
  }, [props.projection.requirements, state, text])

  const active = rows.find(row => row.id === selected) ?? null
  const detailTask = taskId === null ? undefined : props.projection.tasks.find(task => task.id === taskId)

  const relatedOf = (requirementId: string) => props.projection.tasks.filter(
    task => task.requirement === requirementId || task.proposal === requirementId,
  )

  const splitPromptOf = (row: RequirementDocRow): string => {
    const extra = (props.projection.project?.tracks ?? []).map(track => `${track.id}（${track.name}）`)
    return buildManagerSplitPrompt(
      { id: row.id, title: row.title ?? row.id },
      row.text,
      [...BUILTIN_SPLIT_TRACKS, ...extra],
    )
  }

  const launch = async (
    kind: string,
    prompt: string,
    preset?: string,
  ): Promise<{ readonly ok: boolean; readonly message: string }> => {
    setOpBusy(kind)
    setOpNotice(null)
    try {
      const answer = await props.onStartSession(prompt, preset)
      if (!answer.ok) setOpNotice(answer.message)
      return answer
    } finally {
      setOpBusy(null)
    }
  }

  const review = (row: RequirementDocRow) => launch(
    `review-${row.id}`,
    buildReviewPrompt({ id: row.id, title: row.title ?? row.id }, row.text),
    PM_PRESET_ID,
  )

  const revise = (row: RequirementDocRow) => {
    const sorted = [...row.reviews].sort((left, right) => left.round - right.round)
    return launch(
      `revise-${row.id}`,
      buildRevisePrompt({ id: row.id, title: row.title ?? row.id }, row.text, sorted[sorted.length - 1]?.report),
      INTAKE_PRESET_ID,
    )
  }

  const split = (row: RequirementDocRow) => launch(`split-${row.id}`, splitPromptOf(row), MANAGER_PRESET_ID)

  // 立项分析只对空项目开放；已有结果时仍允许打开结果页回看，但不允许开新立项。
  const blockedIntake = hasIntakeWork(props.projection) && props.intakeResult === null
  const firstRequirement = props.projection.requirements[0]

  // 进入页面时若上次读取为空或出错，补读一次；读取中不叠加第二个请求。
  // 只在挂载这一刻判定，后续变化由加载态回报。
  useEffect(() => {
    if (props.project === null || props.loading) return
    if (props.projection.requirements.length === 0 || props.error !== null) props.onReload()
  }, [])

  return (
    <section className="page" data-testid="page-requirements">
      <header className="page-head">
        <div>
          <h2>需求</h2>
        </div>
        <div className="page-actions">
          <input
            className="search"
            data-testid="requirement-search"
            value={text}
            placeholder="搜索需求"
            onChange={(event) => { setText(event.target.value) }}
          />
          <select
            className="select"
            data-testid="requirement-state"
            value={state}
            onChange={(event) => { setState(event.target.value) }}
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已确认</option>
            <option value="released">已上线</option>
            <option value="closed">已关闭</option>
          </select>
          <button type="button" className="pill" data-testid="requirement-reload" onClick={props.onReload}>
            {props.loading ? '读取中…' : '刷新'}
          </button>
          <button
            type="button"
            className="pill pill-accent"
            data-testid="intake-open"
            disabled={props.project === null || blockedIntake}
            title={blockedIntake ? t('requirement.intakeBlocked') : undefined}
            onClick={() => { setWizard(true) }}
          >
            {props.intakeResult === null ? '立项向导' : '立项结果'}
          </button>
        </div>
      </header>

      {props.project !== null && blockedIntake && (
        <p className="detail-note" data-testid="requirement-intake-blocked">
          <span>{t('requirement.intakeBlocked')}</span>
          {firstRequirement === undefined ? null : (
            <button
              type="button"
              className="link-button"
              data-testid="requirement-intake-blocked-open"
              onClick={() => { setSelected(firstRequirement.id) }}
            >
              {t('requirement.intakeBlockedOpen', { id: firstRequirement.id })}
            </button>
          )}
        </p>
      )}

      {props.project === null && <p className="empty" data-testid="requirement-no-project">先在「切换项目」里打开一个仓库。</p>}

      {props.project !== null && props.error !== null && (
        <p className="read-error" data-testid="requirement-read-error">
          <span>读取失败：{props.error.split('\n')[0]}</span>
          <button type="button" className="pill" data-testid="requirement-retry" disabled={props.loading} onClick={props.onReload}>
            {props.loading ? '读取中…' : '重试'}
          </button>
        </p>
      )}

      {opNotice !== null && (
        <p className="problem" data-testid="requirement-op-result">{t('requirement.opFailed', { detail: opNotice })}</p>
      )}

      {props.project !== null && (
        <div className="split">
          <div className="table-wrap lg-glass-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">编号</th>
                  <th scope="col">标题</th>
                  <th scope="col">状态</th>
                  <th scope="col">{t('requirement.colOpened')}</th>
                  <th scope="col">{t('requirement.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const related = relatedOf(row.id)
                  return (
                    <tr
                      key={row.id}
                      data-testid="requirement-row"
                      data-requirement-id={row.id}
                      className={row.id === selected ? 'selected' : undefined}
                      tabIndex={0}
                      onClick={() => { setSelected(row.id) }}
                      onKeyDown={(event) => { if (event.key === 'Enter') setSelected(row.id) }}
                    >
                      <td className="mono">{row.id}</td>
                      <td>{row.title ?? row.id}</td>
                      <td><span className="tag">{requirementStateLabel(row.state)}</span></td>
                      <td className="mono">{row.openedAt?.slice(0, 10) ?? '—'}</td>
                      <td>
                        <div className="row-actions">
                          {row.state === 'draft' && (
                            <>
                              <button
                                type="button"
                                className="pill"
                                data-testid="requirement-op-review"
                                disabled={opBusy !== null}
                                onClick={(event) => { event.stopPropagation(); void review(row) }}
                              >
                                {t('requirement.opReview')}
                              </button>
                              <button
                                type="button"
                                className="pill"
                                data-testid="requirement-op-revise"
                                disabled={opBusy !== null}
                                onClick={(event) => { event.stopPropagation(); void revise(row) }}
                              >
                                {t('requirement.opRevise')}
                              </button>
                            </>
                          )}
                          {row.state === 'confirmed' && related.length === 0 && (
                            <button
                              type="button"
                              className="pill"
                              data-testid="requirement-op-split"
                              disabled={opBusy !== null}
                              onClick={(event) => { event.stopPropagation(); void split(row) }}
                            >
                              {t('requirement.opSplit')}
                            </button>
                          )}
                          {related.length > 0 && (
                            <button
                              type="button"
                              className="pill"
                              data-testid="requirement-op-tasks"
                              onClick={(event) => { event.stopPropagation(); props.onOpenTasks(row.id) }}
                            >
                              {t('requirement.opTasks')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="empty" data-testid="requirement-empty">{props.loading ? '读取中…' : '没有匹配的需求。'}</p>}
          </div>

          {active !== null && (
            <RequirementDetail
              key={active.id}
              row={active}
              project={props.project}
              projection={props.projection}
              sessions={props.sessions}
              onClose={() => { setSelected(null) }}
              onOpenTask={setTaskId}
              onOpenReader={setReaderPath}
              onReload={props.onReload}
              onSplit={() => split(active)}
              onOpenTasks={() => { props.onOpenTasks(active.id) }}
              t={t}
            />
          )}
        </div>
      )}

      {detailTask !== undefined && props.project !== null && (
        <TaskDetail
          task={detailTask}
          projection={props.projection}
          project={props.project}
          sessions={props.sessions}
          onClose={() => { setTaskId(null) }}
          onOpenDoc={setReaderPath}
          onReload={props.onReload}
        />
      )}

      {wizard && props.project !== null && (
        <IntakeWizard
          project={props.project}
          projection={props.projection}
          result={props.intakeResult}
          onClearResult={props.onClearIntakeResult}
          onClose={() => { setWizard(false) }}
          onStart={props.onStartIntake}
          onOpenRequirement={(id) => { setWizard(false); setSelected(id) }}
          onReload={props.onReload}
          t={t}
        />
      )}

      {readerPath !== null && props.project !== null && (
        <ReaderOverlay
          scopeSessionId={props.project.scopeSessionId}
          path={readerPath}
          onClose={() => { setReaderPath(null) }}
        />
      )}
    </section>
  )
}
