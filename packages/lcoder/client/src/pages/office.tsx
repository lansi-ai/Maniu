/** 办公室页：展示参与本项目的所有成员（姓名与岗位分离、按职能分类与搜索筛选、折叠查看提示词与工作记录）。 */
import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Briefcase, Building2, FileText, Plus, Search } from 'lucide-react'
import { Button, Chip } from '@heroui/react'

import { runCommand, type CommandOutcome } from '../commands/run.ts'
import type { Translate } from '../locale.ts'
import { STATE_LABELS } from '../spec/board.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { JobRoleRow, TaskRow } from '../spec/rows.ts'
import type { SessionSummary } from '../store.ts'
import type { BuiltinPresetView, TalentRow } from '../talents/model.ts'
import type { TalentsHandle } from '../talents/use-talents.ts'
import type { ProjectScope } from '../workspace/use-workspaces.ts'

/** 办公室页属性。 */
export interface OfficePageProps {
  readonly t: Translate
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly sessions: readonly SessionSummary[]
  readonly talents: TalentsHandle
  readonly onReload: () => void
  readonly onOpenSession?: ((sessionId: string) => void) | undefined
}

interface InheritOption {
  readonly id: string
  readonly label: string
}

const INHERIT_OPTIONS: readonly InheritOption[] = [
  { id: 'dev', label: '代码开发（读写代码与运行命令）' },
  { id: 'architect', label: '架构设计（方案设计与技术细节）' },
  { id: 'pm', label: '需求产品（需求梳理与方案确认）' },
  { id: 'manager', label: '研发管理（任务拆分与协调）' },
  { id: 'intake', label: '需求调研（立项与需求分析）' },
  { id: 'review', label: '评审验收（只读检查与评审）' },
  { id: 'prototype', label: '原型设计（绘制与调整交互原型）' },
]

/** 办公室职能分类。 */
export type OfficeCategory = 'all' | 'product' | 'design' | 'dev' | 'qa' | 'ops'

const CATEGORY_ORDER: readonly Exclude<OfficeCategory, 'all'>[] = [
  'product',
  'design',
  'dev',
  'qa',
  'ops',
]

function categoryLabelKey(category: OfficeCategory):
  | 'office.catAll'
  | 'office.catProduct'
  | 'office.catDesign'
  | 'office.catDev'
  | 'office.catQa'
  | 'office.catOps' {
  switch (category) {
    case 'all': return 'office.catAll'
    case 'product': return 'office.catProduct'
    case 'design': return 'office.catDesign'
    case 'dev': return 'office.catDev'
    case 'qa': return 'office.catQa'
    case 'ops': return 'office.catOps'
  }
}

function classifyRole(id: string, name: string, inherits: string): Exclude<OfficeCategory, 'all'> {
  const text = `${id} ${name}`.toLowerCase()
  if (text.includes('qa') || text.includes('test') || text.includes('测试') || inherits === 'review' || text.includes('评审')) {
    return 'qa'
  }
  if (inherits === 'pm' || inherits === 'intake' || inherits === 'requirement-editor') {
    return 'product'
  }
  if (inherits === 'architect' || inherits === 'prototype') {
    return 'design'
  }
  if (inherits === 'ops' || inherits === 'scheduler' || inherits === 'flow' || inherits === 'git') {
    return 'ops'
  }
  return 'dev'
}

/**
 * 把 `岗位-姓名` 拆分成独立的姓名与岗位头衔，用于卡片分开排版。
 * @param rawName - 原始显示名。
 * @returns 拆出的姓名与可选岗位头衔。
 */
export function splitMemberName(rawName: string): { readonly personName: string; readonly roleTitle?: string } {
  const trimmed = rawName.trim()
  const sepIndex = Math.max(trimmed.lastIndexOf('-'), trimmed.lastIndexOf('—'))
  if (sepIndex > 0 && sepIndex < trimmed.length - 1) {
    const left = trimmed.slice(0, sepIndex).trim()
    const right = trimmed.slice(sepIndex + 1).trim()
    if (left !== '' && right !== '') {
      return { personName: right, roleTitle: left }
    }
  }
  return { personName: trimmed }
}

