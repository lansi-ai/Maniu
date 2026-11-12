/**
 * 外壳的展示类型与启动咒语模板。
 *
 * 数据来自会话工作区的 `.spec`：任务/规则走 `projection.ts`，项目信息走
 * `.spec/project.yaml`；本文件只保留类型与纯模板，不再持有演示数据。
 */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the `compaction/*` SessionEventMap members into this program.
import type {} from '@deepseek-ai/dsh-compaction/types'
import { BUILTIN_ROLES } from '@lcoder/kernel/src/schema/roles.ts'
import type { LcoderWorkspaceKey } from '../locales.ts'

/** 内置角色 id；与 kernel 的岗位 `inherits` 共用同一份，用来判断岗位 id 是否已知。 */
export const BUILTIN_ROLE_IDS: readonly string[] = BUILTIN_ROLES

/** 五态任务状态。 */
export type ShellTaskState = 'drafting' | 'contracted' | 'implementing' | 'verifying' | 'closed'

/** 看板上的一个任务。 */
export interface ShellTask {
  readonly id: string
  readonly title: string
  /** 需求描述；没写是空串。 */
  readonly description: string
  /** 领域分类 page/api/data/other；没写表示还没分。 */
  readonly category?: string
  /** 变更类型 bug/feature/improvement/style；没写表示还没分。 */
  readonly changeType?: string
  /** 相对 `.spec` 根目录的图片附件；没写是空数组。 */
  readonly attachments: readonly string[]
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
  /** 分配到的岗位 id；`/task_assign` 写过才有，缺省表示未分配。 */
  readonly role?: string
  /** 任务声明的允许路径；调度按它判落点重叠。 */
  readonly paths: readonly string[]
  /** 任务声明的不可逆动作；非空时本地建议只能转人工。 */
  readonly irreversible: readonly string[]
  /** 任务开立时间（`opened_at`）；缺省表示文件里没写。 */
  readonly openedAt?: string
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

/** 看板列 id：真实状态之外，多了拆分后、待开发前的「方案讨论」。 */
export type ShellBoardColumnId = ShellTaskState | 'discussion'

/**
 * 看板列（含方案讨论），顺序即视觉顺序。
 *
 * 「方案讨论」不是内核状态：它由 drafting 任务的岗位与契约投影派生，任务文件仍是
 * drafting。`SHELL_STATES` 仍只列真实状态，状态文案与工具面判断继续用它。
 */
export const SHELL_BOARD_COLUMNS: readonly { readonly id: ShellBoardColumnId; readonly labelKey: LcoderWorkspaceKey }[] = [
  { id: 'drafting', labelKey: 'shell.drafting' },
  { id: 'discussion', labelKey: 'shell.discussing' },
  { id: 'contracted', labelKey: 'shell.contracted' },
  { id: 'implementing', labelKey: 'shell.implementing' },
  { id: 'verifying', labelKey: 'shell.verifying' },
  { id: 'closed', labelKey: 'shell.closed' },
]

/** 悬浮对话里的一条消息：用户、答复、注入上下文、一段收敛后的过程，或一次压缩标记。 */
export type ShellMessage =
  /** `hidden` 是外壳自动发出的内置咒语；对话正文不画，会话事件与入口计数仍保留。 */
  | { readonly role: 'user'; readonly text: string; readonly hidden?: true }
  | { readonly role: 'assistant'; readonly text: string }
  | { readonly role: 'context'; readonly text: string; readonly label: string }
  | { readonly role: 'process'; readonly items: readonly ShellProcessItem[] }
  | {
    readonly role: 'compaction'
    /** 被压缩的历史条数；失败事件为 0。 */
    readonly items: number
    /** 被压缩内容的估算 token；失败事件为 0。 */
    readonly tokens: number
    /** 压缩失败的原因；成功时不出现。 */
    readonly error?: string
  }

/** 一次请求的上下文占用与容量；字段来自会话的 `contextPressure` 投影。 */
export interface ShellContextPressure {
  /** 最近一次请求的 prompt 侧用量（不含输出）。 */
  readonly pressureTokens?: number
  /** 下一次请求的估算占用；压缩后它会立刻下降。 */
  readonly projectedTokens?: number
  /** 当前路由模型的上下文容量；模型切换后随下一次请求更新。 */
  readonly contextWindow?: number
}

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
    /** 结果文本；只给列在 {@link RESULT_TEXT_TOOLS} 里的工具留存，其余不出。 */
    readonly result?: string
  }

