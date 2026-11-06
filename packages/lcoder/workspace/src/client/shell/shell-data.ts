/**
 * 外壳的展示类型与启动咒语模板。
 *
 * 数据来自会话工作区的 `.spec`：任务/规则走 `projection.ts`，项目信息走
 * `.spec/project.yaml`；本文件只保留类型与纯模板，不再持有演示数据。
 */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { LcoderWorkspaceKey } from '../locales.ts'

/** 五态任务状态。 */
export type ShellTaskState = 'drafting' | 'contracted' | 'implementing' | 'verifying' | 'closed'

/** 看板上的一个任务。 */
export interface ShellTask {
  readonly id: string
  readonly title: string
  readonly state: ShellTaskState
  readonly grade: string
  readonly rules: readonly string[]
  readonly evidence: readonly string[]
  readonly surface: string
  /** 认领这条任务的会话号；缺省表示还没有会话在跑它。 */
  readonly session?: string
  /** 这条任务出自哪个方案（`P-01`）；缺省表示不是拆出来的。 */
  readonly proposal?: string
  /** 前置任务编号；缺省表示没有依赖。 */
  readonly dependsOn?: readonly string[]
}

/** 装配层声明的一个角色（Agent preset）；外壳的新会话按它指名。 */
export interface ShellRole {
  readonly id: string
  readonly name?: string
}

/** 项目类型决定是否展示环境信息。 */
export type ShellProjectKind = 'web' | 'desktop' | 'library'

/** 一个部署环境；敏感值只存引用，`passwordValue` 是本机解析后的值。 */
export interface ShellEnvironment {
  readonly id: string
  readonly label: string
  readonly server?: string
  readonly database?: {
    readonly host: string
    readonly port?: string
    readonly name: string
    readonly user: string
    /** `.spec/project.yaml` 只存这个引用名。 */
    readonly passwordRef: string
    /** 从 `.spec/local.yaml` 或环境变量解析出的本机值；不落库、不进模型。 */
    readonly passwordValue?: string
  }
  readonly note?: string
}

/** 项目信息抽屉的数据，来自 `.spec/project.yaml`。 */
export interface ShellProjectInfo {
  readonly kind: ShellProjectKind
  readonly repoUrl: string
  readonly branch: string
  readonly docs: {
    readonly product: string
    readonly architecture: string
    readonly tests: string
  }
  readonly environments: readonly ShellEnvironment[]
}

/** 看板列，顺序即视觉顺序。 */
export const SHELL_STATES: readonly { readonly id: ShellTaskState; readonly labelKey: LcoderWorkspaceKey }[] = [
  { id: 'drafting', labelKey: 'shell.drafting' },
  { id: 'contracted', labelKey: 'shell.contracted' },
  { id: 'implementing', labelKey: 'shell.implementing' },
  { id: 'verifying', labelKey: 'shell.verifying' },
  { id: 'closed', labelKey: 'shell.closed' },
]

/** 悬浮对话里的一条消息：用户、答复、注入上下文，或一段收敛后的过程。 */
export type ShellMessage =
  | { readonly role: 'user'; readonly text: string }
  | { readonly role: 'assistant'; readonly text: string }
  | { readonly role: 'context'; readonly text: string; readonly label: string }
  | { readonly role: 'process'; readonly items: readonly ShellProcessItem[] }

/** 一段过程里的一个条目：思考，或一次工具调用。 */
export type ShellProcessItem =
  | { readonly kind: 'reasoning'; readonly text: string }
  | {
    readonly kind: 'tool'
    readonly callId: string
    readonly name: string
    readonly args: string
    /** `true` 成功、`false` 失败、`undefined` 结果尚未出现在事件窗口里。 */
    readonly ok: boolean | undefined
  }

/**
 * 一次签署命令的回执。
 * `text` 是宿主给出的那句人话（写了哪个文件、签名覆盖哪一版正文），
 * 外壳原样显示，不改写也不本地化——那句话属于宿主。
 */
export interface ShellSignResult {
  readonly ok: boolean
  readonly text: string
}

/**
 * 从会话事件窗口提取可展示的消息。
 *
 * 用户消息只认 `source.kind === 'user'`；其余 `user/message` 与
 * `developer/message` 是注入上下文（runtime context、agent 指令、技能正文等），
 * 归到可折叠的 context 行，不能画成用户发言。
 *
 * 同一回合里的思考与工具调用收敛成一个 process 段，正文另起一条 assistant
 * 消息，所以组头之后才是答复。工具成败从 `tool/result` 预读一次，再回填到
 * 对应的工具条目。
 *
 * @param entries - 会话事件窗口。
 * @returns 按日志顺序排列的消息。
 */
