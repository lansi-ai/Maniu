/**
 * 「全新项目」需求分析师向导的阶段判定与模型选项。
 *
 * 阶段只从会话事实算：消息窗口里有没有发出过立项咒语、宿主推流里有没有待答问题、
 * 这一轮是否在跑、投影里有没有方案。界面自己不记阶段，所以关掉向导再打开、
 * 刷新页面或换一条会话以后，阶段仍按同一份事实重算；已经发出过的咒语也不会再发。
 */
import type { ShellMessage, ShellProcessItem } from './shell-data.ts'

/** 向导阶段：首页、提问、思考、结果、关闭。 */
export type IntakeWizardPhase = 'home' | 'questions' | 'thinking' | 'result' | 'closed'

/**
 * 外壳代发的确认消息正文；与立项咒语里「等用户回复确认需求」的说法一致。
 * 会话里出现过这条用户消息就算需求已确认，刷新、关掉重开都不再重发。
 */
export const INTAKE_CONFIRM_COMMAND = '确认需求'

/**
 * 确认轮失败后的重试指令；只在用户明确点「重试落盘」时发送。
 *
 * 内容与确认命令不同，避免与「已确认」去重混淆；仍只让分析师按已确认的需求落盘，
 * 不重新提问、不改需求、不开始实现。
 */
export const INTAKE_RETRY_COMMAND = `重试落盘：上一轮确认后没有写出 .spec 文件。请按已确认的需求继续执行落盘步骤，
不要重新提问、不要改需求与项目声明，也不要开始实现；落盘完成后列出新建的项目、规格与任务编号。`

/**
 * 结果卡「更多讨论」代发的第二轮讨论指令；不改立项咒语本身。
 *
 * 仍在这一条会话里继续问：不受第一轮七问上限限制，但只补最多五个关键问题；
 * 问答仍逐题走选择框，结束后输出新的《项目需求概要》并停下等「确认需求」，
 * 不提前登记 .spec。会话里出现这条用户消息即说明第二轮已开始，不另记界面状态。
 */
export const INTAKE_MORE_DISCUSSION = `继续做一轮需求讨论：这是用户主动要求的第二轮需求讨论，不受第一轮七问上限的限制。

- 先回看已有的需求概要，找出仍影响第一版的关键缺口；已经答过的信息不要重复问。
- 最多再问 5 个关键问题；仍然一次只问一个，逐题用 ask_user_question 弹出选择框，给 2 到 4 个具体选项并留「其他（我自己说）」。
- 问完后输出一份新的《项目需求概要》，写明相对上一版的变化。
- 先不要登记：不调用 project_draft、spec_draft、task_draft，也不写 .spec；输出完停下，等用户回复「确认需求」。`

/** 阶段判定用到的会话事实。 */
export interface IntakeWizardFacts {
  /** 向导是否打开；关闭后一律是 `closed`。 */
  readonly open: boolean
  /** 这条会话是否受理过立项咒语。 */
  readonly started: boolean
  /** 当前待答问题数；审批不算问题。 */
  readonly questionCount: number
  /** 这一轮是否仍在跑；调用方传沉降后的运行事实，不传瞬时值。 */
  readonly running: boolean
  /** 会话里是否已出现过程或答复；用来区分「刚发出、还没开始跑」与「本轮已结束」。 */
  readonly hasOutput: boolean
  /** 投影里读到的方案数。 */
  readonly proposalCount: number
  /** 最后一条非空助手答复；没有时为 null。 */
  readonly summary: string | null
  /** 会话里是否已经有用户确认过需求。 */
  readonly confirmed: boolean
  /** 项目或任务是否已落盘；方案另由 `proposalCount` 算。 */
  readonly landed: boolean
}

/**
 * 按会话事实决定向导当前阶段。
 *
 * 待答问题优先于已有方案与概要：模型继续追问时仍停在提问层。
 * 本轮停下后，有方案、有聊天概要，或已有落盘结果的确认轮都进结果卡；
 * 三者都没有才停在结束态。结果不在两轮之间闪，靠调用方传沉降后的运行事实。
 * @param facts - 会话事实。
 * @returns 当前阶段。
 */
export function intakeWizardPhase(facts: IntakeWizardFacts): IntakeWizardPhase {
  if (!facts.open) return 'closed'
  if (!facts.started) return 'home'
  if (facts.questionCount > 0) return 'questions'
  if (facts.running || !facts.hasOutput) return 'thinking'
  if (facts.proposalCount > 0 || facts.summary !== null || (facts.confirmed && facts.landed)) return 'result'
  return 'thinking'
}

/** 结果卡要画的那一种内容。 */
export type IntakeResultView = 'proposal' | 'summary' | 'confirmed' | 'pending'

/** 结果卡判定用到的事实。 */
export interface IntakeResultFacts {
  /** 投影里读到的方案数。 */
  readonly proposalCount: number
  /** 最后一条非空助手答复；没有时为 null。 */
  readonly summary: string | null
  /** 会话里是否已经有用户确认过需求。 */
  readonly confirmed: boolean
  /** 项目或任务是否已落盘。 */
  readonly landed: boolean
}

/**
 * 结果卡画什么：方案优先，其次本轮聊天概要，再其次已确认且已落盘，最后是方案还没读出来。
 * @param facts - 方案、概要、确认与落盘事实。
 * @returns 结果卡的内容种类。
 */
export function intakeResultView(facts: IntakeResultFacts): IntakeResultView {
  if (facts.proposalCount > 0) return 'proposal'
  if (facts.summary !== null) return 'summary'
  if (facts.confirmed && facts.landed) return 'confirmed'
  return 'pending'
}