/**
 * 需要留存结果文本的工具：立项问答要读回用户当时的选择。
 *
 * 只收白名单里的工具，避免把每个工具的整段输出都留在消息列表里。
 */
const RESULT_TEXT_TOOLS: readonly string[] = ['ask_user_question']

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
 * 外壳自动发出的两档立项咒语仍留在结果里，但带 `hidden` 标记，由正文组件跳过不画；
 * 条目本身仍当用户消息计数，立项入口据此判断这条会话已经起过。
 *
 * @param entries - 会话事件窗口。
 * @returns 按日志顺序排列的消息。
 */
export function messagesFromEntries(entries: readonly SessionEventLikeEntry[]): ShellMessage[] {
  const results = toolResultsOf(entries)
  const out: ShellMessage[] = []
  let turn: { readonly number: number; readonly items: ShellProcessItem[]; readonly answers: string[] } | null = null
  /** 流式增量：durable 的 assistant/message 到达前，正文与思考先在这里累积。 */
  let streaming: { turn: number; text: string; reasoning: string } | null = null

  const flushTurn = (): void => {
    if (turn === null) return
    const sameTurn = streaming !== null && streaming.turn === turn.number ? streaming : null
    if (sameTurn !== null && sameTurn.reasoning.trim() !== ''
      && !turn.items.some(item => item.kind === 'reasoning')) {
      turn.items.unshift({ kind: 'reasoning', text: sameTurn.reasoning })
    }
    if (turn.items.length > 0) out.push({ role: 'process', items: turn.items })
    const durable = turn.answers.join('\n\n').trim()
    // durable 正文优先；还没收到时先用流式累积，回合结束前也能看到字在长。
    const text = durable !== '' ? durable : (sameTurn === null ? '' : sameTurn.text.trim())
    if (text !== '') out.push({ role: 'assistant', text })
    turn = null
    streaming = null
  }

  for (const entry of entries) {
    // 流式帧是客户端瞬态行，不在 durable 序列里；跳过它就等于等最终消息一次性出现。
    if (entry.type === 'transient') {
      const chunk = entry.event.data.chunk
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        const stream = entry.event.data
        if (streaming === null || streaming.turn !== stream.turn) {
          flushTurn()
          streaming = { turn: stream.turn, text: '', reasoning: '' }
          turn = { number: stream.turn, items: [], answers: [] }
        }
        if (chunk.type === 'text-delta') streaming.text += chunk.text
        else streaming.reasoning += chunk.text
      }
      continue
    }
    const event = entry.event
    if (event.type === 'user/message') {
      flushTurn()
      const text = textOf(event.data.content)
      if (text.trim() === '') continue
      const kind = sourceKind(event.data.source)
      if (kind === 'user') {
        out.push(isBuiltinIntakePrompt(text) ? { role: 'user', text, hidden: true } : { role: 'user', text })
      } else {
        out.push({ role: 'context', text, label: kind ?? 'context' })
      }
    } else if (event.type === 'developer/message') {
      flushTurn()
      const text = textOf(event.data.message.content)
      if (text.trim() !== '') out.push({ role: 'context', text, label: 'developer' })
    } else if (event.type === 'assistant/message') {
      const data = event.data
      if (turn !== null && turn.number !== data.turn) flushTurn()
      turn ??= { number: data.turn, items: [], answers: [] }
      // 最终消息到了就以它为准，之后同回合的流式增量不再叠加。
      streaming = null
      collectBlocks(data.message.content, results, turn.items, turn.answers)
    } else if (event.type === 'turn/end') {
      flushTurn()
    } else if (event.type === 'compaction/summary') {
      // 压缩不是用户发言，也不是助手答复；在流水里留一条看得见的标记，
      // 免得上下文被静默换掉。
      out.push({
        role: 'compaction',
        items: Array.isArray(event.data.shadowedSeqs) ? event.data.shadowedSeqs.length : 0,
        tokens: event.data.shadowedTokenCount,
      })
    } else if (event.type === 'compaction/end' && event.data.error !== undefined) {
      out.push({ role: 'compaction', items: 0, tokens: 0, error: event.data.error })
    }
  }
  flushTurn()
  return out
}