const BUILTIN_PERSON_MAP: Readonly<Record<string, { readonly personName: string; readonly roleTitle: string }>> = {
  'maniu-intake': { personName: '子墨', roleTitle: '需求分析师' },
  'maniu-pm': { personName: '文轩', roleTitle: '项目经理' },
  'maniu-architect': { personName: '明远', roleTitle: '架构师' },
  'maniu-manager': { personName: '志远', roleTitle: '研发经理' },
  'maniu-prototype': { personName: '若汐', roleTitle: '原型设计师' },
  'maniu-requirement-editor': { personName: '安然', roleTitle: '需求修改' },
  'maniu-review': { personName: '清扬', roleTitle: '评审专家' },
  maniu: { personName: '天成', roleTitle: '实施' },
  'maniu-git': { personName: '守正', roleTitle: 'Git 协管' },
  'maniu-ops': { personName: '星河', roleTitle: '运维' },
  'maniu-scheduler': { personName: '知微', roleTitle: '智能调度' },
  'maniu-flow': { personName: '流云', roleTitle: '流程控制' },
}

function presetToInherit(presetId: string): string {
  const key = presetId.toLowerCase()
  if (key.includes('architect')) return 'architect'
  if (key.includes('manager')) return 'manager'
  if (key.includes('intake')) return 'intake'
  if (key.includes('prototype')) return 'prototype'
  if (key.includes('pm')) return 'pm'
  if (key.includes('review')) return 'review'
  if (key.includes('ops')) return 'ops'
  if (key.includes('scheduler')) return 'scheduler'
  if (key.includes('flow')) return 'flow'
  if (key.includes('git')) return 'git'
  return 'dev'
}

function toRoleId(rawName: string, fallbackPrefix: string): string {
  const ascii = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  if (/^[a-z][a-z0-9_-]{1,39}$/u.test(ascii)) return ascii
  const stamp = Math.abs(Array.from(rawName).reduce((acc, ch) => ((acc * 31) + ch.charCodeAt(0)) | 0, 7))
    .toString(36)
  const base = `${fallbackPrefix}-${ascii === '' ? stamp : `${ascii}-${stamp}`}`
  return base.slice(0, 40)
}

function avatarInitial(personName: string): string {
  const clean = personName.trim()
  if (clean === '') return '人'
  return clean.slice(0, 1).toUpperCase()
}

interface UnifiedMember {
  readonly id: string
  readonly kind: 'project' | 'system'
  readonly personName: string
  readonly roleTitle?: string
  readonly category: Exclude<OfficeCategory, 'all'>
  readonly originLabel: string
  readonly persona: string
  readonly tasks: readonly TaskRow[]
  readonly sessions: readonly SessionSummary[]
}

/**
 * 办公室页面。
 * @param props - 项目、规格投影、会话与系统人才库控制器。
 * @returns 办公室视图。
 */
