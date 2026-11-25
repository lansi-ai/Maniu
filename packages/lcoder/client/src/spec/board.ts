/** 任务看板的五列与筛选；列是展示派生，不写回任务文件。 */

import type { RuleRow, TaskRow } from './rows.ts'

/** 岗位名里分隔人名的符号；取前段作为纯中文岗位名。 */
const ROLE_TITLE_SEPARATOR = /[-—–·|｜]/u
/** 汉字判定：纯英文 id 不进界面。 */
const HAS_HAN = /\p{Script=Han}/u

/**
 * 从岗位名或旧任务里的「岗位-人名」取纯中文岗位名。
 * @param name - 原始岗位名或岗位 id。
 * @returns 纯中文岗位名；无法展示时 undefined。
 */
export function roleTitleOf(name: string): string | undefined {
  const first = name.trim().split(ROLE_TITLE_SEPARATOR, 1)[0]?.trim() ?? ''
  return first === '' || !HAS_HAN.test(first) ? undefined : first
}

/** 把规范条目取成中文名称或摘要；没有中文时回退编号。 */
export function ruleTitleOf(rule: RuleRow): string {
  const summary = rule.text.split(/[\n。；;]/u, 1)[0]?.trim() ?? ''
  if (summary !== '' && HAS_HAN.test(summary)) return summary
  if (HAS_HAN.test(rule.module)) return rule.module
  return rule.id
}

/** 看板列 id。 */
export type BoardColumnId = 'discussion' | 'contracted' | 'implementing' | 'verifying' | 'closed'

/** 一列。 */
export interface BoardColumn {
  readonly id: BoardColumnId
  readonly label: string
}

/** 看板五列，顺序即视觉顺序。 */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { id: 'discussion', label: '待确认' },
  { id: 'contracted', label: '待开发' },
  { id: 'implementing', label: '开发中' },
  { id: 'verifying', label: '待验收' },
  { id: 'closed', label: '已完成' },
]

/** 任务状态的中文名。 */
export const STATE_LABELS: Readonly<Record<string, string>> = {
  drafting: '待确认',
  contracted: '待开发',
  implementing: '开发中',
  verifying: '待验收',
  closed: '已完成',
  unknown: '未知状态',
}

const TRACK_LABELS: Readonly<Record<string, string>> = {
  general: '通用基础',
  h5: '前端页面',
  web: '前端页面',
  frontend: '前端页面',
  fe: '前端页面',
  api: '后端接口',
  server: '后端接口',
  backend: '后端接口',
  data: '数据模型',
  db: '数据模型',
  desktop: '桌面端',
  mobile: '移动端',
  finance: '财务业务',
}

/**
 * 把内部 track 标识转成人类可读的端/模块名；去掉「轨」黑话。
 * @param track - 原始轨标识。
 * @returns 可读名称；缺省返回 undefined。
 */
export function trackLabel(track: string | undefined): string | undefined {
  if (track === undefined) return undefined
  const key = track.trim().toLowerCase()
  if (key === '') return undefined
  return TRACK_LABELS[key] ?? track.trim()
}

/** 内部内置角色 id → 中文可读名称。 */
const BUILTIN_ROLE_LABELS: Readonly<Record<string, string>> = {
  dev: '开发工程师',
  architect: '架构师',
  pm: '产品经理',
  manager: '研发经理',
  intake: '需求分析',
  review: '评审专家',
  prototype: '原型设计师',
  git: '版本管理',
  ops: '运维发布',
  scheduler: '调度协调',
  flow: '流程管理',
  'requirement-editor': '需求整理',
}

/**
 * 把任务负责人 id 转成中文显示名（优先查项目 .spec/roles.yaml，其次查内置角色中文名）。
 * @param roleId - 任务上的 role 字段。
 * @param roles - 项目岗位名册。
 * @returns 可读中文名称。
 */
export function roleLabel(
  roleId: string | undefined,
  roles: readonly { readonly id: string; readonly name: string }[] = [],
): string | undefined {
  if (roleId === undefined) return undefined
  const key = roleId.trim()
  if (key === '') return undefined
  const named = roles.find(item => item.id === key)?.name ?? BUILTIN_ROLE_LABELS[key] ?? key
  return roleTitleOf(named)
}

/**
 * 看板列：drafting 统一归入「待确认」，其余按状态落列。
 * @param task - 任务行。
 * @returns 列 id。
 */
export function boardColumnOf(task: TaskRow): BoardColumnId {
  if (task.state === 'contracted' || task.state === 'implementing'
    || task.state === 'verifying' || task.state === 'closed') return task.state
  return 'discussion'
}

/** 一条任务的运行态。 */
export type TaskRunStatus = 'idle' | 'running' | 'queued'

/**
 * 从认领会话与宿主会话列表推出运行态。
 * @param task - 任务行。
 * @param runningSessions - 正在跑的会话 id。
 * @returns 运行态；未认领为 idle。
 */
