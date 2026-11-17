/** 需求页：列表、搜索、状态筛选；详情在阶段 B 接入。 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { SessionSummary } from '../store.ts'
import type { RequirementDocRow } from '../spec/rows.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { hasIntakeWork } from '../intake/eligibility.ts'
import { buildManagerSplitPrompt, buildReviewPrompt, buildRevisePrompt, BUILTIN_SPLIT_TRACKS } from '../intake/prompts.ts'
import { INTAKE_PRESET_ID, MANAGER_PRESET_ID, PM_PRESET_ID, currentPresetId, isBuiltinTalentPreset } from '../talents/model.ts'
import { translate, type MessageKey, type Translate } from '../locale.ts'
import { OperationCards, type OperationCardView, type OperationStep } from '../shell/operation-cards.tsx'
import { RequirementDetail } from './requirement-detail.tsx'
import { TaskDetail } from './task-detail.tsx'
import { ReaderOverlay } from './reader.tsx'
import { IntakeWizard, type IntakeResult } from './intake-wizard.tsx'

/** 工作台页面尚未全面接入词典，未传取词函数时沿用中文；新客户端可传入自己的取词函数。 */
const zhText: Translate = (key, params) => translate('zh', key, params)

/** 后台操作的轮询间隔与等待上限。 */
const OP_POLL_MS = 4000
const OP_TIMEOUT_MS = 5 * 60 * 1000

/** 四类后台操作；立项调研也走后台浮卡，不强制跳转对话。 */
type OpKind = 'intake' | 'review' | 'revise' | 'split'

const OP_RUNNING_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'requirement.opRunning.intake',
  review: 'requirement.opRunning.review',
  revise: 'requirement.opRunning.revise',
  split: 'requirement.opRunning.split',
}

const OP_DONE_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'requirement.opDone.intake',
  review: 'requirement.opDone.review',
  revise: 'requirement.opDone.revise',
  split: 'requirement.opDone.split',
}

const OP_TITLE_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'requirement.opTitle.intake',
  review: 'requirement.opTitle.review',
  revise: 'requirement.opTitle.revise',
  split: 'requirement.opTitle.split',
}

const OP_ROLE_FALLBACK_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'intake.roleName',
  review: 'op.roleName.pm',
  revise: 'intake.roleName',
  split: 'op.roleName.manager',
}

const OP_PRESET: Readonly<Record<OpKind, string>> = {
  intake: INTAKE_PRESET_ID,
  review: PM_PRESET_ID,
  revise: INTAKE_PRESET_ID,
  split: MANAGER_PRESET_ID,
}

/** 一次后台操作的磁盘事实基线；完成判定只看投影相对基线的增量。 */
interface OpWatch {
  readonly key: string
  readonly kind: OpKind
  /** 立项调研没有需求编号，用 null；完成看需求条数增量。 */
  readonly requirementId: string | null
  readonly sessionId: string | null
  readonly reviews: number
  readonly versions: number
  readonly related: number
  readonly planAt: string | null
  readonly requirements: number
  readonly deadline: number
}