export function messagesFromEntries(entries: readonly SessionEventLikeEntry[]): ShellMessage[] {
  const results = toolResultsOf(entries)
  const out: ShellMessage[] = []
  let turn: { readonly number: number; readonly items: ShellProcessItem[]; readonly answers: string[] } | null = null

  const flushTurn = (): void => {
    if (turn === null) return
    if (turn.items.length > 0) out.push({ role: 'process', items: turn.items })
    const text = turn.answers.join('\n\n').trim()
    if (text !== '') out.push({ role: 'assistant', text })
    turn = null
  }

  for (const entry of entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type === 'user/message') {
      flushTurn()
      const text = textOf(event.data.content)
      if (text.trim() === '') continue
      const kind = sourceKind(event.data.source)
      if (kind === 'user') out.push({ role: 'user', text })
      else out.push({ role: 'context', text, label: kind ?? 'context' })
    } else if (event.type === 'developer/message') {
      flushTurn()
      const text = textOf(event.data.message.content)
      if (text.trim() !== '') out.push({ role: 'context', text, label: 'developer' })
    } else if (event.type === 'assistant/message') {
      const data = event.data
      if (turn !== null && turn.number !== data.turn) flushTurn()
      turn ??= { number: data.turn, items: [], answers: [] }
      collectBlocks(data.message.content, results, turn.items, turn.answers)
    } else if (event.type === 'turn/end') {
      flushTurn()
    }
  }
  flushTurn()
  return out
}

/** 窗口里每个工具调用的成败；同一 call id 以最后一条结果为准。 */
function toolResultsOf(entries: readonly SessionEventLikeEntry[]): Map<string, boolean> {
  const results = new Map<string, boolean>()
  for (const entry of entries) {
    if (entry.type !== 'event' || entry.event.type !== 'tool/result') continue
    const message = entry.event.data.message
    results.set(String(message.toolCallId), message.isError !== true)
  }
  return results
}

