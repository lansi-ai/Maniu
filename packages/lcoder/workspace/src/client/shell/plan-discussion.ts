/**
 * 方案讨论与契约门禁：拆出任务后、进入待开发前的会议规模判定、参与岗位、
 * 逐任务契约起草与用户确认。
 *
 * 会议粒度不固定：大任务开完整多岗位会，B 级单岗位任务由该岗位加架构师讨论，
 * C 级且没有不可逆项的小改动只开该岗位的单会话。判定全是纯函数，流程只靠注入的
 * 会话与投影事实推进，便于单测。
 *
 * 契约仍是模型工具 `contract_draft` 的产物；签署与推进仍是人机命令。外壳只负责
 * 建会话、发指令、读回契约与逐条执行命令，不新增内核状态，也不让模型自己签或推。
 */
import type { ContractRow } from '../projection.ts'
import type { ShellBoardColumnId, ShellSignResult, ShellTask } from './shell-data.ts'
import { boundRequirementText, taskDigest } from './requirement.ts'
import { BUILTIN_TRACKS } from '@lcoder/kernel/src/schema/tracks.ts'
import type { TrackDescriptor } from '@lcoder/kernel/src/schema/tracks.ts'
import { lastAssistantText, waitForTurn } from './session-turn.ts'
import type { SessionTurnPorts } from './session-turn.ts'

/** 一轮讨论或起草的等待上限：三分钟与拆分流程一致。 */
export const PLAN_DISCUSSION_TIMEOUT_MS = 180_000
/** 轮询间隔：只看会话与投影事实。 */
export const PLAN_DISCUSSION_POLL_MS = 1_000
/** 讨论产物就是契约，起草后最多再读三次投影等它落盘。 */
const CONTRACT_READ_ATTEMPTS = 3

/** 会议规模三档：完整多轨会、单轨会、单条小任务会；三档都固定三方入会。 */
export type MeetingTier = 'full' | 'paired' | 'solo'

/** 参与讨论的角色类别；提示词按它写职责。 */
export type MeetingRoleKind = 'analyst' | 'pm' | 'manager' | 'architect' | 'track'

/** 一个参与讨论的角色：稳定 id、展示名、类别、继承的内置角色与会话 preset。 */
export interface MeetingRole {
  readonly id: string
  readonly name: string
  readonly kind: MeetingRoleKind
  readonly inherits: string
  readonly preset: string
  /** 项目追加轨或名册岗位的补充说明；内置角色没有。 */
  readonly persona?: string
}

/** 讨论提示词里的身份标记；重启后按它把会话认回角色，不靠猜测。 */
export const MEETING_ROLE_MARKER = '参会身份：'

/** 固定三方：需求分析师、项目经理、研发经理。 */
export const ANALYST_ROLE: MeetingRole = {
  id: 'analyst',
  name: '需求分析师',
  kind: 'analyst',
  inherits: 'intake',
  preset: 'lcoder-intake',
}

export const PM_MEETING_ROLE: MeetingRole = {
  id: 'pm',
  name: '项目经理',
  kind: 'pm',
  inherits: 'pm',
  preset: 'lcoder-pm',
}

export const MANAGER_MEETING_ROLE: MeetingRole = {
  id: 'manager',
  name: '研发经理',
  kind: 'manager',
  inherits: 'manager',
  preset: 'lcoder-manager',
}

/** 架构师：固定入会、汇总各方意见并逐任务起草契约。 */
export const ARCHITECT_ROLE: MeetingRole = {
  id: 'architect',
  name: '架构师',
  kind: 'architect',
  inherits: 'architect',
  preset: 'lcoder-architect',
}

/** 内置技术轨的显示名；与 kernel 的内置轨保持同一份顺序。 */
const TRACK_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  BUILTIN_TRACKS.map(track => [track.id, track.name]),
)

/**
 * 一条轨 → 讨论里的技术岗位。
 *
 * 内置轨 h5/admin/api/desktop/host 用 dev 面、显示名按轨；general 由架构师兼顾；
 * 项目追加轨同样走 dev 面，显示名用项目里的名字。未知轨返回 undefined，
 * 由流程如实报「轨无法映射」，不猜一个岗位顶上。
 * @param track - 任务上的轨 id；缺省时按 general 处理。
 * @param tracks - 内置轨加项目追加轨。
 * @returns 参与讨论的技术岗位；轨未知时为 undefined。
 */
export function technicalRoleOf(
  track: string | undefined,
  tracks: readonly TrackDescriptor[],
): MeetingRole | undefined {
  const id = track ?? 'general'
  if (id === 'general') return ARCHITECT_ROLE
  const known = [...BUILTIN_TRACKS, ...tracks].find(item => item.id === id)
  if (known === undefined) return undefined
  return {
    id: `track-${id}`,
    name: `${known.name}工程师`,
    kind: 'track',
    inherits: 'dev',
    preset: 'lcoder',
  }
}

/** 基础框架/架构任务的关键词；命中即按大任务开会。 */
const FOUNDATION_PATTERN = /基础框架|脚手架|技术选型|架构/u