/** 一次工具调用的成败与（白名单工具的）结果文本。 */
interface ToolOutcome {
  readonly ok: boolean
  readonly result?: string
}

/**
 * 窗口里每个工具调用的结果；同一 call id 以最后一条结果为准。
 *
 * 结果文本只给 {@link RESULT_TEXT_TOOLS} 里的工具留存：先扫一遍助手消息认出这些
 * call id，其余工具只记成败。
 */
function toolResultsOf(entries: readonly SessionEventLikeEntry[]): Map<string, ToolOutcome> {
  const wanted = resultTextCallIds(entries)
  const results = new Map<string, ToolOutcome>()
  for (const entry of entries) {
    if (entry.type !== 'event' || entry.event.type !== 'tool/result') continue
    const message = entry.event.data.message
    const callId = String(message.toolCallId)
    const ok = message.isError !== true
    results.set(callId, wanted.has(callId) ? { ok, result: textOf(message.content) } : { ok })
  }
  return results
}

/** 需要结果文本的那些工具调用的 call id。 */
function resultTextCallIds(entries: readonly SessionEventLikeEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (entry.type !== 'event' || entry.event.type !== 'assistant/message') continue
    const content = entry.event.data.message.content
    if (!Array.isArray(content)) continue
    for (const value of content) {
      if (value === null || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      if (record.type === 'tool-call' && typeof record.id === 'string'
        && typeof record.name === 'string' && RESULT_TEXT_TOOLS.includes(record.name)) {
        ids.add(record.id)
      }
    }
  }
  return ids
}

