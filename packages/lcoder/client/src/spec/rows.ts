/** `.spec` 各 YAML 文本 → 展示行；只收文件里写着的事实。 */

import { parse as parseYaml } from 'yaml'

/** 任务行。 */
export interface TaskRow {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category?: string
  readonly changeType?: string
  readonly attachments: readonly string[]
  readonly state: string
  readonly grade: string
  readonly rules: readonly string[]
  readonly evidence: readonly string[]
  readonly session?: string
  readonly proposal?: string
  readonly requirement?: string
  readonly dependsOn: readonly string[]
  readonly role?: string
  readonly track?: string
  readonly paths: readonly string[]
  readonly irreversible: readonly string[]
  readonly openedAt?: string
  readonly deliverable?: DeliverableRow
}

/** 交付索引。 */
export interface DeliverableRow {
  readonly task: string
  readonly summary: string
  readonly docs: readonly string[]
  readonly commands: readonly string[]
  readonly createdAt?: string
  readonly updatedAt?: string
}

/** 岗位信号，只供建议层排序。 */
export interface RoleSignals {
  readonly strong: readonly string[]
  readonly medium: readonly string[]
  readonly preferredPaths: readonly string[]
}

/** 岗位行。 */
export interface JobRoleRow {
  readonly id: string
  readonly name: string
  readonly inherits: string
  readonly persona?: string
  readonly signals?: RoleSignals
}

/** 需求里的一条候选做法。 */
export interface RequirementOptionRow {
  readonly name: string
  readonly summary: string
  readonly cost?: string
}

/** 需求行（含正文）。 */
export interface RequirementDocRow {
  readonly id: string
  readonly text: string
  readonly title?: string
  readonly state?: 'draft' | 'confirmed' | 'released' | 'closed' | 'unknown'
  readonly options: readonly RequirementOptionRow[]
  readonly recommendation?: string
  readonly openedAt?: string
  readonly confirmedAt?: string
  readonly releasedAt?: string
  readonly closedAt?: string
}

/** 规则行。 */
export interface RuleRow {
  readonly id: string
  readonly module: string
  readonly kind: string
  readonly status: string
  readonly text: string
}

/** 契约行。 */
export interface ContractRow {
  readonly id: string
  readonly change: readonly string[]
  readonly notChange: readonly string[]
  readonly acceptance: readonly string[]
  readonly failIf: readonly string[]
  readonly signedBy: 'human' | 'agent' | null
  readonly signedAt: string | null
  readonly signedActor?: string
}

/** 方案行。 */
export interface ProposalRow {
  readonly id: string
  readonly title: string
  readonly problem: string
  readonly options: readonly ProposalOptionRow[]
  readonly recommendation: string
  readonly decision: 'draft' | 'approved' | 'rejected' | 'unknown'
  readonly decidedAt: string | null
}

/** 方案里的一条候选。 */
export interface ProposalOptionRow {
  readonly name: string
  readonly summary: string
  readonly cost: string
}

/** 联调组。 */
export interface SchedulingGroupRow {
  readonly id: string
  readonly sessionId: string
  readonly members: readonly string[]
  readonly createdAt: string
}

/** 自动化动作名。 */
export const AUTOMATION_ACTIONS = ['draft', 'contract', 'sign', 'implement', 'verify', 'close', 'commit'] as const
/** 一个动作名。 */
export type AutomationActionRow = (typeof AUTOMATION_ACTIONS)[number]
/** 一个动作的执行方式。 */
export type AutomationModeRow = 'auto' | 'manual'

/** 停止条件；null 表示不设限。 */
export interface AutomationLimitsRow {
  readonly tokenBudget: number | null
  readonly maxMinutes: number | null
  readonly maxConsecutiveFailures: number | null
  readonly maxParallel: number | null
}

/** `.spec/automation.yaml` 的展示数据。 */
export interface AutomationPolicyRow {
  readonly actions: Readonly<Record<AutomationActionRow, AutomationModeRow>>
  readonly limits: AutomationLimitsRow
  readonly tasks: readonly string[]
}

/** 两条常驻调度会话。 */
export interface AgentsRow {
  readonly schedulerSession?: string
  readonly flowSession?: string
}

/** 项目环境；敏感值只留引用名。 */
export interface ProjectEnvironmentRow {
  readonly id: string
  readonly label: string
  readonly server?: string
  readonly note?: string
  readonly database?: {
    readonly host: string
    readonly port?: string
    readonly name: string
    readonly user: string
    readonly passwordRef: string
  }
}

/** 项目追加的轨。 */
export interface ProjectTrackRow {
  readonly id: string
  readonly name: string
}

