/**
 * 状态大盘的关系图：把任务与会话排成确定性布局，并给出依赖、认领与联调组三类边。
 *
 * 这一层是纯函数：不读盘、不订阅、不引图库。坐标只由输入决定，同一份输入（甚至顺序不同、
 * 集合相同的输入）必定得到同一份布局，单测才能把排布与边的生成钉死。
 * 绘制在 `DashboardGraph.tsx`，接线在大盘页。
 */
import { SHELL_STATES } from './shell-data.ts'
import type { ShellTaskState } from './shell-data.ts'

/** 任务画布的内边距。 */
export const GRAPH_PADDING = 16
/** 任务列上方留给状态标题的高度。 */
export const GRAPH_COLUMN_HEADER_HEIGHT = 26
/** 一个任务节点的宽度。 */
export const GRAPH_TASK_WIDTH = 168
/** 一个任务节点的高度。 */
export const GRAPH_TASK_HEIGHT = 44
/** 相邻两列的间距。 */
export const GRAPH_COLUMN_GAP = 28
/** 同列相邻两行的间距。 */
export const GRAPH_ROW_GAP = 12
/** 一个会话节点的宽度。 */
export const GRAPH_SESSION_WIDTH = 168
/** 一个会话节点的高度。 */
export const GRAPH_SESSION_HEIGHT = 36
/** 相邻两条会话的间距。 */
export const GRAPH_SESSION_GAP = 12
/** 任务区与会话行之间的间距。 */
export const GRAPH_SECTION_GAP = 32

/** 关系图列：五态之一，或未知状态的兜底列。 */
export type DashboardGraphColumnState = ShellTaskState | 'unknown'

/** 关系图里的一条任务；只用画图需要的字段。 */
export interface DashboardGraphTask {
  readonly id: string
  readonly title: string
  /** 任务状态；不在五态里时落到未知状态列，不报错。 */
  readonly state: string
  /** 前置任务编号；悬空引用不连边。 */
  readonly dependsOn?: readonly string[] | undefined
  /** 认领这条任务的会话号。 */
  readonly session?: string | undefined
  /** 分配到的岗位 id。 */
  readonly role?: string | undefined
}

/** 关系图里的一条会话。 */
export interface DashboardGraphSession {
  readonly id: string
  readonly label: string
  readonly role?: string | undefined
  readonly running: boolean
  readonly awaitingInteraction: boolean
  /** 队列里已有的条数。 */
  readonly pending: number
  /** 认领过的任务号；与任务上的 `session` 字段取并集。 */
  readonly claims?: readonly string[] | undefined
  /** 已并入联调组的任务号。 */
  readonly groupTasks?: readonly string[] | undefined
}

/** 关系图的输入。 */
export interface DashboardGraphInput {
  readonly tasks: readonly DashboardGraphTask[]
  readonly sessions: readonly DashboardGraphSession[]
}

/** 一条边的三类来源：前置依赖、会话认领、联调组。 */
export type DashboardGraphEdgeKind = 'depends_on' | 'claims' | 'group'

/** 一列任务；没有任务时不产生列。 */
export interface DashboardGraphColumn {
  readonly state: DashboardGraphColumnState
  /** 列左边界。 */
  readonly x: number
  readonly width: number
  /** 这一列的任务数。 */
  readonly count: number
}

