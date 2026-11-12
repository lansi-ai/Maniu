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

/** 阶段判定用到的会话事实。 */
export interface IntakeWizardFacts {
  /** 向导是否打开；关闭后一律是 `closed`。 */
  readonly open: boolean
  /** 这条会话是否受理过立项咒语。 */
  readonly started: boolean
  /** 当前待答问题数；审批不算问题。 */
  readonly questionCount: number
  /** 宿主推流里这一轮是否在跑。 */
  readonly running: boolean
  /** 会话里是否已出现过程或答复；用来区分「刚发出、还没开始跑」与「本轮已结束」。 */
  readonly hasOutput: boolean
  /** 投影里读到的方案数。 */
  readonly proposalCount: number
}

/**
 * 按会话事实决定向导当前阶段。
 *
 * 待答问题优先于已有方案：模型继续追问时仍停在提问层，不拿旧方案把提问盖掉。
 * 结果只在本轮已结束、且会话里已经有过输出时出现，避免刚发出咒语就把上一轮
 * 遗留的方案当成这一次的结论。
 * @param facts - 会话事实。
 * @returns 当前阶段。
 */
export function intakeWizardPhase(facts: IntakeWizardFacts): IntakeWizardPhase {
  if (!facts.open) return 'closed'
  if (!facts.started) return 'home'
  if (facts.questionCount > 0) return 'questions'
  if (facts.proposalCount > 0 && !facts.running && facts.hasOutput) return 'result'
  return 'thinking'
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
}

/**
 * 从消息窗口折出思考与工具过程。
 *
 * 只收过程段与助手答复的存在性；用户消息、注入上下文与压缩标记不算输出，
 * 因此刚发出咒语、模型还没动手时不会误判成「本轮已结束」。
 * @param messages - 会话事件窗口折成的消息。
 * @returns 是否已有输出，以及摊平后的过程条目。
 */
export function intakeWizardOutput(messages: readonly ShellMessage[]): IntakeWizardOutput {
  const items: ShellProcessItem[] = []
  let hasOutput = false
  for (const message of messages) {
    if (message.role === 'assistant') hasOutput = true
    else if (message.role === 'process') {
      hasOutput = true
      items.push(...message.items)
    }
  }
  return { hasOutput, items }
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
