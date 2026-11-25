/** 任务详情：契约、范围、证据、交付物、附件、调度与命令动作。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button, Chip } from '@heroui/react'
import { createPortal } from 'react-dom'
import { FileText, Loader2, Pencil, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type { SpecProjection } from '../spec/load.ts'
import type { ContractRow, TaskRow } from '../spec/rows.ts'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SessionSummary } from '../store.ts'
import { STATE_LABELS, roleLabel, roleTitleOf, ruleTitleOf, trackLabel } from '../spec/board.ts'
import { translate, type Translate } from '../locale.ts'
import { buildTaskImplementPlanPrompt, buildTaskModifyPrompt } from '../intake/prompts.ts'
import { MANAGER_PRESET_ID } from '../talents/model.ts'
import { useOpLiveFeeds, type OpLiveFeed } from '../shell/op-live-feed.ts'
import { DocumentReaderDialog } from '../markdown/document-viewer.tsx'
import { runCommand, type CommandOutcome } from '../commands/run.ts'
import { scheduleTask } from '../flow/scheduling.ts'
import { PRESET_ROLE_KEY, presetRoot } from '../flow/config.ts'
import { createTalent, listTalents, loadBuiltinPresets, loadProjectIdentity } from '../talents/api.ts'
import type { BuiltinPresetView, TalentRow } from '../talents/model.ts'
import { DetailDrawer } from './detail-drawer.tsx'
import { TaskAttachments } from './task-attachments.tsx'

const zhText: Translate = (key, params) => translate('zh', key, params)
const ARCHITECT_PRESET_ID = 'maniu-architect'

/** 人才库里可添人的一条岗位；talentId 只在项目级人才上有。 */
interface LibraryEntry {
  readonly key: string
  readonly title: string
  readonly inherits: string
  readonly talentId?: string
}

/** 内置 preset 的中文名；没有词典键时不把英文 id 暴露到界面。 */
function builtinTitle(presetId: string, t: Translate): string | undefined {
  const key = PRESET_ROLE_KEY[presetId]
  return roleTitleOf(key === undefined ? presetId.replace(/^maniu-/, '') : t(key))
}

/** 取一个没被名册占用的成员编号。 */
function nextRoleId(used: readonly string[]): string {
  let index = 1
  while (used.includes(`role-${String(index)}`)) index += 1
  return `role-${String(index)}`
}

/** 任务详情属性。 */
export interface TaskDetailProps {
  readonly task: TaskRow
  readonly projection: SpecProjection
  readonly project: ProjectScope
  readonly sessions: readonly SessionSummary[]
  readonly onClose: () => void
  readonly onOpenDoc: (path: string) => void
  readonly onReload: () => void
  readonly onStartSession?: ((
    prompt: string,
    agentPreset?: string,
  ) => Promise<{ readonly ok: boolean; readonly message: string; readonly sessionId?: string }>) | undefined
  readonly onOpenSession?: ((sessionId: string) => void) | undefined
  readonly t?: Translate | undefined
}