/** 任务节点；`id` 是画边与 React key 共用的节点标识。 */
export interface DashboardGraphTaskNode {
  readonly kind: 'task'
  readonly id: string
  readonly taskId: string
  readonly title: string
  readonly state: DashboardGraphColumnState
  readonly role?: string | undefined
  readonly session?: string | undefined
  readonly column: number
  readonly row: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 会话节点；会话排在任务列下方的一行。 */
export interface DashboardGraphSessionNode {
  readonly kind: 'session'
  readonly id: string
  readonly sessionId: string
  readonly label: string
  readonly role?: string | undefined
  readonly running: boolean
  readonly awaitingInteraction: boolean
  readonly pending: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 任务节点或会话节点。 */
export type DashboardGraphNode = DashboardGraphTaskNode | DashboardGraphSessionNode

/**
 * 一条边。方向按语义定：
 * `depends_on` 从前置任务指向依赖它的任务；`claims`/`group` 从会话指向任务。
 */
export interface DashboardGraphEdge {
  readonly kind: DashboardGraphEdgeKind
  readonly from: string
  readonly to: string
  /** 起点锚点（依赖边取前置节点底边中点，认领/组边取会话节点顶边中点）。 */
  readonly x1: number
  readonly y1: number
  /** 终点锚点（依赖边取任务节点顶边中点，认领/组边取任务节点底边中点）。 */
  readonly x2: number
  readonly y2: number
}

/** 布局结果；坐标与边都已算好，组件只画。 */
export interface DashboardGraphLayout {
  readonly taskNodes: readonly DashboardGraphTaskNode[]
  readonly sessionNodes: readonly DashboardGraphSessionNode[]
  readonly edges: readonly DashboardGraphEdge[]
  readonly columns: readonly DashboardGraphColumn[]
  readonly width: number
  readonly height: number
  /** 没有任务：组件画空态，不画图。 */
  readonly empty: boolean
  /** 有没有会话；没有时只画任务与依赖边。 */
  readonly hasSessions: boolean
}

const KNOWN_STATES: ReadonlySet<string> = new Set(SHELL_STATES.map(state => state.id))

const KNOWN_COLUMNS: readonly DashboardGraphColumnState[] = SHELL_STATES.map(state => state.id)

/** 节点标识：任务与会话各自加前缀，避免同名编号撞车。 */
function taskNodeId(taskId: string): string {
  return `task:${taskId}`
}

function sessionNodeId(sessionId: string): string {
  return `session:${sessionId}`
}

/** 按编号的字典序比较；不依赖区域设置，同一输入与不同输入顺序都落到同一结果。 */
function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  if (a.id < b.id) return -1
  return a.id > b.id ? 1 : 0
}

/** 未知状态落到兜底列；已识别的状态原样返回。 */
function columnOf(state: string): DashboardGraphColumnState {
  return KNOWN_STATES.has(state) ? state as ShellTaskState : 'unknown'
}

/**
 * 一条边的 SVG 路径：两端锚点在同一纵向中线上加两个控制点，跨列或同行都平滑。
 * @param edge - 已算好锚点的边。
 * @returns `path` 的 `d` 属性值。
 */
export function edgePath(edge: DashboardGraphEdge): string {
  const midY = (edge.y1 + edge.y2) / 2
  return `M ${String(edge.x1)} ${String(edge.y1)} C ${String(edge.x1)} ${String(midY)}, ${String(edge.x2)} ${String(midY)}, ${String(edge.x2)} ${String(edge.y2)}`
}

/**
 * 计算关系图布局。
 *
 * 任务按五态分列（未知状态追加一列），列内按编号排序；会话排一行，也按编号排序。
 * 任务列后接会话行；宽高覆盖所有节点。悬空的依赖、认领与组引用直接跳过——
 * 没有终点就画不出边，也不把未知编号伪造成节点。
 * @param input - 任务与会话。
 * @returns 节点、边、列与画布尺寸。
 */
export function layoutDashboardGraph(input: DashboardGraphInput): DashboardGraphLayout {
  const tasks = [...input.tasks].sort(byId)
  const sessions = [...input.sessions].sort(byId)
  const hasUnknown = tasks.some(task => columnOf(task.state) === 'unknown')
  const columnStates: readonly DashboardGraphColumnState[] = hasUnknown
    ? [...KNOWN_COLUMNS, 'unknown']
    : KNOWN_COLUMNS

  const buckets = new Map<DashboardGraphColumnState, DashboardGraphTask[]>()
  for (const state of columnStates) buckets.set(state, [])
  for (const task of tasks) {
    const bucket = buckets.get(columnOf(task.state))
    if (bucket !== undefined) bucket.push(task)
  }

  const columns: DashboardGraphColumn[] = []
  const taskNodes: DashboardGraphTaskNode[] = []
  let maxRows = 0
  columnStates.forEach((state, column) => {
    const bucket = buckets.get(state) ?? []
    maxRows = Math.max(maxRows, bucket.length)
    const x = GRAPH_PADDING + column * (GRAPH_TASK_WIDTH + GRAPH_COLUMN_GAP)
    if (tasks.length > 0) columns.push({ state, x, width: GRAPH_TASK_WIDTH, count: bucket.length })
    bucket.forEach((task, row) => {
      taskNodes.push({
        kind: 'task',
        id: taskNodeId(task.id),
        taskId: task.id,
        title: task.title,
        state: columnOf(task.state),
        role: task.role,
        session: task.session,
        column,
        row,
        x,
        y: GRAPH_PADDING + GRAPH_COLUMN_HEADER_HEIGHT + row * (GRAPH_TASK_HEIGHT + GRAPH_ROW_GAP),
        width: GRAPH_TASK_WIDTH,
        height: GRAPH_TASK_HEIGHT,
      })
    })
  })

  const taskRowsHeight = maxRows === 0
    ? 0
    : GRAPH_COLUMN_HEADER_HEIGHT + maxRows * GRAPH_TASK_HEIGHT + (maxRows - 1) * GRAPH_ROW_GAP
  const sessionY = GRAPH_PADDING + (tasks.length === 0 ? 0 : taskRowsHeight + GRAPH_SECTION_GAP)

  const sessionNodes: DashboardGraphSessionNode[] = sessions.map((session, index) => ({
    kind: 'session',
    id: sessionNodeId(session.id),
    sessionId: session.id,
    label: session.label,
    role: session.role,
    running: session.running,
    awaitingInteraction: session.awaitingInteraction,
    pending: session.pending,
    x: GRAPH_PADDING + index * (GRAPH_SESSION_WIDTH + GRAPH_SESSION_GAP),
    y: sessionY,
    width: GRAPH_SESSION_WIDTH,
    height: GRAPH_SESSION_HEIGHT,
  }))

  const taskWidth = columns.length === 0
    ? 0
    : columns.length * GRAPH_TASK_WIDTH + (columns.length - 1) * GRAPH_COLUMN_GAP
  const sessionsWidth = sessionNodes.length === 0
    ? 0
    : sessionNodes.length * GRAPH_SESSION_WIDTH + (sessionNodes.length - 1) * GRAPH_SESSION_GAP
  const width = GRAPH_PADDING * 2 + Math.max(taskWidth, sessionsWidth)
  const sessionsHeight = sessionNodes.length === 0 ? 0 : GRAPH_SESSION_HEIGHT
  const tasksHeight = tasks.length === 0
    ? 0
    : taskRowsHeight + (sessionNodes.length === 0 ? 0 : GRAPH_SECTION_GAP)
  const height = GRAPH_PADDING * 2 + tasksHeight + sessionsHeight

  return {
    taskNodes,
    sessionNodes,
    edges: buildEdges(tasks, sessions, taskNodes, sessionNodes),
    columns,
    width,
    height,
    empty: tasks.length === 0,
    hasSessions: sessions.length > 0,
  }
}

/** 边的锚点：依赖自上而下，会话认领/组自下而上。 */
function anchors(
  kind: DashboardGraphEdgeKind,
  from: DashboardGraphTaskNode | DashboardGraphSessionNode,
  to: DashboardGraphTaskNode | DashboardGraphSessionNode,
): Pick<DashboardGraphEdge, 'x1' | 'y1' | 'x2' | 'y2'> {
  if (kind === 'depends_on') {
    return {
      x1: from.x + from.width / 2,
      y1: from.y + from.height,
      x2: to.x + to.width / 2,
      y2: to.y,
    }
  }
  return {
    x1: from.x + from.width / 2,
    y1: from.y,
    x2: to.x + to.width / 2,
    y2: to.y + to.height,
  }
}

/**
 * 生成三类边。同一对「会话 + 任务」只会出现一次：认领优先于联调组。
 * 悬空的编号（前置、认领、组任务不在任务列表里）跳过。
 */
function buildEdges(
  tasks: readonly DashboardGraphTask[],
  sessions: readonly DashboardGraphSession[],
  taskNodes: readonly DashboardGraphTaskNode[],
  sessionNodes: readonly DashboardGraphSessionNode[],
): DashboardGraphEdge[] {
  const taskNodeById = new Map(taskNodes.map(node => [node.taskId, node]))
  const sessionNodeById = new Map(sessionNodes.map(node => [node.sessionId, node]))
  const edges: DashboardGraphEdge[] = []
  const seen = new Set<string>()

  const push = (
    kind: DashboardGraphEdgeKind,
    from: DashboardGraphTaskNode | DashboardGraphSessionNode,
    to: DashboardGraphTaskNode | DashboardGraphSessionNode,
  ): void => {
    const key = `${kind}:${from.id}->${to.id}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ kind, from: from.id, to: to.id, ...anchors(kind, from, to) })
  }

  for (const task of tasks) {
    const to = taskNodeById.get(task.id)
    if (to === undefined) continue
    for (const dependency of [...new Set(task.dependsOn ?? [])].sort()) {
      if (dependency === task.id) continue
      const from = taskNodeById.get(dependency)
      if (from !== undefined) push('depends_on', from, to)
    }
  }

  for (const session of sessions) {
    const from = sessionNodeById.get(session.id)
    if (from === undefined) continue
    const claimed = new Set(session.claims ?? [])
    for (const task of tasks) {
      if (task.session === session.id) claimed.add(task.id)
    }
    for (const taskId of [...claimed].sort()) {
      const to = taskNodeById.get(taskId)
      if (to !== undefined) push('claims', from, to)
    }
    for (const taskId of [...new Set(session.groupTasks ?? [])].sort()) {
      const to = taskNodeById.get(taskId)
      if (to === undefined || claimed.has(taskId)) continue
      push('group', from, to)
    }
  }

  return edges
}