/**
 * 任务是不是基础框架/架构任务。
 * @param task - 看板任务。
 * @returns 标题或描述命中关键词时为 true。
 */
export function isFoundationTask(task: ShellTask): boolean {
  return FOUNDATION_PATTERN.test(`${task.title}\n${task.description}`)
}

/**
 * 单条任务的会议规模。
 *
 * 大任务：A 级、有不可逆项、基础框架/架构任务，或这批任务涉及三个以上不同技术岗位。
 * C 级且没有不可逆项的小改动按轻量会；其余按 B 级处理。三档都固定三方入会，
 * 规模只决定是否把多条任务并成一个会。
 * @param task - 看板任务。
 * @param techRole - 这条任务按轨映射出的技术岗位；缺省时只看任务自身。
 * @param involvedTracks - 这批任务涉及的不同技术岗位数。
 * @returns 会议规模。
 */
export function meetingTierOf(task: ShellTask, techRole?: MeetingRole, involvedTracks = 1): MeetingTier {
  if (task.grade === 'A') return 'full'
  if (task.irreversible.length > 0) return 'full'
  if (isFoundationTask(task) || techRole?.inherits === 'architect') return 'full'
  if (involvedTracks >= 3) return 'full'
  if (task.grade === 'C') return 'solo'
  return 'paired'
}

/** 一个讨论组：同一规模、同一组参与角色与轨的任务共用一个会议。 */
export interface DiscussionGroup {
  /** 规模与轨拼成的稳定键；同键只建一次会议。 */
  readonly key: string
  readonly tier: MeetingTier
  /** 参与角色：固定三方、按轨技术岗位与架构师，去重后保持顺序。 */
  readonly roles: readonly MeetingRole[]
  readonly taskIds: readonly string[]
  /** 这个组涉及的轨 id。 */
  readonly tracks: readonly string[]
}

/** 一次方案讨论的计划：分组与无法映射的轨。 */
export interface DiscussionPlan {
  readonly groups: readonly DiscussionGroup[]
  /** 轨映射不到技术岗位的任务；非空时流程不给这些任务开会。 */
  readonly unresolved: readonly { readonly taskId: string; readonly track: string }[]
}

/** 角色按 id 去重，保持首次出现顺序。 */
function dedupeRoles(roles: readonly MeetingRole[]): MeetingRole[] {
  const seen = new Set<string>()
  const out: MeetingRole[] = []
  for (const role of roles) {
    if (seen.has(role.id)) continue
    seen.add(role.id)
    out.push(role)
  }
  return out
}

/**
 * 一个会的参与角色：固定三方 + 按轨技术岗位 + 架构师。
 * 技术岗位是 general 时就是架构师，去重后不会出现两次。
 */
function meetingRolesOf(trackRoles: readonly MeetingRole[]): readonly MeetingRole[] {
  return dedupeRoles([
    ANALYST_ROLE,
    PM_MEETING_ROLE,
    MANAGER_MEETING_ROLE,
    ...trackRoles,
    ARCHITECT_ROLE,
  ])
}

/**
 * 把一批待讨论任务分成会议组。
 *
 * 大任务合成一个完整会，覆盖所有大任务涉及的轨；其余按轨分组。
 * 同一轨的任务共用一个会，因此「同轨只建一次」与「小任务不建多会话」同时成立。
 * @param tasks - 这批待讨论的 drafting 任务。
 * @param tracks - 内置轨加项目追加轨。
 * @returns 分组与无法映射的轨；任务没有轨时按 general 处理。
 */
export function planDiscussionGroups(
  tasks: readonly ShellTask[],
  tracks: readonly TrackDescriptor[],
): DiscussionPlan {
  const unresolved: { taskId: string; track: string }[] = []
  const entries: { task: ShellTask; role: MeetingRole; track: string }[] = []
  for (const task of tasks) {
    const track = task.track ?? 'general'
    const role = technicalRoleOf(track, tracks)
    if (role === undefined) {
      unresolved.push({ taskId: task.id, track })
      continue
    }
    entries.push({ task, role, track })
  }
  if (entries.length === 0) return { groups: [], unresolved }

  const involved = new Set(entries.map(entry => entry.role.id)).size
  const tiers = new Map<string, MeetingTier>()
  for (const entry of entries) tiers.set(entry.task.id, meetingTierOf(entry.task, entry.role, involved))

  const groups: DiscussionGroup[] = []
  const full = entries.filter(entry => tiers.get(entry.task.id) === 'full')
  if (full.length > 0) {
    const roles = meetingRolesOf(dedupeRoles(full.map(entry => entry.role)))
    groups.push({
      key: `full:${roles.map(role => role.id).join(',')}`,
      tier: 'full',
      roles,
      taskIds: full.map(entry => entry.task.id),
      tracks: [...new Set(full.map(entry => entry.track))],
    })
  }
  const rest = entries.filter(entry => tiers.get(entry.task.id) !== 'full')
  const byTrack = new Map<string, { role: MeetingRole; taskIds: string[]; tiers: MeetingTier[] }>()
  for (const entry of rest) {
    const current = byTrack.get(entry.track)
    const tier = tiers.get(entry.task.id) ?? 'paired'
    if (current === undefined) byTrack.set(entry.track, { role: entry.role, taskIds: [entry.task.id], tiers: [tier] })
    else {
      current.taskIds.push(entry.task.id)
      current.tiers.push(tier)
    }
  }
  for (const [track, group] of byTrack.entries()) {
    const tier: MeetingTier = group.tiers.includes('paired') ? 'paired' : 'solo'
    const roles = meetingRolesOf([group.role])
    groups.push({
      key: `${tier}:${track}`,
      tier,
      roles,
      taskIds: group.taskIds,
      tracks: [track],
    })
  }
  return { groups, unresolved }
}