/** 一条助手消息的内容块：正文进答复，思考与工具调用进过程段。 */
function collectBlocks(
  content: unknown,
  results: ReadonlyMap<string, ToolOutcome>,
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
      const outcome = results.get(callId)
      items.push({
        kind: 'tool',
        callId,
        name: record.name,
        args: typeof record.arguments === 'string' ? record.arguments : '',
        ok: outcome?.ok,
        ...(outcome?.result === undefined ? {} : { result: outcome.result }),
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

/** 调度结果里要写进咒语的那几句：前置是否已收口，以及建议接着哪条会话。 */
export interface ShellPromptSchedule {
  readonly blockedBy: boolean
  readonly sessionId?: string
  readonly signals: readonly string[]
}

/**
 * 生成 dev-flow 启动咒语。任务/项目字段来自当前选择，模板与 task-flow 的入口一致。
 * @param project - 当前项目。
 * @param task - 当前任务。
 * @param schedule - 本次调度结论；缺省时咒语不提调度。
 * @returns 可直接粘贴到会话的提示词。
 */
export function buildShellPrompt(project: ShellPromptProject, task: ShellTask, schedule?: ShellPromptSchedule): string {
  const dependencies = task.dependsOn === undefined || task.dependsOn.length === 0
    ? ''
    : `\n- 前置：${task.dependsOn.join('、')}${schedule?.blockedBy === true ? '（未收口，先按住）' : '（已收口）'}`
  const routing = schedule?.sessionId === undefined
    ? ''
    : `\n- 调度：接着会话 ${schedule.sessionId}${schedule.signals.length === 0 ? '' : `（${schedule.signals.join('；')}）`}`
  return `${task.id}：${task.title}

第 0 步环境隔离：
- 规格根：${project.path}/.spec
- 项目：${project.name}（${project.path}，${project.branch}）

现状入口（已核对）：
- 任务：${task.id}，状态 ${task.state}，分级 ${task.grade}
- 规则：${task.rules.join(', ') || '（未声明）'}
- 证据要求：${task.evidence.join(', ') || '（未声明）'}
- 工具面：${task.surface}${dependencies}${routing}

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
 * 两档立项共用的访谈与落盘纪律：七问、确认稿、落盘顺序与失败报告。
 *
 * 两档的差异只在开头「先看什么」——空仓库先看清结构，有资料先读文档；
 * 其余写在一处，避免两档各自演化出口径不一致的提示词。
 */
const INTAKE_DISCIPLINE = `你的身份：AI 产品经理、需求分析师与立项助手。默认用户不懂编程与技术架构。

访谈规则：
- 每个问题都用 ask_user_question 弹出选择框：给 2 到 4 个具体选项，另留「其他（我自己说）」；不要逼用户打字才能回答。
- 需要取舍的地方（技术栈、范围、优先级）也走选择框给方案，不用自由文本；用户仍可补充文字说明。
- 一次只问一个问题，等到回答再问下一个；绝不一口气列出全部问题。
- 每个问题用普通人能听懂的语言，最好带一句很短的示例。
- 用户选「不知道」或「其他」时：把两到三个容易理解的方案做成选项并说明推荐理由；推荐属于 AI 建议，未经确认不算需求。
- 已经答过的信息不重复问；总数最多 7 问。7 问后仍有关键歧义，列为「待确认」，不靠额外追问突破上限，也不擅自补齐。

七个问题依次覆盖：
1. 你想做一个什么软件？例：图书借阅管理系统。
2. 主要给谁使用？例：学生、老师、管理员。
3. 他们会怎样使用它？例：学生找书并申请借阅，管理员处理借还。
4. 第一版最重要的功能有哪些？例：图书管理、借还书、借阅记录；暂不做支付。
5. 有哪些必须遵守的规则或特殊情况？例：同一本书不能同时借给两个人。
6. 达到什么效果你会认为做好了？例：能正常借还、库存准确、查得到记录。
7. 准备在哪里使用，有没有参考产品或别的硬要求？例：浏览器为主、手机也能用、尽量免费。

问完先出《项目需求概要 V0.1》，不要立刻登记：
- 内容：项目名称（可建议并标待确认）、一句话业务目标、用户角色与各自要做的事、最重要的使用流程、第一版功能清单、明确暂不做的功能、业务规则与异常、每个核心功能怎么算成功（操作 → 预期结果）、平台与成本与隐私等约束、仍需明确且影响第一版的问题。
- 结论分四类：【已确认】（用户明说或权威文档规定）、【AI 建议】（推荐但未选）、【待确认】（现在定不了）、【暂不开发】（用户明确排除）。未知统一写「—」或「待确认」。
- 输出完停下，等用户回复「确认需求」或提出修改。这一步只确认业务理解，不代表获准编码、提交或部署。

用户确认后按顺序落盘，只用下面这些专用工具，不用通用写文件能力，也不手写文件（唯一例外是需求文档另存一份 Markdown，见「需求基线的出口」）：
1. project_draft 登记 .spec/project.yaml。kind 只能是 web、desktop、library；repo_url 与 repo_branch 必填，没有远端时填本仓库目录与 main，并注明这是计划地址；产品、架构、测试三份文档路径没有就留空，不要编造。文件已存在就只回读现值，不覆盖。
2. spec_draft 登记一条 status 为 draft 的规格：从已确认的业务规则里挑一条能清晰验证的，写清模块、类型（rule、formula、invariant、enum、state_machine、api）、正文与出处。出处可以是 .spec/project.yaml 的字段（doc 写该文件，quote 写字段内容），也可以是用户的原话（记「来自第 N 问」）；没有仓库内文档时不要编造路径。不改已有条目、不撞编号、不重复正文。
3. task_draft 立一条 drafting 任务：标题用业务目标；rules 只能填第 2 步真正落盘成功的编号，没有就留空。
4. 每一步做完都回读核对。不能把「准备调用」或「模型输出了 JSON」当成「文件已落盘」。

失败就照实报四件事：哪一步已落盘、哪一步没落盘、失败原因、安全的下一步。不留半截文件，不用通用写盘绕过专用工具。

需求基线的出口：
- 若你的工具面里有 proposal_draft，用它把《项目需求概要》落成方案（状态 draft）并回读确认，记下方案编号；没有就在对话里输出完整、可复制的 Markdown，并明确说「尚未写入仓库」，绝不假装已创建。
- 拿到方案编号后，把完整的《项目需求概要》原样写到 .spec/requirements/<方案编号>.md：目录不存在就创建，文件已存在就更新为本版，写完回读核对正文。这是立项流程唯一允许直接写的文件，其余文件仍只用专用工具；没有方案编号就不写，如实说明文档只在对话里。
- 不编造架构文档、测试脚本、技术选型或审批意见；技术方案可以提，但要标【AI 建议】。

收尾：先判断是否具备编码条件（业务目标、用户角色、第一版范围、核心流程、关键规则、验收条件、运行平台是否都清楚），再给一段交接摘要：
项目 / 需求状态（已确认、部分确认、未确认）/ 项目登记（已落盘、未落盘、已存在）/ 规格草稿编号或未落盘原因 / 任务草稿编号或未落盘原因 / 可用开发文档（实际路径或「仅对话内生成」）/ 是否具备编码条件 / 下一步。

边界：不签契约、不推进任务状态、不改业务代码、不跑命令、不提交、不推送、不部署；这些都要人另行授权。`

/** 两档立项咒语的首行前缀；对话正文据此认出外壳自动发出的内置提示词。 */
export const INTAKE_PROMPT_HEAD = '全新项目立项：'
export const ONBOARDING_PROMPT_HEAD = '已有资料立项：'

/**
 * 判断一条用户消息是不是外壳自动发出的立项咒语。
 * 只认两档立项的首行前缀；提示词正文由下面的构造函数生成。
 * @param text - 会话里的用户消息正文。
 * @returns 是立项咒语时为 true。
 */
export function isBuiltinIntakePrompt(text: string): boolean {
  return text.startsWith(INTAKE_PROMPT_HEAD) || text.startsWith(ONBOARDING_PROMPT_HEAD)
}

/**
 * 生成「全新项目」档的立项咒语：仓库还是空的，先看清结构再按 7 问访谈，最后落 .spec。
 * @param project - 当前项目。
 * @returns 可直接发送的提示词。
 */
export function buildIntakePrompt(project: ShellPromptProject): string {
  return `${INTAKE_PROMPT_HEAD}${project.name}（${project.path}，${project.branch}）

第 0 步 先看清仓库：
- 用 file_list 看根目录与 .spec 是否存在，用 file_read 读实际存在的说明文档；不猜路径，不把不存在的文件说成已存在。
- 能自己查到的技术信息（目录、仓库名、分支、现有文档）自己查，不要问不懂技术的用户。
- 仓库是空的、没有远端、没有文档或测试，都不中止访谈：缺的项标「尚未提供」。

${INTAKE_DISCIPLINE}`
}

/**
 * 生成「已有资料」档的立项咒语：仓库里已有文档或代码，先读资料再问缺口，最后落 .spec。
 * @param project - 当前项目。
 * @param docs - `.spec/project.yaml` 声明的交付文档；缺失时要求先确认文档位置。
 * @returns 可直接发送的提示词。
 */
export function buildOnboardingPrompt(project: ShellPromptProject, docs: ShellOnboardingDocs): string {
  const declared = [
    { label: '产品文档', path: docs.product },
    { label: '架构文档', path: docs.architecture },
    { label: '测试用例', path: docs.tests },
  ].filter(entry => entry.path !== '')

  const sources = declared.length === 0
    ? '- 文档来源：.spec/project.yaml 没有声明交付文档；先用 file_list 看仓库里有没有文档，再向用户确认产品文档在哪，不要猜路径。'
    : declared.map(entry => `- ${entry.label}：${entry.path}`).join('\n')

  return `${ONBOARDING_PROMPT_HEAD}${project.name}（${project.path}，${project.branch}）

第 0 步 先读资料，再来问：
- 用 file_list 看清结构，用 file_read 逐个读下面的文档与关键代码入口；路径必须是实际读到的，不要猜。
${sources}
- 先列出「从仓库已确认的事实」：项目类型、技术栈、目录结构、已完成的功能线索；这些不要再拿去问用户。
- 只问文档回答不了的：业务目标、第一版范围、验收口径、约束与待确认项。
- 需要确认文档位置时，用 ask_user_question 把 file_list 实际列出的候选做成选项，不要让人手打路径。

${INTAKE_DISCIPLINE}`
}
