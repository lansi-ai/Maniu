/**
 * 需求分析师向导的纯判定：阶段只从会话事实算，咒语是否发过只看三个会话信号，
 * 模型选项从目录摊平后去重。这里不渲染组件，也不碰宿主接口。
 */
import { describe, expect, it } from 'vitest'
import type { ShellMessage } from '../src/client/shell/shell-data.ts'
import {
  defaultIntakeModel, intakeModelOptions, intakePromptStarted, intakeWizardOutput, intakeWizardPhase,
} from '../src/client/shell/intake-wizard.ts'
import type { IntakeModelCatalog, IntakeWizardFacts } from '../src/client/shell/intake-wizard.ts'

/** 一份还没开始的向导事实；各用例只覆盖自己关心的字段。 */
const home: IntakeWizardFacts = {
  open: true,
  started: false,
  questionCount: 0,
  running: false,
  hasOutput: false,
  proposalCount: 0,
}

describe('向导阶段', () => {
  it('没打开就是关闭态，即便会话里已经有方案', () => {
    expect(intakeWizardPhase({ ...home, open: false, started: true, proposalCount: 2 })).toBe('closed')
  })

  it('打开但咒语还没发出时停在首页', () => {
    expect(intakeWizardPhase(home)).toBe('home')
  })

  it('有待答问题时进提问层', () => {
    expect(intakeWizardPhase({ ...home, started: true, questionCount: 2, running: true })).toBe('questions')
  })

  it('提问优先于旧方案：模型继续追问时不拿上一轮方案盖掉提问', () => {
    expect(intakeWizardPhase({
      ...home, started: true, questionCount: 1, proposalCount: 1, hasOutput: true,
    })).toBe('questions')
  })

  it('问题答完、还在跑时显示思考中', () => {
    expect(intakeWizardPhase({ ...home, started: true, running: true, hasOutput: true })).toBe('thinking')
  })

  it('刚发出、还没有任何输出时也是思考中，不误判为结果', () => {
    expect(intakeWizardPhase({
      ...home, started: true, running: true, hasOutput: false, proposalCount: 1,
    })).toBe('thinking')
  })

  it('本轮结束且有方案时进结果卡', () => {
    expect(intakeWizardPhase({
      ...home, started: true, running: false, hasOutput: true, proposalCount: 1,
    })).toBe('result')
  })

  it('本轮结束但投影里没有方案时继续停在思考中', () => {
    expect(intakeWizardPhase({
      ...home, started: true, running: false, hasOutput: true, proposalCount: 0,
    })).toBe('thinking')
  })

  it('方案存在但本轮还在跑时不算结果', () => {
    expect(intakeWizardPhase({
      ...home, started: true, running: true, hasOutput: true, proposalCount: 1,
    })).toBe('thinking')
  })
})

describe('咒语是否已经发出过', () => {
  it('会话行的 blank 已落 → 发过', () => {
    expect(intakePromptStarted({ blank: false, userMessages: 0, awaitingFirstTurn: false })).toBe(true)
  })

  it('消息窗口里已有用户消息 → 发过，不依赖 blank', () => {
    expect(intakePromptStarted({ blank: true, userMessages: 1, awaitingFirstTurn: undefined })).toBe(true)
  })

  it('首条提示正等首个回合 → 发过', () => {
    expect(intakePromptStarted({ blank: undefined, userMessages: 0, awaitingFirstTurn: true })).toBe(true)
  })

  it('会话行读不到且没有消息 → 按没发过处理，首次确认才发得出去', () => {
    expect(intakePromptStarted({ blank: undefined, userMessages: 0, awaitingFirstTurn: undefined })).toBe(false)
  })

  it('同一份事实重复判定结果不变：关掉向导再打开不会重发', () => {
    const started = { blank: false, userMessages: 0, awaitingFirstTurn: false }
    expect(intakePromptStarted(started)).toBe(true)
    expect(intakePromptStarted(started)).toBe(true)
  })
})

describe('思考过程汇总', () => {
  it('把过程段摊平，助手答复只记有输出，不算过程条目', () => {
    const messages: readonly ShellMessage[] = [
      { role: 'user', text: '全新项目立项：demo', hidden: true },
      { role: 'process', items: [{ kind: 'reasoning', text: '先问清目标' }] },
      { role: 'assistant', text: '## 需求概要' },
      { role: 'process', items: [{ kind: 'tool', callId: 'c1', name: 'file_read', args: '{}', ok: true }] },
    ]

    const output = intakeWizardOutput(messages)

    expect(output.hasOutput).toBe(true)
    expect(output.items).toEqual([
      { kind: 'reasoning', text: '先问清目标' },
      { kind: 'tool', callId: 'c1', name: 'file_read', args: '{}', ok: true },
    ])
  })

  it('只有用户消息、注入上下文与压缩标记时不算有输出', () => {
    const messages: readonly ShellMessage[] = [
      { role: 'user', text: '全新项目立项：demo', hidden: true },
      { role: 'context', text: 'runtime context', label: 'runtime-context' },
      { role: 'compaction', items: 2, tokens: 100 },
    ]

    expect(intakeWizardOutput(messages)).toEqual({ hasOutput: false, items: [] })
  })
})

describe('模型选项', () => {
  const catalog: IntakeModelCatalog = {
    defaultSelection: { provider: 'deepseek-official', model: 'deepseek-chat' },
    rows: [
      {
        provider: 'deepseek-official',
        displayName: 'DeepSeek',
        defaultModel: 'deepseek-chat',
        models: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat' },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
        ],
      },
      {
        provider: 'minimax-cn',
        displayName: 'MiniMax',
        models: [{ id: 'abab', name: 'ABAB' }],
      },
    ],
  }

  it('摊平成一行一个模型，并按目录默认标记', () => {
    const options = intakeModelOptions(catalog)

    expect(options.map(option => `${option.provider}/${option.model}`)).toEqual([
      'deepseek-official/deepseek-chat',
      'deepseek-official/deepseek-reasoner',
      'minimax-cn/abab',
    ])
    expect(options.filter(option => option.isDefault).map(option => option.model)).toEqual(['deepseek-chat'])
    expect(defaultIntakeModel(options)?.model).toBe('deepseek-chat')
  })

  it('重复的服务商/模型只留第一条', () => {
    const options = intakeModelOptions({
      rows: [
        { provider: 'p', displayName: 'P', models: [{ id: 'm', name: 'M' }] },
        { provider: 'p', displayName: 'P', models: [{ id: 'm', name: 'M again' }] },
      ],
    })

    expect(options).toHaveLength(1)
    expect(options[0]?.modelName).toBe('M')
  })

  it('目录没给默认选择时退回服务商的 defaultModel；都没有就取第一枚', () => {
    const withoutGlobal = intakeModelOptions({
      rows: [{ provider: 'p', displayName: 'P', defaultModel: 'b', models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }],
    })
    expect(defaultIntakeModel(withoutGlobal)?.model).toBe('b')

    const none = intakeModelOptions({ rows: [{ provider: 'p', displayName: 'P', models: [{ id: 'a', name: 'A' }] }] })
    expect(defaultIntakeModel(none)?.model).toBe('a')
  })

  it('目录读不到或没有模型时给出空表', () => {
    expect(intakeModelOptions(null)).toEqual([])
    expect(intakeModelOptions({ rows: [] })).toEqual([])
    expect(defaultIntakeModel([])).toBeNull()
  })
})