/** `.spec/project.yaml` 的展示数据。 */
export interface ProjectInfoRow {
  readonly kind: 'web' | 'desktop' | 'library'
  readonly repoUrl: string
  readonly branch: string
  readonly docs: { readonly product: string; readonly architecture: string; readonly tests: string }
  readonly environments: readonly ProjectEnvironmentRow[]
  readonly tracks: readonly ProjectTrackRow[]
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function parsed(text: string): Record<string, unknown> | undefined {
  try {
    return recordOf(parseYaml(text))
  } catch {
    return undefined
  }
}

/**
 * 任务 YAML → 行。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示任务；读不懂为 undefined。
 */
export function taskTextToRow(fileName: string, text: string): TaskRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const title = asText(fields.title)
  if (title === undefined) return undefined
  const scope = recordOf(fields.scope)
  const category = asText(fields.category)
  const changeType = asText(fields.change_type)
  const session = asText(fields.session)
  const proposal = asText(fields.proposal)
  const requirement = asText(fields.requirement)
  const role = asText(fields.role)
  const track = asText(fields.track)
  const openedAt = asText(fields.opened_at)
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    title,
    description: asText(fields.description) ?? '',
    ...(category === undefined ? {} : { category }),
    ...(changeType === undefined ? {} : { changeType }),
    attachments: stringArray(fields.attachments),
    state: asText(fields.state) ?? 'unknown',
    grade: asText(fields.grade) ?? '-',
    rules: stringArray(fields.rules),
    evidence: stringArray(fields.evidence_required),
    ...(session === undefined ? {} : { session }),
    ...(proposal === undefined ? {} : { proposal }),
    ...(requirement === undefined ? {} : { requirement }),
    ...(role === undefined ? {} : { role }),
    ...(track === undefined ? {} : { track }),
    dependsOn: stringArray(fields.depends_on),
    paths: stringArray(scope?.allowed_paths),
    irreversible: stringArray(scope?.irreversible),
    ...(openedAt === undefined ? {} : { openedAt }),
  }
}

/**
 * 规则库文本 → 行。
 * @param text - `rules.yaml` 正文。
 * @returns 规则行；解析失败为空表。
 */
export function rulesTextToRows(text: string): RuleRow[] {
  const doc = parsed(text)
  const list = doc?.rules
  if (!Array.isArray(list)) return []
  return list.flatMap((entry: unknown) => {
    const fields = recordOf(entry)
    const id = asText(fields?.id)
    const body = asText(fields?.text)
    if (fields === undefined || id === undefined || body === undefined) return []
    return [{
      id,
      module: asText(fields.module) ?? '',
      kind: asText(fields.kind) ?? 'rule',
      status: asText(fields.status) ?? 'draft',
      text: body,
    }]
  })
}

/**
 * 契约 YAML → 行。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示契约；读不懂为 undefined。
 */
export function contractTextToRow(fileName: string, text: string): ContractRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const change = stringArray(fields.change)
  const acceptance = stringArray(fields.acceptance)
  if (change.length === 0 || acceptance.length === 0) return undefined
  const sig = recordOf(fields.sig)
  const by = sig?.by
  const actor = asText(sig?.actor)
  const signedBy = by === 'human' || by === 'agent' ? by : null
  return {
    id: asText(fields.id) ?? fileName.replace(/\.contract\.yaml$/, ''),
    change,
    notChange: stringArray(fields.not_change),
    acceptance,
    failIf: stringArray(fields.fail_if),
    signedBy,
    signedAt: sig === undefined ? null : (asText(sig.at) ?? null),
    ...(signedBy === 'agent' && actor !== undefined ? { signedActor: actor } : {}),
  }
}

/**
 * 自动化策略文本 → 行。
 * @param text - 文件正文。
 * @returns 可展示策略；读不懂为 undefined。
 */
export function automationTextToRow(text: string): AutomationPolicyRow | undefined {
  const doc = parsed(text)
  if (doc === undefined) return undefined
  const actions = recordOf(doc.actions)
  const limits = recordOf(doc.limits)
  const mode = (name: AutomationActionRow): AutomationModeRow => actions?.[name] === 'auto' ? 'auto' : 'manual'
  return {
    actions: {
      draft: mode('draft'),
      contract: mode('contract'),
      sign: mode('sign'),
      implement: mode('implement'),
      verify: mode('verify'),
      close: mode('close'),
      commit: mode('commit'),
    },
    limits: {
      tokenBudget: positiveInt(limits?.token_budget),
      maxMinutes: positiveInt(limits?.max_minutes),
      maxConsecutiveFailures: nonNegativeInt(limits?.max_consecutive_failures),
      maxParallel: positiveInt(limits?.max_parallel),
    },
    tasks: stringArray(doc.tasks),
  }
}