/** 一条助手消息的内容块：正文进答复，思考与工具调用进过程段。 */
function collectBlocks(
  content: unknown,
  results: ReadonlyMap<string, boolean>,
  items: ShellProcessItem[],
  answers: string[],
): void {
  if (!Array.isArray(content)) return
  for (const value of content) {
    if (value === null || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    if (record.type === 'reasoning' && typeof record.text === 'string' && record.text.trim() !== '') {
      items.push({ kind: 'reasoning', text: record.text })
      continue
    }
    if (record.type === 'text' && typeof record.text === 'string' && record.text.trim() !== '') {
      answers.push(record.text)
      continue
    }
    if (record.type === 'tool-call' && typeof record.id === 'string' && typeof record.name === 'string') {
      const callId = record.id
      items.push({
        kind: 'tool',
        callId,
        name: record.name,
        args: typeof record.arguments === 'string' ? record.arguments : '',
        ok: results.get(callId),
      })
    }
  }
}

/** 消息来源的 `kind`；来源不是对象或没有非空字符串时为 null（来源是合并可扩展的）。 */
function sourceKind(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  const kind = (value as Record<string, unknown>).kind
  return typeof kind === 'string' && kind !== '' ? kind : null
}

/** 消息/内容块里的文本；其他形状一律忽略。 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (value === null || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (record.content !== undefined) return textOf(record.content)
  return ''
}

/** 启动咒语需要的项目事实。 */
export interface ShellPromptProject {
  readonly name: string
  readonly path: string
  readonly branch: string
}

/**
 * 把咒语交给外部工具（Qoder 一类）时补的技能引用前缀。
 *
 * 三段咒语正文自成一个完整的流程指令，本会话里的模型没有名为 `task-flow` 的技能可解析，
 * 所以只有「复制到仓外开工」这条路需要它。发送路径不带，模型看到的就是编辑器里的那段。
 */
export const TASK_FLOW_MENTION_PREFIX = '@task-flow '

/**
 * 生成 dev-flow 启动咒语。任务/项目字段来自当前选择，模板与 task-flow 的入口一致。
 * @param project - 当前项目。
 * @param task - 当前任务。
 * @returns 可直接粘贴到会话的提示词。
 */
export function buildShellPrompt(project: ShellPromptProject, task: ShellTask): string {
  return `${task.id}：${task.title}

第 0 步环境隔离：
- 规格根：${project.path}/.spec
- 项目：${project.name}（${project.path}，${project.branch}）

现状入口（已核对）：
- 任务：${task.id}，状态 ${task.state}，分级 ${task.grade}
- 规则：${task.rules.join(', ') || '（未声明）'}
- 证据要求：${task.evidence.join(', ') || '（未声明）'}
- 工具面：${task.surface}

请按任务驱动入口执行：
1. 调研：读相关代码与契约，确认现状与缺口；
2. 分类分级并登记 docs/tasks.yaml，状态 doing，重跑看板；
3. 拿不准先问我（方案 / 契约 / 范围）；
4. 契约先行、增量编码，遵守 docs/PROJECT-RULES.md 红线；
5. 门禁：typecheck / lint / vitest / test:docs；
6. 收口置 done、重跑看板，bug 写 PITFALLS，不自动 push。`
}

/** 立项咒语需要的交付文档路径；空串表示 `.spec/project.yaml` 没声明。 */
export interface ShellOnboardingDocs {
  readonly product: string
  readonly architecture: string
  readonly tests: string
}

/**
 * 生成空文件夹的项目引导咒语：`.spec` 与 `project.yaml` 都不存在时，先按 7 问把
 * 项目身份、文档位置与第一条规格问清，再逐项落盘。提示词走会话的 `user/message`，
 * 所以模型可见内容可从日志复原。
 * @param project - 当前项目。
 * @returns 可直接发送的提示词。
 */
export function buildIntakePrompt(project: ShellPromptProject): string {
  return `项目引导：${project.name}（${project.path}）

第 0 步 现状：
- 规格根：${project.path}/.spec 还不存在。
- 项目：${project.name}（${project.path}，${project.branch}）
- 任务：一个都读不到，.spec/project.yaml 也没登记——这个仓库还没立项。
- 你现在拿到的是立项面：file_read、file_list、project_draft、spec_query、spec_draft、task_read、task_draft。先 file_list 看清仓库结构，再 file_read 读文档；改代码与跑命令的能力不在这条面上。

请按 7 问引导，一次只问一问，拿到回答再问下一问，总数不超过 7 问：
1. 这个项目要办成的业务目标是什么？一句话说清。
2. 项目类型是 web、desktop 还是 library？
3. 仓库地址与主线分支名是什么？还没有远端就填计划地址或仓库目录。
4. 产品文档在哪个仓库内路径？没有就说没有，不要猜路径。
5. 架构文档在哪个路径？（同上）
6. 测试用例或验收脚本在哪个路径？（同上）
7. 第一条要遵守的规格条目是什么？说清所属模块、类型（rule、formula、invariant、enum、state_machine、api）、正文与出处文档。

落盘顺序（都走工具，不要用通用写文件能力，也不要手写文件）：
- 第 2、3、4、5、6 问答完 → project_draft 登记 .spec/project.yaml；文件已存在就只回读现值，不覆盖。
- 第 7 问答完 → spec_draft 登记一条 status 为 draft 的规格；正文或编号撞车就换措辞，绝不改已登记的条目。
- 第 1 问答完 → task_draft 立一条 drafting 任务，标题用业务目标，rules 填刚登记的编号。
- 立完就停：不改业务代码，不起草契约，绝不给自己签字。

任何一步失败就如实说「哪一步已落盘、哪一步没落盘」，不要留半截文件，也不要假装写成。`
}

/**
 * 生成零任务仓库的立项分析咒语：把产品文档路径交给模型，让 agent 先调研再逐个建
 * drafting 任务。提示词走会话的 `user/message`，所以模型可见内容可从日志复原。
 * @param project - 当前项目。
 * @param docs - `.spec/project.yaml` 声明的交付文档；缺失时要求先问用户。
 * @returns 可直接发送的提示词。
 */
export function buildOnboardingPrompt(project: ShellPromptProject, docs: ShellOnboardingDocs): string {
  const declared = [
    { label: '产品文档', path: docs.product },
    { label: '架构文档', path: docs.architecture },
    { label: '测试用例', path: docs.tests },
  ].filter(entry => entry.path !== '')

  const sources = declared.length === 0
    ? '- 文档来源：`.spec/project.yaml` 没有声明交付文档；先向用户确认产品文档在哪，不要猜路径。'
    : declared.map(entry => `- ${entry.label}：${entry.path}`).join('\n')

  return `立项分析：${project.name}（${project.path}）

第 0 步 现状：
- 规格根：${project.path}/.spec
- 项目：${project.name}（${project.path}，${project.branch}）
- 任务：一个都读不到，这个仓库还没立项。
${sources}

请按任务驱动入口执行：
1. 调研：先 task_read 确认空看板，再 file_read 逐个读上面的文档，必要时读仓库里的代码；
2. 分类分级：给出任务清单，逐条写清边界、验收口径与 A/B/C 分级的理由；拿不准先问我；
3. 立项：每个任务调一次 task_draft，状态固定 drafting；rules 只填 spec_query 查得到的编号，没有规格条目就留空；
4. 到此为止：不要改业务代码，不要给自己签契约——契约由 contract_draft 起草、由人签署。`
}