export function runStatusOf(task: TaskRow, runningSessions: ReadonlySet<string>): TaskRunStatus {
  if (task.session === undefined) return 'idle'
  return runningSessions.has(task.session) ? 'running' : 'queued'
}

/** 筛选条件。 */
export interface TaskFilter {
  readonly text: string
  readonly grade: string
  readonly column: string
  readonly session: string
  readonly role: string
}

/** 空筛选。 */
export const emptyTaskFilter: TaskFilter = { text: '', grade: '', column: '', session: '', role: '' }

/**
 * 按筛选条件过滤任务。
 * @param tasks - 全部任务。
 * @param filter - 筛选条件。
 * @returns 命中的任务。
 */
export function filterTasks(tasks: readonly TaskRow[], filter: TaskFilter): TaskRow[] {
  const text = filter.text.trim().toLowerCase()
  return tasks.filter((task) => {
    if (filter.grade !== '' && task.grade !== filter.grade) return false
    if (filter.column !== '' && boardColumnOf(task) !== filter.column) return false
    if (filter.session !== '' && task.session !== filter.session) return false
    if (filter.role !== '' && task.role !== filter.role) return false
    if (text === '') return true
    return `${task.id} ${task.title} ${task.description} ${task.rules.join(' ')}`.toLowerCase().includes(text)
  })
}

/** 任务漏斗阶段：把六列折成「待开工 / 开发中 / 待验收 / 已完成」四段。 */
export type TaskStage = 'pending' | 'implementing' | 'verifying' | 'closed'

/** 阶段与看板列的对应，顺序即总览漏斗的视觉顺序。 */
export const TASK_STAGES: readonly { readonly id: TaskStage; readonly columns: readonly BoardColumnId[] }[] = [
  { id: 'pending', columns: ['discussion', 'contracted'] },
  { id: 'implementing', columns: ['implementing'] },
  { id: 'verifying', columns: ['verifying'] },
  { id: 'closed', columns: ['closed'] },
]

/**
 * 任务所属的漏斗阶段。
 * @param task - 任务行。
 * @returns 五列折叠后的阶段。
 */
export function stageOf(task: TaskRow): TaskStage {
  switch (boardColumnOf(task)) {
    case 'discussion':
    case 'contracted':
      return 'pending'
    case 'implementing':
      return 'implementing'
    case 'verifying':
      return 'verifying'
    case 'closed':
      return 'closed'
  }
}

/** 一条需求的状态分类。 */
export function requirementStateLabel(state: string | undefined): string {
  if (state === 'draft') return '草稿'
  if (state === 'confirmed') return '已确认'
  if (state === 'released') return '已上线'
  if (state === 'closed') return '已关闭'
  return '未知状态'
}

/**
 * 计算一条任务当前尚未完成的依赖前置编号。
 * @param task - 目标任务。
 * @param allTasks - 全量任务，用于查前置任务是否已收口。
 * @returns 未完成（state !== 'closed'）的前置任务编号列表。
 */
export function blockingDependenciesOf(task: TaskRow, allTasks: readonly TaskRow[]): readonly string[] {
  if (task.dependsOn.length === 0) return []
  const states = new Map<string, string>()
  for (const row of allTasks) states.set(row.id, row.state)
  return task.dependsOn.filter(depId => states.get(depId) !== 'closed')
}

function numericPartOf(id: string): { readonly prefix: string; readonly num: number | null } {
  const match = /^(.*?)(\d+)$/u.exec(id.trim())
  if (match === null) return { prefix: id, num: null }
  return { prefix: match[1] ?? '', num: Number(match[2]) }
}

/**
 * 任务编号自然数字比较（T-02 排在 T-10 前）。
 * @param leftId - 左侧编号。
 * @param rightId - 右侧编号。
 * @returns 比较结果。
 */
export function compareTaskIds(leftId: string, rightId: string): number {
  const left = numericPartOf(leftId)
  const right = numericPartOf(rightId)
  if (left.prefix === right.prefix && left.num !== null && right.num !== null) {
    return left.num - right.num
  }
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

/**
 * 任务在列里的排序：无未完成前置（「可开始」）优先，其次按编号自然数字升序。
 * @param tasks - 待排序任务。
 * @param allTasks - 全量任务上下文（用于判定依赖是否已完成）。
 * @returns 排序后的任务副本。
 */
export function sortTasks(tasks: readonly TaskRow[], allTasks: readonly TaskRow[] = tasks): TaskRow[] {
  return [...tasks].sort((left, right) => {
    const leftBlocked = blockingDependenciesOf(left, allTasks).length > 0 ? 1 : 0
    const rightBlocked = blockingDependenciesOf(right, allTasks).length > 0 ? 1 : 0
    if (leftBlocked !== rightBlocked) return leftBlocked - rightBlocked
    return compareTaskIds(left.id, right.id)
  })
}