/**
 * 联调组 YAML → 行。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示联调组；读不懂为 undefined。
 */
export function groupTextToRow(fileName: string, text: string): SchedulingGroupRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const sessionId = asText(fields.session)
  const createdAt = asText(fields.created_at)
  const members = stringArray(fields.members)
  if (sessionId === undefined || createdAt === undefined || members.length === 0) return undefined
  return { id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''), sessionId, members, createdAt }
}

/**
 * 方案 YAML → 行。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示方案；读不懂为 undefined。
 */
export function proposalTextToRow(fileName: string, text: string): ProposalRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const title = asText(fields.title)
  const problem = asText(fields.problem)
  const recommendation = asText(fields.recommendation)
  if (title === undefined || problem === undefined || recommendation === undefined) return undefined
  const options = (Array.isArray(fields.options) ? fields.options : []).flatMap((entry: unknown) => {
    const record = recordOf(entry)
    const name = asText(record?.name)
    if (name === undefined) return []
    return [{ name, summary: asText(record?.summary) ?? '', cost: asText(record?.cost) ?? '' }]
  })
  const decision = asText(fields.decision)
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    title,
    problem,
    options,
    recommendation,
    decision: decision === 'draft' || decision === 'approved' || decision === 'rejected' ? decision : 'unknown',
    decidedAt: asText(fields.decided_at) ?? null,
  }
}

/**
 * 需求 YAML → 行（正文由读取侧补）。
 * @param fileName - 文件名，缺 id 时兜底。
 * @param text - 文件正文。
 * @returns 可展示需求元数据；读不懂为 undefined。
 */
export function requirementTextToRow(fileName: string, text: string): Omit<RequirementDocRow, 'text'> | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const title = asText(fields.title)
  if (title === undefined) return undefined
  const options = (Array.isArray(fields.options) ? fields.options : []).flatMap((entry: unknown) => {
    const record = recordOf(entry)
    const name = asText(record?.name)
    const summary = asText(record?.summary)
    if (name === undefined || summary === undefined) return []
    const cost = asText(record?.cost)
    return [{ name, summary, ...(cost === undefined ? {} : { cost }) }]
  })
  const rawState = asText(fields.state)
  const state = rawState === undefined
    ? 'draft'
    : rawState === 'draft' || rawState === 'confirmed' || rawState === 'released' || rawState === 'closed'
      ? rawState
      : 'unknown'
  const recommendation = asText(fields.recommendation)
  const openedAt = asText(fields.opened_at)
  const confirmedAt = asText(fields.confirmed_at)
  const releasedAt = asText(fields.released_at)
  const closedAt = asText(fields.closed_at)
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    title,
    state,
    options,
    ...(recommendation === undefined ? {} : { recommendation }),
    ...(openedAt === undefined ? {} : { openedAt }),
    ...(confirmedAt === undefined ? {} : { confirmedAt }),
    ...(releasedAt === undefined ? {} : { releasedAt }),
    ...(closedAt === undefined ? {} : { closedAt }),
  }
}

function repoRelativeDocs(value: unknown): string[] {
  return stringArray(value).filter((doc) => {
    if (/^(?:[A-Za-z]:|[\\/])/.test(doc)) return false
    return !doc.split(/[\\/]/).includes('..')
  })
}

/**
 * 交付索引 YAML → 行。
 * @param fileName - 文件名，缺 task 时兜底。
 * @param text - 文件正文。
 * @returns 可展示交付索引；读不懂为 undefined。
 */