const TECHNICAL_SECTION_RE = /(?:^|\n)\s*(?:#{2,3}\s*(?:技术实施细节|技术细节|实施方案|技术方案)|(?:范围|技术方案|技术实施|验收标准|验收)[：:])/u

function cleanInternalRefs(text: string): string {
  return text.replace(/^(?:按|根据|依据)\s*P-\d+(?:\s*方案\s*[A-Za-z0-9]+)?\s*/u, '').trim()
}

/**
 * 把任务说明拆成「简洁人话概述」与「技术实施细节」两部分，默认只展示前者。
 * @param raw - 原始任务描述正文。
 * @returns 概述与可选的技术实施细节。
 */
export function splitTaskDescription(raw: string): { readonly summary: string; readonly technical: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { summary: '', technical: '' }

  const match = TECHNICAL_SECTION_RE.exec(trimmed)
  if (match !== null) {
    const idx = match.index === 0 ? 0 : match.index + 1
    const head = cleanInternalRefs(trimmed.slice(0, idx))
    const tail = trimmed.slice(idx).trim()
    if (head !== '') return { summary: head, technical: tail }
    // 如果整段开头就是技术标题，至少抽出首行/首句作为概述。
    const lines = tail.split('\n').map(line => line.trim()).filter(line => line !== '')
    const first = cleanInternalRefs(lines[0] ?? '')
    return {
      summary: first,
      technical: lines.length > 1 ? tail : '',
    }
  }

  const cleaned = cleanInternalRefs(trimmed)
  const paragraphs = cleaned.split(/\n{2,}/u).map(part => part.trim()).filter(part => part !== '')
  if (paragraphs.length > 1) {
    return {
      summary: paragraphs[0] ?? cleaned,
      technical: paragraphs.slice(1).join('\n\n'),
    }
  }
  return { summary: cleaned, technical: '' }
}

function contractOf(projection: SpecProjection, taskId: string): ContractRow | undefined {
  return projection.contracts.find(contract => contract.id === taskId)
}

function textList(values: readonly string[]): JSX.Element {
  if (values.length === 0) return <p className="empty">—</p>
  return <ul className="task-clean-list">{values.map(value => <li key={value}>{value}</li>)}</ul>
}

/**
 * 画出任务详情抽屉。
 * @param props - 任务、投影与操作回调。
 * @returns 详情面板。
 */
export function TaskDetail(props: TaskDetailProps): JSX.Element {
  const t = props.t ?? zhText
  const task = props.task
  const contract = contractOf(props.projection, task.id)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [builtins, setBuiltins] = useState<readonly BuiltinPresetView[]>([])
  const [projectTalents, setProjectTalents] = useState<readonly TalentRow[]>([])
  const [showTalents, setShowTalents] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDuty, setNewDuty] = useState('')
  const [creating, setCreating] = useState(false)
  const aliveRef = useRef(true)
  const isAlive = (): boolean => aliveRef.current
  const [techReaderOpen, setTechReaderOpen] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [advanceConfirmOpen, setAdvanceConfirmOpen] = useState(false)
  const [modifyOpen, setModifyOpen] = useState(false)
  const [modifyNote, setModifyNote] = useState('')
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [bgOp, setBgOp] = useState<{ readonly kind: 'advance' | 'modify'; readonly sessionId: string } | null>(null)
  const sawBgRunningRef = useRef(false)
  const descriptionParts = useMemo(() => splitTaskDescription(task.description), [task.description])

  const officeEntries = useMemo(() => {
    const seen = new Set<string>()
    const entries: { readonly id: string; readonly title: string }[] = []
    for (const role of props.projection.roles) {
      const title = roleTitleOf(role.name)
      if (title === undefined || seen.has(title)) continue
      seen.add(title)
      entries.push({ id: role.id, title })
    }
    return entries
  }, [props.projection.roles])

  const libraryEntries = useMemo<readonly LibraryEntry[]>(() => {
    const seen = new Set(officeEntries.map(entry => entry.title))
    const entries: LibraryEntry[] = []
    const add = (key: string, title: string | undefined, presetId: string | undefined, talentId?: string): void => {
      if (title === undefined || seen.has(title)) return
      seen.add(title)
      entries.push({ key, title, inherits: presetRoot(presetId ?? '') ?? 'dev', ...(talentId === undefined ? {} : { talentId }) })
    }
    for (const preset of builtins) add(preset.id, builtinTitle(preset.id, t), preset.id)
    for (const row of projectTalents) add(row.id, roleTitleOf(row.name), row.config.basePreset, row.id)
    return entries
  }, [builtins, officeEntries, projectTalents, t])

  /** 存量任务没有 role 时，用拆分计划的建议岗位兜底。 */
  const suggestedRole = useMemo(() => {
    if (task.role !== undefined && task.role.trim() !== '') return undefined
    if (task.requirement === undefined) return undefined
    const plan = props.projection.requirements.find(row => row.id === task.requirement)?.splitPlan
    return plan?.entries.find(entry => entry.task === task.id)?.role
  }, [props.projection.requirements, task.id, task.requirement, task.role])

  const displayRole = roleLabel(task.role ?? suggestedRole, props.projection.roles) ?? t('task.unassigned')

  const ruleLabels = useMemo(() => task.rules.map((id) => {
    const rule = props.projection.rules.find(item => item.id === id)
    return rule === undefined ? id : ruleTitleOf(rule)
  }), [props.projection.rules, task.rules])

  useEffect(() => () => { aliveRef.current = false }, [])

  useEffect(() => {
    setTechReaderOpen(false)
    setScopeOpen(false)
    setAdvanceConfirmOpen(false)
    setModifyOpen(false)
    setModifyNote('')
    setDiscardConfirm(false)
    setBgOp(null)
    sawBgRunningRef.current = false
  }, [task.id, task.role])

  useEffect(() => {
    if (!advanceConfirmOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAdvanceConfirmOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [advanceConfirmOpen])

  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<CommandOutcome | null>(null)
  const bgSessionIds = useMemo(() => (bgOp === null ? [] : [bgOp.sessionId]), [bgOp])
  const bgFeeds = useOpLiveFeeds(bgSessionIds)
  const activeBgFeed = bgOp === null ? undefined : bgFeeds[bgOp.sessionId]

  const finishBgOp = useCallback(async (op: { readonly kind: 'advance' | 'modify'; readonly sessionId: string }, turnEnd?: OpLiveFeed['turnEnd']): Promise<void> => {
    sawBgRunningRef.current = false
    setBgOp(null)
    if (turnEnd?.kind === 'error') {
      setResult({ ok: false, text: t('task.advancePlanFailed', { detail: turnEnd.message }) })
      return
    }
    if (op.kind === 'modify') {
      setModifyOpen(false)
      setModifyNote('')
      setResult({ ok: true, text: t('task.modifyDone') })
      props.onReload()
      return
    }
    setBusy('ready')
    try {
      const outcome = await runCommand(props.project.scopeSessionId, `/task_split_ready ${task.id}`)
      setResult(outcome.ok ? { ok: true, text: t('task.advancePlanDone') } : outcome)
      if (outcome.ok) props.onReload()
    } finally {
      setBusy(null)
    }
  }, [props, t, task.id])

  useEffect(() => {
    if (bgOp === null || activeBgFeed?.turnEnd === undefined) return
    void finishBgOp(bgOp, activeBgFeed.turnEnd)
  }, [activeBgFeed?.turnEnd, bgOp, finishBgOp])

  useEffect(() => {
    if (bgOp === null) return
    const session = props.sessions.find(item => item.sessionId === bgOp.sessionId)
    if (session?.running === true) {
      sawBgRunningRef.current = true
      return
    }
    if (sawBgRunningRef.current) {
      void finishBgOp(bgOp, activeBgFeed?.turnEnd)
    }
  }, [activeBgFeed?.turnEnd, bgOp, finishBgOp, props.sessions])

  const schedule = useMemo(() => {
    const ruleModules: Record<string, string> = {}
    for (const rule of props.projection.rules) ruleModules[rule.id] = rule.module
    return scheduleTask(task, props.projection.tasks, props.sessions, props.project.path, ruleModules)
  }, [props.project.path, props.projection.rules, props.projection.tasks, props.sessions, task])

  const execute = async (kind: string, line: string): Promise<void> => {
    if (busy !== null || bgOp !== null) return
    setBusy(kind)
    setResult(null)
    try {
      const outcome = await runCommand(props.project.scopeSessionId, line)
      setResult(outcome)
      if (outcome.ok) {
        props.onReload()
        if (kind === 'discard') props.onClose()
      }
    } finally {
      setBusy(null)
    }
  }

  /** 执行一条改派命令，返回结果供连续动作判断是否继续。 */
  const runAssigneeCommand = async (kind: string, line: string): Promise<boolean> => {
    if (busy !== null || bgOp !== null) return false
    setBusy(kind)
    setResult(null)
    try {
      const outcome = await runCommand(props.project.scopeSessionId, line)
      setResult(outcome)
      if (outcome.ok) props.onReload()
      return outcome.ok
    } finally {
      setBusy(null)
    }
  }

  const assign = async (roleId: string): Promise<void> => {
    if (await runAssigneeCommand('assign', `/task_assign ${task.id} ${roleId}`)) setPickerOpen(false)
  }

  /** 首次打开浮层时加载内置岗位与当前项目级人才库。 */
  const openPicker = (): void => {
    setPickerOpen(true)
    setLibraryError(null)
    if (libraryLoaded) return
    setLibraryLoaded(true)
    void (async () => {
      const identity = await loadProjectIdentity(props.project.path)
      const id = identity.ok ? identity.value.projectId : null
      if (!isAlive()) return
      setProjectId(id)
      const [presetAnswer, talentAnswer] = await Promise.all([
        loadBuiltinPresets(),
        id === null ? null : listTalents('project', id),
      ])
      if (!isAlive()) return
      setBuiltins(presetAnswer.ok ? presetAnswer.value : [])
      setProjectTalents(talentAnswer?.ok === true ? talentAnswer.value : [])
      const problems: string[] = []
      if (!presetAnswer.ok) problems.push(`${presetAnswer.code}: ${presetAnswer.message}`)
      if (talentAnswer !== null && !talentAnswer.ok) problems.push(`${talentAnswer.code}: ${talentAnswer.message}`)
      if (problems.length > 0) setLibraryError(t('task.assigneePicker.failure', { detail: problems.join('；') }))
    })()
  }

  /** 按岗位往办公室添 1 名成员，返回新成员的岗位 id。 */
  const addMember = async (title: string, inherits: string): Promise<string | undefined> => {
    const used = props.projection.roles
    const id = nextRoleId(used.map(role => role.id))
    const count = used.filter(role => roleTitleOf(role.name) === title).length + 1
    const line = `/role_upsert ${JSON.stringify({ id, name: `${title}-成员${String(count)}`, inherits })}`
    return await runAssigneeCommand('addMember', line) ? id : undefined
  }

  const addFromTalent = async (entry: LibraryEntry): Promise<void> => {
    const memberId = await addMember(entry.title, entry.inherits)
    if (memberId !== undefined) await assign(memberId)
  }

  const createAndAssign = async (): Promise<void> => {
    if (creating) return
    if (projectId === null) {
      setLibraryError(t('task.assigneePicker.projectIdMissing'))
      return
    }
    const title = roleTitleOf(newName) ?? newName.trim()
    if (title === '') return
    setCreating(true)
    try {
      const duty = newDuty.trim()
      // 新建岗位只写项目级人才库：scope 固定为 project，并绑定当前项目 id。
      const created = await createTalent({
        scope: 'project',
        projectId,
        name: title,
        description: duty,
        config: { version: 1, basePreset: 'maniu-dev', ...(duty === '' ? {} : { persona: duty }) },
      })
      if (!isAlive()) return
      if (!created.ok) {
        setLibraryError(t('task.assigneePicker.failure', { detail: `${created.code}: ${created.message}` }))
        return
      }
      const memberId = await addMember(title, 'dev')
      if (memberId !== undefined) await assign(memberId)
    } finally {
      if (isAlive()) setCreating(false)
    }
  }

  const technicalPlan = useMemo(() => {
    if (task.proposal === undefined) return undefined
    const found = props.projection.proposals.find(item => item.id === task.proposal)
    return found === undefined
      ? undefined
      : { id: found.id, title: found.title, recommendation: found.recommendation }
  }, [props.projection.proposals, task.proposal])

  const siblingTasks = useMemo(
    () => props.projection.tasks
      .filter(item => (task.requirement !== undefined ? item.requirement === task.requirement : item.proposal === task.proposal))
      .map(item => ({ id: item.id, title: item.title, state: item.state, dependsOn: item.dependsOn })),
    [props.projection.tasks, task.proposal, task.requirement],
  )

  const confirmAndAdvance = async (): Promise<void> => {
    if (busy !== null || bgOp !== null) return
    const targetRole = task.role?.trim() ?? ''
    if (targetRole === '' && suggestedRole === undefined) {
      setResult({ ok: false, text: t('task.roleMissingForReady') })
      return
    }
    setBusy('advance')
    setResult(null)
    try {
      const assignRole = targetRole !== '' ? targetRole : suggestedRole
      if (assignRole !== undefined && assignRole !== task.role) {
        const assigned = await runCommand(props.project.scopeSessionId, `/task_assign ${task.id} ${assignRole}`)
        if (!assigned.ok) {
          setResult(assigned)
          return
        }
        props.onReload()
      }
      if (props.onStartSession === undefined) {
        const outcome = await runCommand(props.project.scopeSessionId, `/task_split_ready ${task.id}`)
        setResult(outcome)
        if (outcome.ok) props.onReload()
        return
      }
      const prompt = buildTaskImplementPlanPrompt(task, siblingTasks, technicalPlan)
      const started = await props.onStartSession(prompt, ARCHITECT_PRESET_ID)
      if (!started.ok) {
        setResult({ ok: false, text: started.message })
        return
      }
      if (started.sessionId !== undefined) {
        sawBgRunningRef.current = false
        setBgOp({ kind: 'advance', sessionId: started.sessionId })
      }
    } finally {
      setBusy(null)
    }
  }

  /** 主按钮先弹二次确认；缺负责人时沿用 confirmAndAdvance 内的缺人提示直接拦截。 */
  const requestAdvance = (): void => {
    const targetRole = task.role?.trim() ?? ''
    if (targetRole === '' && suggestedRole === undefined) {
      void confirmAndAdvance()
      return
    }
    setAdvanceConfirmOpen(true)
  }

  const submitModify = async (): Promise<void> => {
    const note = modifyNote.trim()
    if (note === '' || busy !== null || bgOp !== null || props.onStartSession === undefined) return
    setBusy('modify')
    setResult(null)
    try {
      const prompt = buildTaskModifyPrompt(task, note, technicalPlan)
      const started = await props.onStartSession(prompt, MANAGER_PRESET_ID)
      if (!started.ok) {
        setResult({ ok: false, text: started.message })
        return
      }
      if (started.sessionId !== undefined) {
        sawBgRunningRef.current = false
        setBgOp({ kind: 'modify', sessionId: started.sessionId })
      }
    } finally {
      setBusy(null)
    }
  }
  const trackText = trackLabel(task.track)
  const blockingDeps = useMemo(() => {
    if (task.dependsOn.length === 0) return []
    const byId = new Map(props.projection.tasks.map(item => [item.id, item]))
    return task.dependsOn.filter(depId => byId.get(depId)?.state !== 'closed')
  }, [props.projection.tasks, task.dependsOn])
  const showContractSection = contract !== undefined || task.state !== 'drafting'

  return (
    <DetailDrawer
      testId="task-detail"
      closeTestId="task-detail-close"
      expandable={false}
      onClose={props.onClose}
      attributes={{ 'data-task-id': task.id }}
      head={(
        <div className="task-detail-head">
          <span className="mono">{task.id}</span>
          <Chip size="sm" variant="soft" color="accent">{task.grade}</Chip>
          <Chip size="sm" variant="soft">{STATE_LABELS[task.state] ?? task.state}</Chip>
        </div>
      )}
    >
      <div className="task-detail-shell">
        <header className="task-detail-hero">
          <h3 className="task-detail-title" data-testid="task-detail-title">{task.title}</h3>
          <div className="task-detail-chips">
            {trackText !== undefined && (
              <span className="task-detail-pill">
                <span className="task-detail-pill-label">所属端</span>
                <strong>{trackText}</strong>
              </span>
            )}
            <span className="task-detail-pill" data-testid="task-assignee-pill">
              <span className="task-detail-pill-label">负责人</span>
              <strong data-testid="task-assignee-name">{displayRole}</strong>
              <button
                type="button"
                className="task-detail-pencil"
                data-testid="task-assignee-edit"
                aria-label={t('task.changeAssignee')}
                disabled={busy !== null}
                onClick={openPicker}
              >
                <Pencil size={12} aria-hidden="true" />
              </button>
              {pickerOpen && (
                <div className="task-assignee-popover" data-testid="task-assignee-popover">
                  <div className="task-assignee-popover-head">
                    <strong>{displayRole}</strong>
                    <Button variant="ghost" size="sm" data-testid="task-assignee-close" onPress={() => { setPickerOpen(false) }}>
                      {t('task.assigneePicker.cancel')}
                    </Button>
                  </div>
                  <h5>{t('task.assigneePicker.office')}</h5>
                  {officeEntries.length === 0
                    ? <p className="empty">{t('task.assigneePicker.emptyOffice')}</p>
                    : (
                      <ul className="plain-list compact">
                        {officeEntries.map(entry => (
                          <li key={entry.id}>
                            <button
                              type="button"
                              className="link-button"
                              data-testid="task-assignee-option"
                              data-role-id={entry.id}
                              disabled={busy !== null}
                              onClick={() => { void assign(entry.id) }}
                            >
                              {entry.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  <h5>{t('task.assigneePicker.withoutOffice')}</h5>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="task-assignee-from-talent"
                    onPress={() => { setShowTalents(current => !current) }}
                  >
                    {t('task.assigneePicker.fromTalent')}
                  </Button>
                  {showTalents && (
                    libraryEntries.length === 0
                      ? <p className="empty">{t('task.assigneePicker.emptyTalent')}</p>
                      : (
                        <ul className="plain-list compact">
                          {libraryEntries.map(entry => (
                            <li key={entry.key}>
                              <button
                                type="button"
                                className="link-button"
                                data-testid="task-assignee-talent-option"
                                data-role-title={entry.title}
                                disabled={busy !== null}
                                onClick={() => { void addFromTalent(entry) }}
                              >
                                {entry.title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="task-assignee-create-toggle"
                    onPress={() => { setShowCreate(current => !current) }}
                  >
                    {t('task.assigneePicker.createRole')}
                  </Button>
                  {showCreate && (
                    <div className="task-assignee-create" data-testid="task-assignee-create-form">
                      <label className="field">
                        <span>{t('task.assigneePicker.roleName')}</span>
                        <input
                          className="input"
                          data-testid="task-assignee-new-name"
                          value={newName}
                          placeholder={t('task.assigneePicker.roleNamePlaceholder')}
                          onChange={(event) => { setNewName(event.target.value) }}
                        />
                      </label>
                      <label className="field">
                        <span>{t('task.assigneePicker.duty')}</span>
                        <textarea
                          className="input"
                          data-testid="task-assignee-new-duty"
                          value={newDuty}
                          placeholder={t('task.assigneePicker.dutyPlaceholder')}
                          onChange={(event) => { setNewDuty(event.target.value) }}
                        />
                      </label>
                      <div className="action-row">
                        <Button
                          variant="primary"
                          size="sm"
                          data-testid="task-assignee-create-submit"
                          isDisabled={creating || newName.trim() === ''}
                          onPress={() => { void createAndAssign() }}
                        >
                          {creating ? t('task.assigneePicker.busy') : t('task.assigneePicker.submit')}
                        </Button>
                      </div>
                    </div>
                  )}
                  {libraryError !== null && <p className="problem" data-testid="task-assignee-library-error">{libraryError}</p>}
                </div>
              )}
            </span>
            <span className="task-detail-pill">
              <span className="task-detail-pill-label">执行顺序</span>
              <strong>{blockingDeps.length === 0 ? '可立即开始' : `需先完成 ${blockingDeps.join('、')}`}</strong>
            </span>
            {(task.requirement ?? task.proposal) !== undefined && (
              <span className="task-detail-pill">
                <span className="task-detail-pill-label">关联</span>
                <strong className="mono">{task.requirement ?? task.proposal}</strong>
              </span>
            )}
          </div>
        </header>

        <section className="task-detail-action-card" data-testid="task-actions">
          {task.state === 'drafting'
            ? (
              <>
                <div className="task-detail-action-row">
                  <div className="task-detail-action-buttons">
                    <Button
                      variant="primary"
                      size="sm"
                      data-testid="task-confirm-advance"
                      isDisabled={busy !== null || bgOp !== null}
                      onPress={requestAdvance}
                    >
                      {bgOp?.kind === 'advance' && <Loader2 className="prototype-spin" size={14} aria-hidden="true" />}
                      <span>{bgOp?.kind === 'advance' ? t('task.confirmAdvancing') : t('task.confirmAdvance')}</span>
                    </Button>
                    {props.onStartSession !== undefined && (
                      <Button
                        isIconOnly
                        variant="secondary"
                        size="sm"
                        data-testid="task-modify-toggle"
                        aria-label={t('task.modify')}
                        ref={(node) => { if (node !== null) node.title = t('task.modify') }}
                        isDisabled={busy !== null || bgOp !== null}
                        onPress={() => { setDiscardConfirm(false); setModifyOpen(current => !current) }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      isIconOnly
                      variant="ghost"
                      size="sm"
                      data-testid="task-discard-toggle"
                      aria-label={t('task.discard')}
                      ref={(node) => { if (node !== null) node.title = t('task.discard') }}
                      isDisabled={busy !== null || bgOp !== null}
                      onPress={() => { setModifyOpen(false); setDiscardConfirm(current => !current) }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {bgOp !== null && props.onOpenSession !== undefined && (
                  <div className="prototype-generating-bar" data-testid="task-bg-running">
                    <span className="prototype-generating-bar-main">
                      <Loader2 className="prototype-spin" size={14} aria-hidden="true" />
                      <span>{bgOp.kind === 'advance' ? t('task.confirmAdvancing') : t('task.modifyRunning')}</span>
                    </span>
                    <Button size="sm" variant="ghost" data-testid="task-bg-view-session" onPress={() => { props.onOpenSession?.(bgOp.sessionId) }}>
                      {t('task.viewSession')}
                    </Button>
                  </div>
                )}
                {modifyOpen && (
                  <div className="task-modify-box" data-testid="task-modify-box">
                    <textarea
                      className="prototype-regen-textarea"
                      data-testid="task-modify-input"
                      value={modifyNote}
                      placeholder={t('task.modifyPlaceholder')}
                      onChange={(event) => { setModifyNote(event.target.value) }}
                    />
                    <div className="action-row">
                      <Button
                        size="sm"
                        variant="primary"
                        data-testid="task-modify-submit"
                        isDisabled={busy !== null || bgOp !== null || modifyNote.trim() === ''}
                        onPress={() => { void submitModify() }}
                      >
                        {t('task.modifySubmit')}
                      </Button>
                      <Button size="sm" variant="ghost" onPress={() => { setModifyOpen(false) }}>
                        {t('task.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
                {discardConfirm && (
                  <div className="action-row" data-testid="task-discard-confirm-box">
                    <span className="detail-note">{t('task.discardConfirm')}</span>
                    <Button
                      size="sm"
                      variant="danger"
                      data-testid="task-discard-confirm"
                      isDisabled={busy !== null || bgOp !== null}
                      onPress={() => { void execute('discard', `/task_discard ${task.id}`) }}
                    >
                      {t('task.discardConfirmAction')}
                    </Button>
                    <Button size="sm" variant="ghost" onPress={() => { setDiscardConfirm(false) }}>
                      {t('task.cancel')}
                    </Button>
                  </div>
                )}
              </>
            )
            : (
              <div className="task-detail-action-row">
                <div className="task-detail-action-buttons">
                  <Button variant="primary" size="sm" data-testid="task-sign" isDisabled={busy !== null || contract === undefined} onPress={() => { void execute('sign', `/contract_sign ${task.id}`) }}>签署契约</Button>
                  <Button variant="secondary" size="sm" data-testid="task-bind" isDisabled={busy !== null} onPress={() => { void execute('bind', `/task_bind ${task.id}`) }}>认领到当前会话</Button>
                  <Button variant="secondary" size="sm" data-testid="task-contract" isDisabled={busy !== null || contract === undefined} onPress={() => { void execute('contract', `/task_contract ${task.id}`) }}>确认契约签约</Button>
                </div>
              </div>
            )}
          {result !== null && (
            <p className={result.ok ? 'detail-line' : 'problem'} data-testid="task-action-result" data-ok={result.ok ? 'true' : 'false'}>
              {result.text}
            </p>
          )}
        </section>

        <div className="task-detail-grid">
          <div className="task-detail-main">
            <section className="task-detail-card" data-testid="task-description">
              <div className="task-detail-card-head">
                <h4 className="task-detail-card-title">任务说明</h4>
                {descriptionParts.technical !== '' && (
                  <Button
                    isIconOnly
                    className="task-detail-icon-action"
                    variant="ghost"
                    size="sm"
                    data-testid="task-tech-open"
                    aria-label={t('task.showTechnicalDetails')}
                    ref={(node) => { if (node !== null) node.title = t('task.showTechnicalDetails') }}
                    onPress={() => { setTechReaderOpen(true) }}
                  >
                    <FileText size={15} aria-hidden="true" />
                  </Button>
                )}
              </div>
              {descriptionParts.summary === ''
                ? <p className="empty">（没有描述）</p>
                : <p className="task-summary-text">{descriptionParts.summary}</p>}
            </section>

            {showContractSection && (
              <section className="task-detail-card" data-testid="task-contract-section">
                <h4 className="task-detail-card-title">开发契约</h4>
                {contract === undefined
                  ? <p className="empty" data-testid="task-contract-missing">暂未生成契约。</p>
                  : (
                    <div className="task-contract-body">
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
                      <h5>验收标准</h5>
                      <ul className="task-clean-list" data-testid="task-acceptance">
                        {contract.acceptance.map(item => <li key={item}>{item}</li>)}
                      </ul>
                      <h5>失败条件</h5>
                      {textList(contract.failIf)}
                    </div>
                  )}
              </section>
            )}

            {task.deliverable !== undefined && (
              <section className="task-detail-card" data-testid="task-deliverable">
                <h4 className="task-detail-card-title">交付物</h4>
                <p className="detail-line">{task.deliverable.summary}</p>
                <ul className="task-clean-list">
                  {task.deliverable.docs.map(doc => (
                    <li key={doc}>
                      <Button variant="ghost" size="sm" data-testid="task-doc" onPress={() => { props.onOpenDoc(doc) }}>{doc}</Button>
                    </li>
                  ))}
                  {task.deliverable.commands.map(command => <li key={command}><code>{command}</code></li>)}
                </ul>
              </section>
            )}

            {task.attachments.length > 0 && (
              <section className="task-detail-card" data-testid="task-attachments">
                <h4 className="task-detail-card-title">附件</h4>
                <ul className="task-clean-list">
                  {task.attachments.map(path => <li key={path}><code>{path}</code></li>)}
                </ul>
                <TaskAttachments scopeSessionId={props.project.scopeSessionId} paths={task.attachments} />
              </section>
            )}
          </div>

          <aside className="task-detail-aside">
            <section className="task-detail-card" data-testid="task-scope">
              <div className="task-detail-card-head">
                <h4 className="task-detail-card-title">改动范围与约束</h4>
                <Button
                  isIconOnly
                  className="task-detail-icon-action"
                  variant="ghost"
                  size="sm"
                  data-testid="task-scope-toggle"
                  aria-label={t('task.scopeDetails')}
                  aria-expanded={scopeOpen}
                  ref={(node) => { if (node !== null) node.title = t('task.scopeDetails') }}
                  onPress={() => { setScopeOpen(current => !current) }}
                >
                  <SlidersHorizontal size={15} aria-hidden="true" />
                </Button>
              </div>
              {scopeOpen && (
                <dl className="task-scope-list">
                  <div className="task-scope-item">
                    <dt>允许修改路径</dt>
                    <dd data-testid="task-paths">
                      {task.paths.length === 0
                        ? <span className="empty">暂未限定</span>
                        : (
                          <div className="task-path-chips">
                            {task.paths.map(path => <code key={path} className="task-path-chip">{path}</code>)}
                          </div>
                        )}
                    </dd>
                  </div>
                  {task.dependsOn.length > 0 && (
                    <div className="task-scope-item">
                      <dt>前置依赖</dt>
                      <dd className="mono">{task.dependsOn.join('、')}</dd>
                    </div>
                  )}
                  {task.rules.length > 0 && (
                    <div className="task-scope-item">
                      <dt>规范约束</dt>
                      <dd data-testid="task-rules">{ruleLabels.join('、')}</dd>
                    </div>
                  )}
                  {task.evidence.length > 0 && (
                    <div className="task-scope-item">
                      <dt>验收命令</dt>
                      <dd data-testid="task-evidence">{task.evidence.join('、')}</dd>
                    </div>
                  )}
                  {task.irreversible.length > 0 && (
                    <div className="task-scope-item">
                      <dt>不可逆动作</dt>
                      <dd>{task.irreversible.join('、')}</dd>
                    </div>
                  )}
                  {task.session !== undefined && (
                    <div className="task-scope-item">
                      <dt>认领会话</dt>
                      <dd className="mono">{task.session}</dd>
                    </div>
                  )}
                </dl>
              )}
            </section>

            {task.state !== 'drafting' && (
              <details className="task-detail-card task-schedule-disclosure" data-testid="task-schedule">
                <summary className="task-schedule-summary">
                  <span>调度建议</span>
                  <span className="mono" data-testid="schedule-verdict" data-verdict={schedule.verdict}>
                    {schedule.verdict}{schedule.chosen === undefined ? '' : ` · ${schedule.chosen.slice(0, 8)}`}
                  </span>
                </summary>
                <div className="task-schedule-body">
                  <ul className="task-clean-list">
                    {schedule.reasons.map(reason => <li key={reason}>{reason}</li>)}
                  </ul>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="schedule-record"
                    isDisabled={busy !== null}
                    onPress={() => {
                      void execute('schedule', `/task_schedule ${task.id} ${JSON.stringify({ verdict: schedule.verdict, reasons: schedule.reasons })}`)
                    }}
                  >
                    记录调度判定
                  </Button>
                </div>
              </details>
            )}
          </aside>
        </div>
      </div>
      {advanceConfirmOpen && createPortal(
        <div
          className="pending-dialog-backdrop"
          data-testid="task-advance-confirm-backdrop"
          onClick={(event) => { if (event.target === event.currentTarget) setAdvanceConfirmOpen(false) }}
        >
          <div
            className="pending-dialog"
            style={{ width: 'min(420px, calc(100vw - 32px))' }}
            role="dialog"
            aria-modal="true"
            aria-label={t('task.advanceConfirmTitle')}
            data-testid="task-advance-confirm-dialog"
          >
            <header className="pending-dialog-head">
              <h2>{t('task.advanceConfirmTitle')}</h2>
              <button
                type="button"
                className="pending-dialog-close"
                data-testid="task-advance-confirm-dismiss"
                aria-label={t('drawer.close')}
                onClick={() => { setAdvanceConfirmOpen(false) }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <p data-testid="task-advance-confirm-hint">{t('task.advanceConfirmHint', { role: displayRole })}</p>
            <div className="pending-actions">
              <Button size="sm" variant="secondary" data-testid="task-advance-confirm-cancel" onPress={() => { setAdvanceConfirmOpen(false) }}>
                {t('task.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                data-testid="task-advance-confirm-start"
                onPress={() => { setAdvanceConfirmOpen(false); void confirmAndAdvance() }}
              >
                {t('task.advanceConfirmStart')}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <DocumentReaderDialog
        open={techReaderOpen}
        text={descriptionParts.technical}
        title={task.title}
        subtitle={task.id}
        t={t}
        testIdPrefix="task-tech"
        onClose={() => { setTechReaderOpen(false) }}
      />
    </DetailDrawer>
  )
}