/** 一次讨论里的一条会议会话。 */
export interface MeetingRun {
  readonly tier: MeetingTier
  readonly taskIds: readonly string[]
  readonly role: MeetingRole
  readonly sessionId: string
  readonly ok: boolean
  /** 宿主给的具体原因；成功时没有。 */
  readonly detail?: string
}

/** 一条任务的契约起草结果。 */
export interface DraftRun {
  readonly taskId: string
  readonly ok: boolean
  /** 起草会话的岗位名；没有时为空串。 */
  readonly drafter: string
  readonly detail?: string
}

/** 契约投影里的那份契约；缺失时为 undefined。 */
export function contractOf(
  contracts: readonly ContractRow[],
  taskId: string,
): ContractRow | undefined {
  return contracts.find(row => row.id === taskId)
}

/**
 * 契约是否已签；agent 自签也算签过，但它仍要过推进命令的三补偿闸。
 * @param contract - 契约投影；缺失时为 undefined。
 * @returns 有签名时为 true。
 */
export function contractSigned(contract: ContractRow | undefined): boolean {
  return contract !== undefined && contract.signedBy !== null
}

/**
 * 契约四项必填是否齐全：改什么、不改什么、怎么算过、什么算失败。
 *
 * `contract_draft` 允许缺省后三项，但方案讨论的产物要求四段完整；缺一段就退回重讨论，
 * 不拿半截契约进签署。
 * @param contract - 契约投影；缺失时为 undefined。
 * @returns 四项都非空时为 true。
 */
export function contractComplete(contract: ContractRow | undefined): boolean {
  return contract !== undefined
    && contract.change.length > 0
    && contract.notChange.length > 0
    && contract.acceptance.length > 0
    && contract.failIf.length > 0
}

/**
 * 这批任务是否还需要跑方案讨论。
 *
 * 判据是契约投影：所有任务都有完整契约（已签或未签）就不重复建会话；刷新、重开
 * 与重复点击都据此停在方案讨论列，只等确认。用户点「重新讨论」时由调用方强制重跑。
 * @param tasks - 这批待讨论任务。
 * @param contracts - 当前契约投影。
 * @returns 有任务缺契约或缺必填项时为 true。
 */
export function discussionNeeded(
  tasks: readonly ShellTask[],
  contracts: readonly ContractRow[],
): boolean {
  return tasks.some(task => !contractComplete(contractOf(contracts, task.id)))
}

/**
 * 看板列：方案讨论与真实状态。
 *
 * drafting 且已标轨（或旧数据已分配岗位）的任务进方案讨论；契约签了也先留在这里，
 * 直到 `task_contract` 把状态推到 contracted。旧需求本体（既没有轨也没有岗位）返回
 * `drafting`，任务页没有这一列，因此不会画出来。其它状态原样。
 * @param task - 看板任务。
 * @returns 看板列 id。
 */
export function boardColumnOf(task: ShellTask): ShellBoardColumnId {
  if (task.state !== 'drafting') return task.state
  return task.track === undefined && task.role === undefined ? 'drafting' : 'discussion'
}

/**
 * 同一条需求下仍待在方案讨论的任务：回指同一需求、已标轨或旧数据已分配岗位、仍为 drafting。
 *
 * 需求编号优先读 `requirement`，旧任务退回 `proposal`；两者都没有时为空。
 * @param tasks - 当前投影里的全部任务。
 * @param task - 用户打开的那条任务。
 * @returns 这批任务，按投影顺序。
 */
export function discussionTasksOf(tasks: readonly ShellTask[], task: ShellTask): readonly ShellTask[] {
  const requirement = task.requirement ?? task.proposal
  if (requirement === undefined) return []
  return tasks.filter(row => (row.requirement ?? row.proposal) === requirement
    && row.state === 'drafting'
    && (row.track !== undefined || row.role !== undefined))
}

/**
 * 轨的显示名：内置轨用内置名，项目追加轨用项目里的名字。
 * @param track - 轨 id。
 * @param tracks - 内置轨加项目追加轨。
 * @returns 显示名；未知轨原样返回 id。
 */
export function trackNameOf(track: string | undefined, tracks: readonly TrackDescriptor[]): string {
  if (track === undefined) return TRACK_NAMES['general'] ?? 'general'
  return TRACK_NAMES[track] ?? tracks.find(item => item.id === track)?.name ?? track
}