export function deliverableTextToRow(fileName: string, text: string): DeliverableRow | undefined {
  const fields = parsed(text)
  if (fields === undefined) return undefined
  const summary = asText(fields.summary)
  if (summary === undefined) return undefined
  const createdAt = asText(fields.created_at)
  const updatedAt = asText(fields.updated_at)
  return {
    task: asText(fields.task) ?? fileName.replace(/\.yaml$/, ''),
    summary,
    docs: repoRelativeDocs(fields.docs),
    commands: stringArray(fields.commands),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

function roleSignalsOf(value: unknown): RoleSignals | undefined {
  const fields = recordOf(value)
  if (fields === undefined) return undefined
  const signals: RoleSignals = {
    strong: stringArray(fields.strong),
    medium: stringArray(fields.medium),
    preferredPaths: stringArray(fields.preferredPaths),
  }
  return signals.strong.length + signals.medium.length + signals.preferredPaths.length === 0 ? undefined : signals
}

/**
 * 岗位名册 YAML → 行。
 * @param text - `roles.yaml` 正文。
 * @returns 岗位行；缺文件时为空表。
 */
export function rolesTextToRows(text: string): JobRoleRow[] {
  const doc = parsed(text)
  const list = Array.isArray(doc?.roles) ? doc.roles : []
  return list.flatMap((entry: unknown) => {
    const fields = recordOf(entry)
    const id = asText(fields?.id)
    const name = asText(fields?.name)
    const inherits = asText(fields?.inherits)
    if (id === undefined || name === undefined || inherits === undefined) return []
    const persona = asText(fields?.persona)
    const signals = roleSignalsOf(fields?.signals)
    return [{
      id,
      name,
      inherits,
      ...(persona === undefined ? {} : { persona }),
      ...(signals === undefined ? {} : { signals }),
    }]
  })
}

/**
 * 项目 YAML → 行。
 * @param text - `project.yaml` 正文。
 * @returns 项目信息；读不懂为 undefined。
 */
export function projectTextToRow(text: string): ProjectInfoRow | undefined {
  const doc = parsed(text)
  if (doc === undefined) return undefined
  const kind = doc.kind === 'web' || doc.kind === 'desktop' || doc.kind === 'library' ? doc.kind : 'library'
  const repo = recordOf(doc.repo)
  const docs = recordOf(doc.docs)
  const tracks: ProjectTrackRow[] = (Array.isArray(doc.tracks) ? doc.tracks : []).flatMap((raw: unknown) => {
    const track = recordOf(raw)
    const id = asText(track?.id)
    const name = asText(track?.name)
    return id === undefined || name === undefined ? [] : [{ id, name }]
  })
  const environments: ProjectEnvironmentRow[] = Object.entries(recordOf(doc.environments) ?? {}).flatMap(([id, raw]) => {
    const env = recordOf(raw)
    if (env === undefined) return []
    const database = recordOf(env.database)
    const port = database?.port
    const server = asText(env.server)
    const note = asText(env.note)
    return [{
      id,
      label: id,
      ...(server === undefined ? {} : { server }),
      ...(note === undefined ? {} : { note }),
      ...(database === undefined
        ? {}
        : {
          database: {
            host: asText(database.host) ?? '',
            ...(typeof port === 'string' ? { port } : typeof port === 'number' ? { port: String(port) } : {}),
            name: asText(database.name) ?? '',
            user: asText(database.user) ?? '',
            passwordRef: asText(database.passwordRef) ?? '',
          },
        }),
    }]
  })
  return {
    kind,
    repoUrl: asText(repo?.url) ?? '',
    branch: asText(repo?.branch) ?? '—',
    docs: {
      product: asText(docs?.product) ?? '',
      architecture: asText(docs?.architecture) ?? '',
      tests: asText(docs?.tests) ?? '',
    },
    environments,
    tracks,
  }
}

/**
 * `local.yaml` → 引用名到本机值；只留在内存。
 * @param text - 文件正文。
 * @returns 敏感值映射；读不懂为空表。
 */
export function localSecretsOf(text: string): Record<string, string> {
  const doc = parsed(text)
  if (doc === undefined) return {}
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(recordOf(doc.secrets) ?? doc)) {
    if (typeof value === 'string') out[name] = value
  }
  return out
}

/**
 * `agents.yaml` → 两条常驻会话。
 * @param text - 文件正文。
 * @returns 会话号；缺字段时对应项缺省。
 */
export function agentsTextToRow(text: string): AgentsRow | undefined {
  const doc = parsed(text)
  if (doc === undefined) return undefined
  const schedulerSession = asText(doc.schedulerSession)
  const flowSession = asText(doc.flowSession)
  return {
    ...(schedulerSession === undefined ? {} : { schedulerSession }),
    ...(flowSession === undefined ? {} : { flowSession }),
  }
}

/**
 * 判断失败是否只是「目标还不存在」。
 * @param error - 远程失败字段。
 * @param path - 目标路径。
 * @returns 缺失时为 true。
 */
export function isMissing(error: { readonly code?: unknown; readonly message?: unknown }, path: string): boolean {
  const code = typeof error.code === 'string' ? error.code : ''
  if (code.includes('not-found') || code.includes('ENOENT')) return true
  const message = typeof error.message === 'string' ? error.message : ''
  return message.includes(path) && (message.includes('ENOENT') || message.includes('does not exist') || message.includes('不存在'))
}