/** 已结束的操作卡：完成保持绿色、失败给警示色，直到用户关闭。 */
interface FinishedOp {
  readonly key: string
  readonly kind: OpKind
  readonly requirementId: string | null
  readonly sessionId: string | null
  readonly status: 'done' | 'failed'
}

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
  readonly onStartIntake: (prompt: string) => Promise<{ readonly ok: boolean; readonly message: string; readonly sessionId?: string }>
  /** 后台新建会话并发送指令，不跳转对话；`preset` 缺省沿用工作台角色，成功时带回会话号。 */
  readonly onStartSession: (
    prompt: string,
    preset?: string,
  ) => Promise<{ readonly ok: boolean; readonly message: string; readonly sessionId?: string }>
  /** 自愿打开一条会话并进入对话页；超时提示里的入口走它。 */
  readonly onOpenSession: (sessionId: string) => void
  /** 跳到任务页并只显示该需求关联的任务。 */
  readonly onOpenTasks: (requirementId: string) => void
  /** preset 名册显示名；浮卡子标题取它，读不到回退词典。 */
  readonly presetNames?: Readonly<Record<string, string>>
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
  const [opNotice, setOpNotice] = useState<string | null>(null)
  const [watches, setWatches] = useState<readonly OpWatch[]>([])
  const [finished, setFinished] = useState<readonly FinishedOp[]>([])
  const [minimizedKeys, setMinimizedKeys] = useState<readonly string[]>([])
  const loadingRef = useRef(props.loading)
  loadingRef.current = props.loading
  const busyOf = (kind: OpKind, requirementId: string | null) => watches.some(
    item => item.kind === kind && item.requirementId === requirementId,
  )

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
    kind: OpKind,
    row: RequirementDocRow,
    prompt: string,
    preset: string,
  ): Promise<{ readonly ok: boolean; readonly message: string }> => {
    setOpNotice(null)
    let answer: { readonly ok: boolean; readonly message: string; readonly sessionId?: string }
    try {
      answer = await props.onStartSession(prompt, preset)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setOpNotice(message)
      return { ok: false, message }
    }
    if (!answer.ok) {
      setOpNotice(answer.message)
      return answer
    }
    // 忙碌保持到磁盘事实出现增量或超时；发起成功只登记基线，不清忙碌。
    setWatches(current => [...current, {
      key: `${kind}-${row.id}-${String(Date.now())}`,
      kind,
      requirementId: row.id,
      sessionId: answer.sessionId ?? null,
      reviews: row.reviews.length,
      versions: row.versions.length,
      related: relatedOf(row.id).length,
      planAt: row.splitPlan?.at ?? null,
      requirements: props.projection.requirements.length,
      deadline: Date.now() + OP_TIMEOUT_MS,
    }])
    return answer
  }

  // 立项调研后台发起：向导收起，浮卡接管进度；七问提问卡走非对话页浮层。
  const intakeStart = async (prompt: string): Promise<{ readonly ok: boolean; readonly message: string }> => {
    setOpNotice(null)
    const answer = await props.onStartIntake(prompt)
    if (!answer.ok) {
      setOpNotice(answer.message)
      return answer
    }
    setWatches(current => [...current, {
      key: `intake-${String(Date.now())}`,
      kind: 'intake',
      requirementId: null,
      sessionId: answer.sessionId ?? null,
      reviews: 0,
      versions: 0,
      related: 0,
      planAt: null,
      requirements: props.projection.requirements.length,
      deadline: Date.now() + OP_TIMEOUT_MS,
    }])
    setWizard(false)
    return answer
  }

  const review = (row: RequirementDocRow) => launch(
    'review',
    row,
    buildReviewPrompt({ id: row.id, title: row.title ?? row.id }, row.text),
    PM_PRESET_ID,
  )

  const revise = (row: RequirementDocRow) => {
    const sorted = [...row.reviews].sort((left, right) => left.round - right.round)
    return launch(
      'revise',
      row,
      buildRevisePrompt({ id: row.id, title: row.title ?? row.id }, row.text, sorted[sorted.length - 1]?.report),
      INTAKE_PRESET_ID,
    )
  }

  const split = (row: RequirementDocRow) => launch('split', row, splitPromptOf(row), MANAGER_PRESET_ID)

  // 完成判定以投影里的磁盘事实为准：评审见增轮、改稿见增版、拆分见关联任务或计划出现/更新、立项见需求条数增量。
  useEffect(() => {
    if (watches.length === 0) return
    const doneWatches = watches.filter((watch) => {
      if (watch.kind === 'intake') return props.projection.requirements.length > watch.requirements
      const row = props.projection.requirements.find(item => item.id === watch.requirementId)
      if (row === undefined) return false
      const related = props.projection.tasks.filter(
        task => task.requirement === row.id || task.proposal === row.id,
      ).length
      return watch.kind === 'review'
        ? row.reviews.length > watch.reviews
        : watch.kind === 'revise'
          ? row.versions.length > watch.versions
          : related > watch.related || (row.splitPlan !== undefined && row.splitPlan.at !== watch.planAt)
    })
    if (doneWatches.length === 0) return
    setWatches(current => current.filter(item => !doneWatches.includes(item)))
    setFinished(current => [...current, ...doneWatches.map(watch => ({
      key: watch.key,
      kind: watch.kind,
      requirementId: watch.requirementId,
      sessionId: watch.sessionId,
      status: 'done' as const,
    }))])
    const last = doneWatches[doneWatches.length - 1]
    if (last !== undefined && last.requirementId !== null) setSelected(last.requirementId)
    props.onReload()
  }, [watches, props.projection, props.onReload])

  // 固定间隔轮询投影；读取中不叠加请求，卸载或无操作时清理；超时转失败卡。
  useEffect(() => {
    if (watches.length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      const expired = watches.filter(item => now >= item.deadline)
      if (expired.length > 0) {
        setWatches(current => current.filter(item => !expired.includes(item)))
        setFinished(current => [...current, ...expired.map(watch => ({
          key: watch.key,
          kind: watch.kind,
          requirementId: watch.requirementId,
          sessionId: watch.sessionId,
          status: 'failed' as const,
        }))])
        return
      }
      if (!loadingRef.current) props.onReload()
    }, OP_POLL_MS)
    return () => { clearInterval(timer) }
  }, [watches, props.onReload])

  // 立项分析只对空项目开放；已有结果时仍允许打开结果页回看，但不允许开新立项。
  const blockedIntake = hasIntakeWork(props.projection) && props.intakeResult === null
  const firstRequirement = props.projection.requirements[0]

  const cards = useMemo<readonly OperationCardView[]>(() => {
    const viewOf = (
      kind: OpKind,
      requirementId: string | null,
      sessionId: string | null,
      status: OperationCardView['status'],
      key: string,
    ): OperationCardView => {
      const preset = OP_PRESET[kind]
      const id = requirementId ?? t('requirement.opTitle.intake')
      const steps: readonly OperationStep[] = status === 'running'
        ? [
          { label: t('op.step.launched'), state: 'done' },
          { label: t('op.step.working'), state: 'active' },
          { label: t('op.step.landed'), state: 'pending' },
          { label: t('op.step.done'), state: 'pending' },
        ]
        : status === 'done'
          ? [
            { label: t('op.step.launched'), state: 'done' },
            { label: t('op.step.working'), state: 'done' },
            { label: t('op.step.landed'), state: 'done' },
            { label: t('op.step.done'), state: 'done' },
          ]
          : [
            { label: t('op.step.launched'), state: 'done' },
            { label: t('op.step.working'), state: 'failed' },
            { label: t('op.step.landed'), state: 'pending' },
            { label: t('op.step.done'), state: 'pending' },
          ]
      return {
        key,
        title: t(OP_TITLE_KEY[kind]),
        roleLabel: props.presetNames?.[currentPresetId(preset)] ?? t(OP_ROLE_FALLBACK_KEY[kind]),
        sourceLabel: t(isBuiltinTalentPreset(preset) ? 'op.sourceBuiltin' : 'op.sourceCustom'),
        status,
        statusText: status === 'running'
          ? t(OP_RUNNING_KEY[kind], { id })
          : status === 'done'
            ? t(OP_DONE_KEY[kind], { id })
            : t('requirement.opTimeout', { id }),
        steps,
        sessionId,
        minimized: minimizedKeys.includes(key),
      }
    }
    return [
      ...watches.map(watch => viewOf(watch.kind, watch.requirementId, watch.sessionId, 'running', watch.key)),
      ...finished.map(item => viewOf(item.kind, item.requirementId, item.sessionId, item.status, item.key)),
    ]
  }, [watches, finished, minimizedKeys, props.presetNames, t])

  const toggleMinimize = (key: string) => {
    setMinimizedKeys(current => current.includes(key)
      ? current.filter(item => item !== key)
      : [...current, key])
  }

  const closeCard = (key: string) => {
    const card = finished.find(item => item.key === key)
    setFinished(current => current.filter(item => item.key !== key))
    setMinimizedKeys(current => current.filter(item => item !== key))
    if (card?.status === 'failed') props.onReload()
  }

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
            disabled={props.project === null || blockedIntake || busyOf('intake', null)}
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
                                disabled={busyOf('review', row.id)}
                                onClick={(event) => { event.stopPropagation(); void review(row) }}
                              >
                                {t('requirement.opReview')}
                              </button>
                              <button
                                type="button"
                                className="pill"
                                data-testid="requirement-op-revise"
                                disabled={busyOf('revise', row.id)}
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
                              disabled={busyOf('split', row.id)}
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
              onRevise={() => revise(active)}
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
          onStart={intakeStart}
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

      <OperationCards
        cards={cards}
        onToggleMinimize={toggleMinimize}
        onOpenSession={props.onOpenSession}
        onClose={closeCard}
        t={t}
      />
    </section>
  )
}