export function OfficePage(props: OfficePageProps): JSX.Element {
  const { t, project, projection, sessions, talents } = props
  const [recruitOpen, setRecruitOpen] = useState(false)
  const [mode, setMode] = useState<'derive' | 'create'>('derive')
  const [sourceId, setSourceId] = useState<string>('')
  const [roleTitle, setRoleTitle] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberId, setMemberId] = useState('')
  const [inherits, setInherits] = useState('dev')
  const [persona, setPersona] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<CommandOutcome | null>(null)
  const [category, setCategory] = useState<OfficeCategory>('all')
  const [search, setSearch] = useState('')
  const [expandedPrompt, setExpandedPrompt] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedWork, setExpandedWork] = useState<ReadonlySet<string>>(() => new Set())

  const deriveSources = useMemo(() => {
    const builtins = talents.builtins.map((b: BuiltinPresetView) => ({
      id: b.id,
      label: `${b.name ?? b.id}（系统内置）`,
      inherits: presetToInherit(b.id),
      persona: b.description ?? '',
    }))
    const globals = talents.global.map((g: TalentRow) => ({
      id: g.id,
      label: `${g.name}（团队人才库）`,
      inherits: presetToInherit(g.id),
      persona: g.description,
    }))
    return [...builtins, ...globals]
  }, [talents.builtins, talents.global])

  const selectedSource = useMemo(
    () => deriveSources.find(item => item.id === sourceId) ?? deriveSources[0],
    [deriveSources, sourceId],
  )

  const togglePrompt = (id: string): void => {
    setExpandedPrompt((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleWork = (id: string): void => {
    setExpandedWork((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const tasksByRole = useMemo(() => {
    const map = new Map<string, TaskRow[]>()
    for (const task of projection.tasks) {
      if (task.role === undefined) continue
      const list = map.get(task.role) ?? []
      list.push(task)
      map.set(task.role, list)
    }
    return map
  }, [projection.tasks])

  const sessionsByRole = useMemo(() => {
    const map = new Map<string, SessionSummary[]>()
    for (const s of sessions) {
      const key = s.agentPreset
      if (key === undefined) continue
      const list = map.get(key) ?? []
      list.push(s)
      map.set(key, list)
    }
    return map
  }, [sessions])

  const allMembers = useMemo((): readonly UnifiedMember[] => {
    const projectMembers: UnifiedMember[] = projection.roles.map((role: JobRoleRow) => {
      const parsed = splitMemberName(role.name)
      const originLabel = role.derivedFrom !== undefined
        ? (role.derivedFrom === t('office.badgeCreated')
          ? t('office.badgeCreated')
          : t('office.derivedFrom', { source: role.derivedFrom }))
        : t('office.badgeProjectRole')
      return {
        id: role.id,
        kind: 'project',
        personName: parsed.personName,
        ...(parsed.roleTitle === undefined ? {} : { roleTitle: parsed.roleTitle }),
        category: classifyRole(role.id, role.name, role.inherits),
        originLabel,
        persona: role.persona ?? '',
        tasks: tasksByRole.get(role.id) ?? [],
        sessions: sessionsByRole.get(role.id) ?? [],
      }
    })

    const customIds = new Set(projection.roles.map(r => r.id))
    const activeIds = new Set<string>()
    for (const node of projection.flow?.nodes ?? []) {
      for (const r of node.roles) activeIds.add(r)
    }
    for (const s of sessions) {
      const key = s.agentPreset
      if (key !== undefined && key !== 'maniu-workbench') activeIds.add(key)
    }
    const systemMembers: UnifiedMember[] = []
    for (const id of activeIds) {
      if (customIds.has(id)) continue
      const builtin = talents.builtins.find(b => b.id === id)
      const globalRow = talents.global.find(g => g.id === id)
      const name = builtin?.name ?? globalRow?.name
      if (name === undefined) continue
      const inh = presetToInherit(id)
      const mapped = BUILTIN_PERSON_MAP[id]
      const parsed = mapped ?? splitMemberName(name)
      const fullPersona = builtin?.description ?? globalRow?.description ?? ''
      systemMembers.push({
        id,
        kind: 'system',
        personName: parsed.personName,
        roleTitle: mapped?.roleTitle ?? parsed.roleTitle ?? name,
        category: classifyRole(id, name, inh),
        originLabel: t('office.badgeSystem'),
        persona: fullPersona,
        tasks: [],
        sessions: sessionsByRole.get(id) ?? [],
      })
    }

    return [...projectMembers, ...systemMembers]
  }, [
    projection.flow?.nodes,
    projection.roles,
    sessions,
    sessionsByRole,
    t,
    talents.builtins,
    talents.global,
    tasksByRole,
  ])

  const categoryCounts = useMemo(() => {
    const counts: Record<OfficeCategory, number> = {
      all: allMembers.length,
      product: 0,
      design: 0,
      dev: 0,
      qa: 0,
      ops: 0,
    }
    for (const member of allMembers) {
      counts[member.category] += 1
    }
    return counts
  }, [allMembers])

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allMembers.filter((member) => {
      if (category !== 'all' && member.category !== category) return false
      if (needle === '') return true
      const haystack = `${member.personName} ${member.roleTitle ?? ''} ${member.originLabel} ${member.id}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [allMembers, category, search])

  const groupedMembers = useMemo(() => {
    const groups: { readonly category: Exclude<OfficeCategory, 'all'>; readonly members: readonly UnifiedMember[] }[] = []
    for (const cat of CATEGORY_ORDER) {
      const members = filteredMembers.filter(item => item.category === cat)
      if (members.length > 0) groups.push({ category: cat, members })
    }
    return groups
  }, [filteredMembers])

  const submitMember = async (): Promise<void> => {
    if (project === null || busy) return
    const cleanName = memberName.trim()
    if (cleanName === '') return
    const titlePart = roleTitle.trim() !== ''
      ? roleTitle.trim()
      : (mode === 'derive' && selectedSource !== undefined
        ? selectedSource.label.replace(/（(?:系统内置|团队人才库)）$/u, '').replace(/^慢牛/u, '')
        : '')
    const fullName = titlePart !== '' && !cleanName.includes('-') && !cleanName.includes('—')
      ? `${titlePart}-${cleanName}`
      : cleanName
    const effectiveInherits = mode === 'derive' && selectedSource !== undefined
      ? selectedSource.inherits
      : inherits
    const cleanId = memberId.trim() === ''
      ? toRoleId(fullName, effectiveInherits)
      : memberId.trim().toLowerCase()
    const cleanPersona = persona.trim() !== ''
      ? persona.trim()
      : (mode === 'derive' ? selectedSource?.persona ?? '' : '')
    const derivedFrom = mode === 'derive' && selectedSource !== undefined
      ? selectedSource.label.replace(/（(?:系统内置|团队人才库)）$/u, '')
      : t('office.badgeCreated')

    setBusy(true)
    setNotice(null)
    try {
      const payload = {
        id: cleanId,
        name: fullName,
        inherits: effectiveInherits,
        derived_from: derivedFrom,
        ...(cleanPersona === '' ? {} : { persona: cleanPersona }),
      }
      const outcome = await runCommand(project.scopeSessionId, `/role_upsert ${JSON.stringify(payload)}`)
      setNotice(outcome)
      if (outcome.ok) {
        setRoleTitle('')
        setMemberName('')
        setMemberId('')
        setPersona('')
        setRecruitOpen(false)
        props.onReload()
      }
    } finally {
      setBusy(false)
    }
  }

  const renderCard = (member: UnifiedMember): JSX.Element => {
    const promptOpen = expandedPrompt.has(member.id)
    const workOpen = expandedWork.has(member.id)
    const isSystem = member.kind === 'system'
    return (
      <article
        className={isSystem ? 'office-card office-card-system' : 'office-card'}
        key={member.id}
        data-testid={isSystem ? 'office-system-card' : 'office-member-card'}
        data-member-id={member.id}
      >
        <div className="office-card-head">
          <span className={isSystem ? 'office-avatar office-avatar-system' : 'office-avatar'} aria-hidden="true">
            {avatarInitial(member.personName)}
          </span>
          <div className="office-identity">
            <div className="office-name-row">
              <strong className="office-name" data-testid={`office-member-name-${member.id}`}>{member.personName}</strong>
            </div>
            <div className="office-tags-row">
              {member.roleTitle !== undefined && (
                <span className="office-role-tag" data-testid={`office-member-role-${member.id}`}>{member.roleTitle}</span>
              )}
              <span className="office-origin-badge" data-testid={`office-member-origin-${member.id}`}>
                {member.originLabel}
              </span>
            </div>
          </div>
          <div className="office-icon-actions">
            <button
              type="button"
              className={promptOpen ? 'office-icon-btn active' : 'office-icon-btn'}
              data-testid={`office-prompt-toggle-${member.id}`}
              aria-label={t('office.togglePrompt')}
              aria-expanded={promptOpen}
              title={t('office.togglePrompt')}
              onClick={() => { togglePrompt(member.id) }}
            >
              <FileText size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={workOpen ? 'office-icon-btn active' : 'office-icon-btn'}
              data-testid={`office-work-toggle-${member.id}`}
              aria-label={t('office.toggleWork')}
              aria-expanded={workOpen}
              title={t('office.toggleWork')}
              onClick={() => { toggleWork(member.id) }}
            >
              <Briefcase size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        {promptOpen && (
          <div className="office-fold-panel" data-testid={`office-prompt-panel-${member.id}`}>
            <div className="office-fold-title">{t('office.promptHeading')}</div>
            <p className="office-fold-body">
              {member.persona === '' ? t('office.emptyPrompt') : member.persona}
            </p>
          </div>
        )}

        {workOpen && (
          <div className="office-fold-panel" data-testid={`office-work-panel-${member.id}`}>
            <div className="office-fold-title">{t('office.workHeading')}</div>
            {member.kind === 'project'
              ? (member.tasks.length === 0
                ? <p className="empty">{t('office.emptyWork')}</p>
                : (
                  <ul className="office-work-list">
                    {member.tasks.map(item => (
                      <li key={item.id}>
                        <span className="mono">{item.id}</span>
                        <span>{item.title}</span>
                        <Chip size="sm" variant="soft">{STATE_LABELS[item.state] ?? item.state}</Chip>
                      </li>
                    ))}
                  </ul>
                ))
              : (member.sessions.length === 0
                ? <p className="empty">{t('office.emptyWork')}</p>
                : (
                  <ul className="office-work-list">
                    {member.sessions.slice(0, 6).map(s => (
                      <li key={s.sessionId}>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => { props.onOpenSession?.(s.sessionId) }}
                        >
                          {s.title ?? s.sessionId.slice(0, 8)}
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}
          </div>
        )}
      </article>
    )
  }

  return (
    <section className="page office-page" data-testid="office-page">
      <header className="page-head">
        <div>
          <h2>{t('office.title')}</h2>
          <p className="subtitle">{t('office.subtitle')}</p>
        </div>
        {project !== null && (
          <Button
            variant="primary"
            size="sm"
            data-testid="office-recruit-toggle"
            onPress={() => {
              setNotice(null)
              setRecruitOpen(current => !current)
            }}
          >
            <Plus size={14} aria-hidden="true" />
            <span>{t('office.recruit')}</span>
          </Button>
        )}
      </header>

      {project === null && (
        <p className="empty" data-testid="office-no-project">{t('office.noProject')}</p>
      )}

      {project !== null && recruitOpen && (
        <section className="office-recruit-card" data-testid="office-recruit-form">
          <div className="office-mode-tabs">
            <button
              type="button"
              className={mode === 'derive' ? 'office-mode-tab active' : 'office-mode-tab'}
              data-testid="office-mode-derive"
              onClick={() => { setMode('derive') }}
            >
              {t('office.modeDerive')}
            </button>
            <button
              type="button"
              className={mode === 'create' ? 'office-mode-tab active' : 'office-mode-tab'}
              data-testid="office-mode-create"
              onClick={() => { setMode('create') }}
            >
              {t('office.modeCreate')}
            </button>
          </div>

          <div className="office-form-grid">
            {mode === 'derive' && (
              <label className="office-field">
                <span>{t('office.sourceLabel')}</span>
                <select
                  className="select"
                  data-testid="office-source-select"
                  value={selectedSource?.id ?? ''}
                  onChange={(event) => {
                    const nextId = event.target.value
                    setSourceId(nextId)
                    const found = deriveSources.find(item => item.id === nextId)
                    if (found !== undefined) {
                      if (persona.trim() === '') setPersona(found.persona)
                      if (roleTitle.trim() === '') {
                        setRoleTitle(found.label.replace(/（(?:系统内置|团队人才库)）$/u, '').replace(/^慢牛/u, ''))
                      }
                    }
                  }}
                >
                  {deriveSources.map(item => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="office-field">
              <span>{t('office.roleTitleLabel')}</span>
              <input
                className="search"
                data-testid="office-role-title-input"
                value={roleTitle}
                placeholder={t('office.roleTitlePlaceholder')}
                onChange={(event) => { setRoleTitle(event.target.value) }}
              />
            </label>

            <label className="office-field">
              <span>{t('office.nameLabel')}</span>
              <input
                className="search"
                data-testid="office-name-input"
                value={memberName}
                placeholder={mode === 'derive' ? t('office.namePlaceholderDerive') : t('office.namePlaceholderCreate')}
                onChange={(event) => { setMemberName(event.target.value) }}
              />
            </label>

            {mode === 'create' && (
              <label className="office-field">
                <span>{t('office.inheritLabel')}</span>
                <select
                  className="select"
                  data-testid="office-inherit-select"
                  value={inherits}
                  onChange={(event) => { setInherits(event.target.value) }}
                >
                  {INHERIT_OPTIONS.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="office-field office-field-wide">
              <span>{t('office.personaLabel')}</span>
              <textarea
                className="prototype-regen-textarea"
                data-testid="office-persona-input"
                value={persona}
                placeholder={t('office.personaPlaceholder')}
                onChange={(event) => { setPersona(event.target.value) }}
              />
            </label>
          </div>

          <div className="action-row">
            <Button
              variant="primary"
              size="sm"
              data-testid="office-recruit-submit"
              isDisabled={busy || memberName.trim() === '' || (mode === 'derive' && selectedSource === undefined)}
              onPress={() => { void submitMember() }}
            >
              {t('office.submit')}
            </Button>
            <Button variant="ghost" size="sm" onPress={() => { setRecruitOpen(false) }}>
              {t('task.cancel')}
            </Button>
          </div>
        </section>
      )}

      {notice !== null && (
        <p className={notice.ok ? 'detail-line' : 'problem'} data-testid="office-notice">
          {notice.text}
        </p>
      )}

      {project !== null && allMembers.length > 0 && (
        <div className="office-toolbar" data-testid="office-toolbar">
          <div className="office-category-pills" role="tablist" aria-label={t('office.title')}>
            {(['all', ...CATEGORY_ORDER] as const).map((cat) => {
              const count = categoryCounts[cat]
              if (cat !== 'all' && count === 0) return null
              const active = category === cat
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`office-cat-${cat}`}
                  className={active ? 'office-cat-pill active' : 'office-cat-pill'}
                  onClick={() => { setCategory(cat) }}
                >
                  <span>{t(categoryLabelKey(cat))}</span>
                  <span className="office-cat-count">{count}</span>
                </button>
              )
            })}
          </div>
          <label className="office-search-wrap">
            <Search size={14} aria-hidden="true" className="office-search-icon" />
            <input
              className="search office-search-input"
              data-testid="office-search"
              value={search}
              placeholder={t('office.searchPlaceholder')}
              onChange={(event) => { setSearch(event.target.value) }}
            />
          </label>
        </div>
      )}

      {project !== null && (
        allMembers.length === 0
          ? <p className="empty" data-testid="office-empty-members">{t('office.emptyMembers')}</p>
          : filteredMembers.length === 0
            ? <p className="empty" data-testid="office-empty-filtered">{t('office.emptyFiltered')}</p>
            : category === 'all' && groupedMembers.length > 1
              ? (
                <div className="office-sections">
                  {groupedMembers.map(group => (
                    <section className="office-section" key={group.category} data-testid={`office-group-${group.category}`}>
                      <div className="office-section-head">
                        <h3>{t(categoryLabelKey(group.category))} ({group.members.length})</h3>
                      </div>
                      <div className="office-grid">
                        {group.members.map(renderCard)}
                      </div>
                    </section>
                  ))}
                </div>
              )
              : (
                <div className="office-grid">
                  {filteredMembers.map(renderCard)}
                </div>
              )
      )}
    </section>
  )
}

export { Building2 as OfficeNavIcon }