/** 一条任务给讨论会话看的字段。 */
function taskLines(task: ShellTask, tracks: readonly TrackDescriptor[]): readonly string[] {
  return [
    `- ${task.id}：${task.title}`,
    `  描述摘要：${taskDigest(task)}`,
    `  轨：${trackNameOf(task.track, tracks)}；分级：${task.grade}；规则：${task.rules.join('、') || '（未声明）'}；依赖：${(task.dependsOn ?? []).join('、') || '（无）'}`,
  ]
}

/** 参与角色一行；没有 persona 时只写继承角色。 */
function roleLines(roles: readonly MeetingRole[]): readonly string[] {
  return roles.map(role => `- ${role.name}（${role.id}，继承 ${role.inherits}）${role.persona === undefined ? '' : `：${role.persona}`}`)
}

/** 讨论正文的上限；会议记录进起草指令时按段落截断，不切半句。 */
const MAX_MINUTES_CHARS = 2_000

/** 把一段会议记录收进上限。 */
function boundMinutes(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_MINUTES_CHARS) return trimmed
  const head = trimmed.slice(0, MAX_MINUTES_CHARS)
  const at = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('。'), head.lastIndexOf('；'))
  return `${at > MAX_MINUTES_CHARS / 4 ? head.slice(0, at + 1) : head}…`
}

/** 讨论会与起草会共用的输入：需求文档、任务、参与角色与可用轨。 */
export interface MeetingContext {
  /** `.spec/requirements/<需求编号>.md` 的完整正文。 */
  readonly document: string
  /** 需求编号（REQ-xx）；契约与需求文档同号。 */
  readonly requirement: string
  /** 这批任务。 */
  readonly tasks: readonly ShellTask[]
  /** 本批参与角色，按入会顺序去重。 */
  readonly roles: readonly MeetingRole[]
  /** 内置轨加项目追加轨；只用于把轨 id 换成显示名。 */
  readonly tracks: readonly TrackDescriptor[]
}

/**
 * 一个角色在会议里的职责。三方固定各说各的角度，技术岗位只谈自己那条轨；
 * 没人在这里写任务、写代码或起草契约——那是架构师会后的动作。
 * @param role - 参加会议的角色。
 * @returns 若干条职责说明。
 */
function dutyLines(role: MeetingRole): readonly string[] {
  switch (role.kind) {
    case 'analyst':
      return [
        '- 先核对需求覆盖：逐条说明第一版功能清单是否都被这批任务覆盖，指出漏项。',
        '- 指出与需求文档不一致的地方、缺口与歧义，以及调研结论（仓库现状、技术栈依据）。',
        '- 不写任务、不给技术实现；只把需求口径说清楚。',
      ]
    case 'pm':
      return [
        '- 说明拆分依据：每条任务对应哪条需求、边界到哪、依赖关系怎么排。',
        '- 说明轨划分的理由；对拆得过粗或过细的地方给出调整建议。',
        '- 不重新拆任务、不改需求文档；只解释与校对这批拆分。',
      ]
    case 'manager':
      return [
        '- 给出跨轨依赖与落地风险：哪些任务必须先后、哪些接口要先定。',
        '- 判断验收是否可行，指出缺的验证手段或环境。',
        '- 需要新岗位时只给建议（岗位名与理由），不落盘、不调用分配命令。',
      ]
    case 'architect':
      return [
        '- 汇总三方与技术岗位的意见，指出冲突与需要拍板的点。',
        '- 为每条任务提炼契约要点：改什么、不改什么、怎么算过、什么算失败。',
        '- 会后逐任务调用 contract_draft 起草契约；会议里不签契约、不推状态。',
      ]
    case 'track':
      return [
        `- 你代表「${role.name}」这条轨：给出该轨的落地方案、模块边界与接口约定。`,
        '- 指出本轨任务的主要风险与验收建议，需要别的轨配合时明确说出来。',
        '- 不越界替别的轨定方案；不写代码、不改任务。',
      ]
  }
}

/**
 * 单个角色的会议指令：共同上下文 + 该角色的职责与产出要求。
 *
 * 会议只谈落地方案、风险与验收建议；不改任务、不写代码、不签契约、不推状态。
 * @param context - 需求、任务与参与角色。
 * @param role - 这个会话的角色。
 * @returns 中文指令正文。
 */