/** 判断立项咒语发没发过所需的会话事实。 */
export interface IntakeStartFacts {
  /** 会话行上的 `blank`：`false` 表示受理过提示词；`undefined` 表示读不到。 */
  readonly blank: boolean | undefined
  /** 消息窗口里用户发出的消息条数；注入上下文不算。 */
  readonly userMessages: number
  /** 首条提示已被收下、还没等到 `turn/start`。 */
  readonly awaitingFirstTurn: boolean | undefined
}

/**
 * 这条会话是否已经受理过立项咒语。
 *
 * 三个信号取或：任一为真都说明发过了。都读不到时按「没发过」处理，否则全新仓库
 * 第一次点确认就发不出去；这与 `onboardingAction` 的判据一致。
 * @param facts - 会话事实。
 * @returns 已发出过时为 true。
 */
export function intakePromptStarted(facts: IntakeStartFacts): boolean {
  return facts.blank === false || facts.userMessages > 0 || facts.awaitingFirstTurn === true
}

/** 向导展示思考与工具过程时用的一份汇总。 */
export interface IntakeWizardOutput {
  /** 会话里是否已经出现过过程或答复。 */
  readonly hasOutput: boolean
  /** 按消息顺序摊平的全部过程条目。 */
  readonly items: readonly ShellProcessItem[]
  /** 最后一条非空助手答复的 Markdown 正文；没有时为 null。 */
  readonly summary: string | null
}

/**
 * 从消息窗口折出思考与工具过程，以及聊天气泡里的最后一条答复。
 *
 * 只收过程段与助手答复；用户消息、注入上下文与压缩标记不算输出，
 * 因此刚发出咒语、模型还没动手时不会误判成「本轮已结束」。概要只认助手正文，
 * 过程段（思考与工具调用）不算概要，空答复也不覆盖前一条。
 * @param messages - 会话事件窗口折成的消息。
 * @returns 是否已有输出、摊平后的过程条目，以及最后一条非空助手答复。
 */
export function intakeWizardOutput(messages: readonly ShellMessage[]): IntakeWizardOutput {
  const items: ShellProcessItem[] = []
  let hasOutput = false
  let summary: string | null = null
  for (const message of messages) {
    if (message.role === 'assistant') {
      hasOutput = true
      const text = message.text.trim()
      if (text !== '') summary = text
    } else if (message.role === 'process') {
      hasOutput = true
      items.push(...message.items)
    }
  }
  return { hasOutput, items, summary }
}

/**
 * 这条会话里用户确认过需求没有。
 *
 * 只认去掉首尾空白后与 {@link INTAKE_CONFIRM_COMMAND} 完全相等的用户消息；
 * 立项咒语与注入上下文都不匹配，所以判据不依赖组件状态，刷新、关掉重开都读同一份日志。
 * @param messages - 会话事件窗口折成的消息。
 * @returns 已确认时为 true。
 */
export function intakeConfirmed(messages: readonly ShellMessage[]): boolean {
  return messages.some(message => message.role === 'user' && message.text.trim() === INTAKE_CONFIRM_COMMAND)
}

/** 高级配置里可选的一个模型。 */
export interface IntakeModelOption {
  /** 服务商 id；`selectModel` 的第一个字段。 */
  readonly provider: string
  /** 服务商展示名。 */
  readonly providerName: string
  /** 模型 id；`selectModel` 的第二个字段。 */
  readonly model: string
  /** 模型展示名。 */
  readonly modelName: string
  /** 是否目录里的默认模型。 */
  readonly isDefault: boolean
}

/** 模型目录里与选项相关的那部分字段；`ModelSettingsSnapshot` 可直接传入。 */
export interface IntakeModelCatalog {
  /** 目录默认选择；缺省时按各服务商的 defaultModel 认。 */
  readonly defaultSelection?: { readonly provider: string; readonly model: string } | undefined
  readonly rows: readonly {
    readonly provider: string
    readonly displayName: string
    readonly defaultModel?: string | undefined
    readonly models: readonly { readonly id: string; readonly name: string }[]
  }[]
}

/**
 * 把模型目录摊平成一行一个模型的可选项。
 *
 * 同一服务商下重复的模型 id 只留第一条；默认模型按目录的 `defaultSelection` 认，
 * 目录没给时退回服务商自己的 `defaultModel`。
 * @param catalog - 模型目录；读不到时为 null。
 * @returns 去重后的模型选项；目录为空时为空数组。
 */
export function intakeModelOptions(catalog: IntakeModelCatalog | null): readonly IntakeModelOption[] {
  if (catalog === null) return []
  const seen = new Set<string>()
  const options: IntakeModelOption[] = []
  for (const row of catalog.rows) {
    for (const model of row.models) {
      const key = intakeModelKey({ provider: row.provider, model: model.id })
      if (seen.has(key)) continue
      seen.add(key)
      const isDefault = catalog.defaultSelection === undefined
        ? row.defaultModel === model.id
        : catalog.defaultSelection.provider === row.provider && catalog.defaultSelection.model === model.id
      options.push({
        provider: row.provider,
        providerName: row.displayName,
        model: model.id,
        modelName: model.name,
        isDefault,
      })
    }
  }
  return options
}

/**
 * 一个模型选项的稳定键；用来判断两枚选项是不是同一个模型。
 * @param option - 服务商与模型 id。
 * @returns `provider/model` 形式的键。
 */
export function intakeModelKey(option: { readonly provider: string; readonly model: string }): string {
  return `${option.provider}/${option.model}`
}

/**
 * 默认要展示的模型：目录标了默认的那枚，否则第一枚。
 * @param options - 去重后的模型选项。
 * @returns 默认选项；没有可选模型时为 null。
 */
export function defaultIntakeModel(options: readonly IntakeModelOption[]): IntakeModelOption | null {
  return options.find(option => option.isDefault) ?? options[0] ?? null
}
