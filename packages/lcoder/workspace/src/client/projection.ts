/**
 * 文件投影：把磁盘上的规格事实读成三栏能画的行。
 *
 * 数据面不建自己的 Remote 命名空间：任务与规格本来就是 kernel 落在仓库里的
 * YAML（`tasks/*.yaml`、`spec/rules.yaml`），是唯一事实源——「规格为主语」对
 * UI 同样成立，UI 也是规格文件的投影。这里只读、只解析、只展示；状态机判断
 * 仍归 kernel，UI 不做任何决策。读文件走上游现成的 `workspaceFiles` 命名空间，
 * 本模块只依赖一个窄化的文件面（便于测试替换，也让整个包不见其余远程能力）。
 */
import { parse as parseYaml } from 'yaml'
import type {
  WorkspaceDirectoryListing, WorkspaceFileText,
} from '@deepseek-ai/dsh-api-workspace-files/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** 左栏一行任务：YAML 里能直接读到的展示字段。 */
export interface TaskRow {
  readonly id: string
  readonly title: string
  readonly state: string
  readonly grade: string
}

/** 中栏一条规格条目。 */
export interface RuleRow {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly text: string
}

/** 一次投影的结果：能画的行，加上读不到/读不懂的部分各自的说明。 */
export interface WorkspaceProjection {
  readonly tasks: readonly TaskRow[]
  readonly rules: readonly RuleRow[]
  readonly problems: readonly string[]
}

/** 本包需要的窄化文件面：整个包只见这两个调用，其余远程能力不进类型。 */
export interface ProjectionFilesRemote {
  list(sessionId: SessionId, path: string, signal: AbortSignal): Promise<RemoteResult<WorkspaceDirectoryListing>>
  readPage(sessionId: SessionId, path: string, signal: AbortSignal): Promise<RemoteResult<WorkspaceFileText>>
}

/** kernel 约定的布局：任务在 `tasks/`，规则库在 `spec/rules.yaml`。 */
export const TASKS_DIR = 'tasks'
export const RULES_FILE = 'spec/rules.yaml'

/** 单页行数上限：任务与规则 YAML 都是几十行的量级，500 足够且低于宿主默认页。 */
export const PAGE_LINES = 500

/** 字符串字段读取：空串按缺失算。 */
function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** YAML 解析结果的形状守卫：只接受普通对象。 */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 远程失败的人话：RemoteError 自带 message；没有就退到 code，再没有就认了。 */
function messageOf(failure: { readonly code?: unknown; readonly message?: unknown }): string {
  if (typeof failure.message === 'string' && failure.message !== '') return failure.message
  return typeof failure.code === 'string' ? failure.code : '未知失败'
}

/**
 * 一个任务 YAML 的文本 → 一行展示数据。解析失败或形状不对给 `undefined`：
 * 展示面不猜测，读不懂的文件进 problems，而不是编一行假数据。
 */
export function taskTextToRow(fileName: string, text: string): TaskRow | undefined {
  let fields: Record<string, unknown> | undefined
  try {
    fields = recordOf(parseYaml(text))
  } catch {
    return undefined
  }
  if (fields === undefined) return undefined
  const title = asText(fields.title)
  if (title === undefined) return undefined
  return {
    id: asText(fields.id) ?? fileName.replace(/\.yaml$/, ''),
    title,
    state: asText(fields.state) ?? 'unknown',
    grade: asText(fields.grade) ?? '-',
  }
}

/** 规则库文本 → 展示行。解析失败给空表；缺字段的条目跳过——展示面不替规格库补事实。 */
export function rulesTextToRows(text: string): RuleRow[] {
  let doc: Record<string, unknown> | undefined
  try {
    doc = recordOf(parseYaml(text))
  } catch {
    return []
  }
  const list = doc?.rules
  if (!Array.isArray(list)) return []
  return list.flatMap((entry: unknown) => {
    const fields = recordOf(entry)
    if (fields === undefined) return []
    const id = asText(fields.id)
    const text = asText(fields.text)
    if (id === undefined || text === undefined) return []
    return [{
      id,
      kind: asText(fields.kind) ?? 'rule',
      status: asText(fields.status) ?? 'draft',
      text,
    }]
  })
}

/**
 * 读取一个会话的文件投影。两路读取互不阻塞；任何一路失败只记说明，
 * 不让整份投影落空——三栏宁可缺一角，不要全白。
 */
export async function loadWorkspaceProjection(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<WorkspaceProjection> {
  const [tasks, rules] = await Promise.all([
    loadTasks(files, sessionId, signal),
    loadRules(files, sessionId, signal),
  ])
  return {
    tasks: tasks.rows,
    rules: rules.rows,
    problems: [...tasks.problems, ...rules.problems],
  }
}

async function loadTasks(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<{ rows: TaskRow[]; problems: string[] }> {
  const rows: TaskRow[] = []
  const problems: string[] = []

  const listed = await files.list(sessionId, TASKS_DIR, signal)
  if (!listed.ok) {
    // 目录还不存在是常态（没有任务的仓库），不算故障；其余失败才值得说。
    if (!isMissing(listed.error, TASKS_DIR)) {
      problems.push(`${TASKS_DIR}/: ${messageOf(listed.error)}`)
    }
    return { rows, problems }
  }

  const names = listed.value.entries
    .filter(entry => entry.type === 'file' && entry.name.endsWith('.yaml'))
    .map(entry => entry.name)

  await Promise.all(names.map(async (name) => {
    const page = await files.readPage(sessionId, `${TASKS_DIR}/${name}`, signal)
    if (!page.ok) {
      problems.push(`${TASKS_DIR}/${name}: ${messageOf(page.error)}`)
      return
    }
    const row = taskTextToRow(name, page.value.text)
    if (row === undefined) {
      problems.push(`${TASKS_DIR}/${name}: 不是能读的任务文件`)
      return
    }
    rows.push(row)
  }))

  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { rows, problems }
}

async function loadRules(
  files: ProjectionFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<{ rows: RuleRow[]; problems: string[] }> {
  const page = await files.readPage(sessionId, RULES_FILE, signal)
  if (!page.ok) {
    const problems = isMissing(page.error, RULES_FILE) ? [] : [`${RULES_FILE}: ${messageOf(page.error)}`]
    return { rows: [], problems }
  }
  return { rows: rulesTextToRows(page.value.text), problems: [] }
}

/**
 * 判断一次失败是不是「目标还不存在」。投影把它当作空集而不是故障：
 * 没写过规格的仓库是起点，不是错误。判定走 code 与 message 双保险——
 * 不同文件后端对缺失路径的报错形状不完全一致。
 */
function isMissing(error: { readonly code?: unknown; readonly message?: unknown }, path: string): boolean {
  const code = typeof error.code === 'string' ? error.code : ''
  if (code.includes('not-found') || code.includes('ENOENT')) return true
  const message = typeof error.message === 'string' ? error.message : ''
  return message.includes(path) && (message.includes('ENOENT') || message.includes('does not exist') || message.includes('不存在'))
}