export function buildMeetingPrompt(context: MeetingContext, role: MeetingRole): string {
  const excerpt = boundRequirementText(context.document)
  const path = `.spec/requirements/${context.requirement}.md`
  return [
    `方案讨论：需求 ${context.requirement} 已按轨拆分，请参加落地方案讨论。`,
    `${MEETING_ROLE_MARKER}${role.name}（${role.id}）`,
    '',
    `依据：以末尾附上的《项目需求概要》（${path}）为准；文档里暂不开发的范围不要讨论。`,
    '',
    '本批任务：',
    ...context.tasks.flatMap(task => taskLines(task, context.tracks)),
    '',
    '参与角色与职责：',
    ...roleLines(context.roles),
    '',
    '你的职责：',
    ...dutyLines(role),
    '- 逐条任务给出关注点时要能落地：指出要动的模块与边界、要遵守的规则编号、与其他任务的依赖与接口约定。',
    '- 只讨论方案：不写代码、不改任务与需求、不签契约、不推进任务状态、不调用编辑或命令工具。',
    '- 最后用一个简短小结收束，方便架构师汇总；不要输出空泛的套话。',
    '',
    `《项目需求概要》正文（${path}）：`,
    '"""',
    excerpt.text,
    '"""',
    ...(excerpt.truncated
      ? ['', `（正文在本指令里按段落截断在上限内；未附上的部分请读取 ${path} 后再讨论。）`]
      : []),
  ].join('\n')
}

/**
 * 架构师的契约起草指令。
 *
 * 会议记录附在后面；要求逐任务调用 `contract_draft`，四项必填齐全，写清规则依据
 * 与依赖。模型不能签契约，也不能推状态。
 * @param context - 需求、任务与岗位。
 * @param minutes - 各岗位的会议记录。
 * @returns 中文指令正文。
 */
export function buildContractDraftPrompt(
  context: MeetingContext,
  minutes: readonly { readonly role: string; readonly text: string }[],
): string {
  const excerpt = boundRequirementText(context.document)
  const path = `.spec/requirements/${context.requirement}.md`
  return [
    `契约起草：需求 ${context.requirement} 的方案讨论已完成，请逐条任务用 contract_draft 起草契约。`,
    '',
    `依据：以末尾附上的《项目需求概要》（${path}）与下面的会议记录为准；两者冲突时以需求文档为准。`,
    '',
    '要起草的任务：',
    ...context.tasks.flatMap(task => taskLines(task, context.tracks)),
    '',
    '要求：',
    '- 先汇总各岗位的落地方案关注点、风险与验收建议，再逐条任务起草；冲突时以需求文档为准。',
    '- 每条任务调用一次 contract_draft，一次只写一条；task_id 用工整的任务编号。',
    '- 四个字段必填且都要非空：change（要改什么，写明规则编号与依赖）、not_change（明确不碰的范围）、acceptance（可观察的验收）、fail_if（明确的失败条件）。',
    '- change 与 acceptance 要和任务描述、规则编号、依赖一致；会议记录里的风险与验收建议能落地的写进 acceptance 或 fail_if。',
    '- 只起草契约：不写代码、不改任务与需求、不签契约、不推进任务状态、不调用编辑或命令工具。',
    '- 完成后逐条回报哪个任务已起草、哪个失败，不要只给一句总结。',
    '',
    '会议记录：',
    ...(minutes.length === 0
      ? ['（没有会议记录：按需求文档与任务字段起草。）']
      : minutes.flatMap(item => [`【${item.role}】`, boundMinutes(item.text), ''])),
    `《项目需求概要》正文（${path}）：`,
    '"""',
    excerpt.text,
    '"""',
    ...(excerpt.truncated
      ? ['', `（正文在本指令里按段落截断在上限内；未附上的部分请读取 ${path} 后再起草。）`]
      : []),
  ].join('\n')
}

/** 方案讨论流程的阶段；界面据此显示「讨论中」或「起草契约中」。 */
export type PlanDiscussionStage = 'meeting' | 'drafting'

/** 一次进度通知。 */
export interface PlanDiscussionProgress {
  readonly stage: PlanDiscussionStage
  readonly tier: MeetingTier
  readonly roles: readonly MeetingRole[]
  readonly taskIds: readonly string[]
}

/** 失败原因；界面按它查词典，不直接显示这段 code。 */
export type PlanDiscussionFailureReason =
  | 'no-document'
  | 'no-tasks'
  | 'unknown-role'
  | 'create'
  | 'send'
  | 'timeout'
  | 'session-failed'
  | 'missing-contract'
  | 'incomplete-contract'
  | 'unreadable-contracts'

/** 流程失败：停在哪一段、为什么、已经建过哪些会与起草过哪些契约。 */
export interface PlanDiscussionFailure {
  readonly kind: 'failed'
  readonly stage: 'plan' | 'meeting' | 'drafting'
  readonly reason: PlanDiscussionFailureReason
  /** 宿主给的具体原因；没有时为 undefined。 */
  readonly detail?: string
  /** 无法映射的轨；`unknown-role` 时出现。 */
  readonly unresolved?: readonly { readonly taskId: string; readonly track: string }[]
  /** 会前计划；失败时已算出的分组原样带回。 */
  readonly plan: DiscussionPlan
  readonly meetings: readonly MeetingRun[]
  readonly drafts: readonly DraftRun[]
  readonly contracts: readonly ContractRow[]
  /** 缺契约或契约不完整的任务；对应原因时出现。 */
  readonly taskIds?: readonly string[]
}

/** 流程完成：契约已起草（可能仍未签），等待用户确认。 */
export interface PlanDiscussionDone {
  readonly kind: 'done'
  readonly plan: DiscussionPlan
  readonly meetings: readonly MeetingRun[]
  readonly drafts: readonly DraftRun[]
  readonly contracts: readonly ContractRow[]
}

/** 流程结果。 */
export type PlanDiscussionOutcome = PlanDiscussionDone | PlanDiscussionFailure | { readonly kind: 'cancelled' }

/** 流程输入：这批任务、可用轨与需求文档。 */
export interface PlanDiscussionInput {
  readonly tasks: readonly ShellTask[]
  readonly tracks: readonly TrackDescriptor[]
  readonly document: string
  readonly requirement: string
  readonly timeoutMs?: number
  readonly pollMs?: number
}

/** 流程的外部动作；全部注入，便于不启 React 也能测整条链路。 */
export interface PlanDiscussionPorts extends SessionTurnPorts {
  /** 按参与岗位新建会话；调用方负责把岗位 id 记进本窗口的会话角色表。 */
  createSession(role: MeetingRole): Promise<string>
  sendPrompt(sessionId: string, text: string): Promise<void>
  /** 持有会话引用，返回释放函数；不持有就读不到消息。 */
  holdSession(sessionId: string): () => void
  loadContracts(): Promise<readonly ContractRow[]>
}

/** 等待调用方的额外输入。 */
export interface PlanDiscussionOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: PlanDiscussionProgress) => void
}

/** 失败结果的构造口。 */
function discussionFailure(
  stage: PlanDiscussionFailure['stage'],
  reason: PlanDiscussionFailureReason,
  plan: DiscussionPlan,
  extra: {
    readonly detail?: string
    readonly unresolved?: readonly { readonly taskId: string; readonly track: string }[]
    readonly meetings?: readonly MeetingRun[]
    readonly drafts?: readonly DraftRun[]
    readonly contracts?: readonly ContractRow[]
    readonly taskIds?: readonly string[]
  } = {},
): PlanDiscussionFailure {
  return {
    kind: 'failed',
    stage,
    reason,
    plan,
    meetings: extra.meetings ?? [],
    drafts: extra.drafts ?? [],
    contracts: extra.contracts ?? [],
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    ...(extra.unresolved === undefined ? {} : { unresolved: extra.unresolved }),
    ...(extra.taskIds === undefined ? {} : { taskIds: extra.taskIds }),
  }
}

/** 读契约投影；抛错时给一次空结果，由调用方按原因报。 */
async function readContracts(ports: PlanDiscussionPorts): Promise<{ rows: readonly ContractRow[]; error?: string }> {
  try {
    return { rows: await ports.loadContracts() }
  } catch (error: unknown) {
    return { rows: [], error: String(error) }
  }
}

/** 契约落盘是异步的：起草回合结束后最多再读三次投影。 */
async function contractsAfter(
  ports: PlanDiscussionPorts,
  taskIds: readonly string[],
  pollMs: number,
): Promise<{ rows: readonly ContractRow[]; missing: readonly string[]; error?: string }> {
  let last: { rows: readonly ContractRow[]; error?: string } = { rows: [] }
  for (let attempt = 0; attempt < CONTRACT_READ_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await ports.sleep(pollMs)
    last = await readContracts(ports)
    const missing = taskIds.filter(taskId => contractOf(last.rows, taskId) === undefined)
    if (missing.length === 0) return { rows: last.rows, missing: [] }
  }
  return {
    rows: last.rows,
    missing: taskIds.filter(taskId => contractOf(last.rows, taskId) === undefined),
    ...(last.error === undefined ? {} : { error: last.error }),
  }
}

/**
 * 跑完一次方案讨论：按会议组固定三方加按轨技术岗位讨论 → 架构师逐任务起草契约。
 *
 * 会话按角色去重，所有组复用同一个架构师会话。任何一段失败都返回原因、
 * 已建的会与已起草的契约，调用方保留任务在方案讨论列让用户重试；已有完整契约时
 * 调用方应先经 {@link discussionNeeded} 跳过，不重复建会话。
 * @param input - 任务、可用轨、需求文档与超时。
 * @param ports - 建会话、发送、读会话、读契约与轮询的注入面。
 * @param options - 取消信号与进度回调。
 * @returns 完成、失败或取消。
 */
export async function runPlanDiscussion(
  input: PlanDiscussionInput,
  ports: PlanDiscussionPorts,
  options: PlanDiscussionOptions = {},
): Promise<PlanDiscussionOutcome> {
  const timeoutMs = input.timeoutMs ?? PLAN_DISCUSSION_TIMEOUT_MS
  const pollMs = input.pollMs ?? PLAN_DISCUSSION_POLL_MS
  const emptyPlan: DiscussionPlan = { groups: [], unresolved: [] }
  if (boundRequirementText(input.document).text === '') {
    return discussionFailure('plan', 'no-document', emptyPlan)
  }
  if (input.tasks.length === 0) return discussionFailure('plan', 'no-tasks', emptyPlan)

  const plan = planDiscussionGroups(input.tasks, input.tracks)
  if (plan.unresolved.length > 0) {
    return discussionFailure('plan', 'unknown-role', plan, { unresolved: plan.unresolved })
  }
  const taskById = new Map(input.tasks.map(task => [task.id, task]))
  const allRoles = dedupeRoles(plan.groups.flatMap(group => [...group.roles]))
  const context: MeetingContext = {
    document: input.document,
    requirement: input.requirement,
    tasks: input.tasks,
    roles: allRoles,
    tracks: input.tracks,
  }

  const releases: (() => void)[] = []
  const sessions = new Map<string, string>()
  const sessionFor = async (role: MeetingRole): Promise<string> => {
    const existing = sessions.get(role.id)
    if (existing !== undefined) return existing
    const sessionId = await ports.createSession(role)
    sessions.set(role.id, sessionId)
    releases.push(ports.holdSession(sessionId))
    return sessionId
  }

  const meetings: MeetingRun[] = []
  const minutes = new Map<string, string>()
  try {
    for (const group of plan.groups) {
      options.onProgress?.({ stage: 'meeting', tier: group.tier, roles: group.roles, taskIds: group.taskIds })
      const opened: { role: MeetingRole; sessionId: string }[] = []
      for (const role of group.roles) {
        let sessionId: string
        try {
          sessionId = await sessionFor(role)
        } catch (error: unknown) {
          return discussionFailure('meeting', 'create', plan, {
            detail: String(error), meetings, contracts: [],
          })
        }
        try {
          await ports.sendPrompt(sessionId, buildMeetingPrompt(context, role))
        } catch (error: unknown) {
          return discussionFailure('meeting', 'send', plan, {
            detail: String(error), meetings,
          })
        }
        opened.push({ role, sessionId })
      }
      const waited = await Promise.all(opened.map(async ({ role, sessionId }) => ({
        role,
        sessionId,
        wait: await waitForTurn({
          ports,
          sessionId,
          timeoutMs,
          pollMs,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      })))
      if (waited.some(item => item.wait.kind === 'cancelled')) return { kind: 'cancelled' }
      for (const item of waited) {
        const ok = item.wait.kind === 'done'
        meetings.push({
          tier: group.tier,
          taskIds: group.taskIds,
          role: item.role,
          sessionId: item.sessionId,
          ok,
          ...(item.wait.kind === 'failed' ? { detail: item.wait.detail } : {}),
        })
        if (item.wait.kind === 'done') {
          const text = lastAssistantText(item.wait.messages)
          if (text !== null) minutes.set(item.role.id, text)
        }
      }
      const timedOut = waited.find(item => item.wait.kind === 'timeout')
      if (timedOut !== undefined) {
        return discussionFailure('meeting', 'timeout', plan, { meetings, detail: timedOut.role.name })
      }
      const failed = waited.find(item => item.wait.kind === 'failed')
      if (failed !== undefined) {
        const detail = failed.wait.kind === 'failed' ? failed.wait.detail : undefined
        return discussionFailure('meeting', 'session-failed', plan, {
          meetings,
          ...(detail === undefined ? {} : { detail }),
        })
      }
    }

    const drafts: DraftRun[] = []
    for (const group of plan.groups) {
      options.onProgress?.({ stage: 'drafting', tier: group.tier, roles: group.roles, taskIds: group.taskIds })
      // 架构师固定入会，契约也由它汇总各轨意见后逐任务起草。
      const drafter = ARCHITECT_ROLE
      let sessionId: string
      try {
        sessionId = await sessionFor(drafter)
      } catch (error: unknown) {
        return discussionFailure('drafting', 'create', plan, { detail: String(error), meetings, drafts })
      }
      const groupMinutes = group.roles.flatMap((role) => {
        const text = minutes.get(role.id)
        return text === undefined ? [] : [{ role: role.name, text }]
      })
      const groupTasks = group.taskIds.flatMap((taskId) => {
        const task = taskById.get(taskId)
        return task === undefined ? [] : [task]
      })
      try {
        await ports.sendPrompt(sessionId, buildContractDraftPrompt({ ...context, tasks: groupTasks }, groupMinutes))
      } catch (error: unknown) {
        return discussionFailure('drafting', 'send', plan, { detail: String(error), meetings, drafts })
      }
      const wait = await waitForTurn({
        ports,
        sessionId,
        timeoutMs,
        pollMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (wait.kind === 'cancelled') return { kind: 'cancelled' }
      if (wait.kind === 'timeout') {
        return discussionFailure('drafting', 'timeout', plan, { meetings, drafts, detail: drafter.name })
      }
      if (wait.kind === 'failed') {
        return discussionFailure('drafting', 'session-failed', plan, { meetings, drafts, detail: wait.detail })
      }
      const read = await contractsAfter(ports, group.taskIds, pollMs)
      if (read.error !== undefined) {
        return discussionFailure('drafting', 'unreadable-contracts', plan, {
          meetings, drafts, contracts: read.rows, detail: read.error,
        })
      }
      for (const taskId of group.taskIds) {
        const contract = contractOf(read.rows, taskId)
        drafts.push({
          taskId,
          ok: contract !== undefined,
          drafter: drafter.name,
          ...(contract === undefined ? { detail: 'no-contract' } : {}),
        })
      }
      if (read.missing.length > 0) {
        return discussionFailure('drafting', 'missing-contract', plan, {
          meetings, drafts, contracts: read.rows, taskIds: read.missing,
        })
      }
    }

    const read = await readContracts(ports)
    if (read.error !== undefined) {
      return discussionFailure('drafting', 'unreadable-contracts', plan, {
        meetings, drafts, detail: read.error,
      })
    }
    const incomplete = input.tasks
      .filter(task => !contractComplete(contractOf(read.rows, task.id)))
      .map(task => task.id)
    if (incomplete.length > 0) {
      return discussionFailure('drafting', 'incomplete-contract', plan, {
        meetings, drafts, contracts: read.rows, taskIds: incomplete,
      })
    }
    return { kind: 'done', plan, meetings, drafts, contracts: read.rows }
  } finally {
    for (const release of releases) release()
  }
}

/** 确认失败的原因；界面按它查词典。 */
export type PlanConfirmFailureReason =
  | 'missing-task'
  | 'not-drafting'
  | 'missing-contract'
  | 'sign-failed'
  | 'advance-failed'

/** 一条任务的确认结果。 */
export interface PlanConfirmAttempt {
  readonly taskId: string
  readonly ok: boolean
  /** 做了什么：签后推进、只推进，或已不在起草态而跳过。 */
  readonly action: 'sign-advance' | 'advance' | 'skip'
  readonly reason?: PlanConfirmFailureReason
  /** 宿主回执或错误原文；跳过时没有。 */
  readonly detail?: string
}

/** 一次确认的汇总。 */
export interface PlanConfirmSummary {
  readonly attempts: readonly PlanConfirmAttempt[]
  /** 成功进入待开发的条数。 */
  readonly confirmedCount: number
}

/** 确认所需的外部动作。 */
export interface PlanConfirmPorts {
  loadTasks(): Promise<readonly ShellTask[]>
  loadContracts(): Promise<readonly ContractRow[]>
  signContract(taskId: string): Promise<ShellSignResult>
  advanceContract(taskId: string): Promise<ShellSignResult>
}

/**
 * 用户确认方案后逐条签署并推进。
 *
 * 顺序固定：缺契约不签、不推；已人签的跳过签署；签署成功才执行 `/task_contract`。
 * 任一任务失败只记这一条，其余任务继续——失败的任务因状态没动而留在方案讨论列。
 * @param taskIds - 这批任务编号，按投影顺序。
 * @param ports - 投影读取与两条人机命令。
 * @returns 逐条结果与成功条数。
 */
export async function confirmPlan(
  taskIds: readonly string[],
  ports: PlanConfirmPorts,
): Promise<PlanConfirmSummary> {
  let tasks: readonly ShellTask[]
  let contracts: readonly ContractRow[]
  try {
    [tasks, contracts] = await Promise.all([ports.loadTasks(), ports.loadContracts()])
  } catch {
    return {
      attempts: taskIds.map(taskId => ({ taskId, ok: false, action: 'skip', reason: 'missing-task' })),
      confirmedCount: 0,
    }
  }
  const attempts: PlanConfirmAttempt[] = []
  let confirmedCount = 0
  for (const taskId of taskIds) {
    const task = tasks.find(row => row.id === taskId)
    if (task === undefined) {
      attempts.push({ taskId, ok: false, action: 'skip', reason: 'missing-task' })
      continue
    }
    if (task.state !== 'drafting') {
      const already = task.state === 'contracted'
      attempts.push({ taskId, ok: already, action: 'skip', ...(already ? {} : { reason: 'not-drafting' as const }) })
      if (already) confirmedCount += 1
      continue
    }
    const contract = contractOf(contracts, taskId)
    if (contract === undefined) {
      attempts.push({ taskId, ok: false, action: 'skip', reason: 'missing-contract' })
      continue
    }
    const signFirst = contract.signedBy !== 'human'
    if (signFirst) {
      let signed: ShellSignResult
      try {
        signed = await ports.signContract(taskId)
      } catch (error: unknown) {
        attempts.push({ taskId, ok: false, action: 'sign-advance', reason: 'sign-failed', detail: String(error) })
        continue
      }
      if (!signed.ok) {
        attempts.push({ taskId, ok: false, action: 'sign-advance', reason: 'sign-failed', detail: signed.text })
        continue
      }
    }
    let advanced: ShellSignResult
    try {
      advanced = await ports.advanceContract(taskId)
    } catch (error: unknown) {
      attempts.push({
        taskId, ok: false, action: signFirst ? 'sign-advance' : 'advance', reason: 'advance-failed', detail: String(error),
      })
      continue
    }
    attempts.push({
      taskId,
      ok: advanced.ok,
      action: signFirst ? 'sign-advance' : 'advance',
      ...(advanced.ok ? { detail: advanced.text } : { reason: 'advance-failed' as const, detail: advanced.text }),
    })
    if (advanced.ok) confirmedCount += 1
  }
  return { attempts, confirmedCount }
}
