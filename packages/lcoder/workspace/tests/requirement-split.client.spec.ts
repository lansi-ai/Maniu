/**
 * 需求拆分：只标轨、不再分配岗位；新任务过滤、按轨汇总、未标轨失败、
 * 重试不重拆，以及中文指令里的调研与按轨约束。
 *
 * 流程本身不碰 React；这里用注入端口模拟宿主推流与投影，跑整条链路。
 */
import { describe, expect, it } from 'vitest'
import type { ShellMessage, ShellTask } from '../src/client/shell/shell-data.ts'
import type { ShellSessionNotice } from '../src/client/model-status.ts'
import type { TrackDescriptor } from '@lcoder/kernel/src/schema/tracks.ts'
import {
  REQUIREMENT_SPLIT_PM_PRESET,
  buildPmSplitPrompt, existingSplitTasks, lastAssistantText, newDraftingTasks,
  runRequirementSplit, splitTasksOf, summarizeSplit, trackDistribution,
} from '../src/client/shell/requirement-split.ts'
import type { RequirementSplitPorts } from '../src/client/shell/requirement-split.ts'

/** 被拆分的需求：REQ 编号与标题。 */
const REQUIREMENT = { id: 'REQ-01', title: '随手记账' }

/** 旧流程拆出的任务：只有方案回指，没有需求编号。 */
function proposalTask(id: string): ShellTask {
  const { requirement: _requirement, ...rest } = splitTask(id)
  void _requirement
  return { ...rest, proposal: 'P-01' }
}

/** 拆分后的一条开发任务；默认标 H5 轨并回指需求。 */
function splitTask(id: string, overrides: Partial<ShellTask> = {}): ShellTask {
  return {
    id,
    title: `${id} 的开发任务`,
    description: '按需求第一版清单实现。',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: ['R-01'],
    evidence: [],
    surface: '读 / 契约',
    paths: [],
    irreversible: [],
    requirement: 'REQ-01',
    track: 'h5',
    openedAt: '2026-11-12T09:00:02.084Z',
    ...overrides,
  }
}

const DOCUMENT = '# 项目需求概要 V1\n\n## 第一版功能清单\n- 记一笔\n- 翻记录\n\n## 暂不开发\n- 云同步\n'

const TRACKS: readonly TrackDescriptor[] = [
  { id: 'h5', name: 'H5 前端' },
  { id: 'admin', name: '管理端' },
  { id: 'api', name: '接口' },
  { id: 'desktop', name: '桌面端' },
  { id: 'host', name: '宿主端' },
  { id: 'general', name: '通用' },
  { id: 'payment', name: '支付端' },
]

describe('新任务过滤', () => {
  it('只留回指同需求、拆分前不存在且仍为 drafting 的任务', () => {
    const after = [
      splitTask('T-02'),
      splitTask('T-03', { requirement: 'REQ-02' }),
      splitTask('T-04', { state: 'contracted' }),
      proposalTask('T-05'),
    ]
    expect(newDraftingTasks(['T-01'], after, 'REQ-01').map(task => task.id)).toEqual(['T-02'])
    expect(newDraftingTasks(['T-01', 'T-02'], after, 'REQ-01')).toEqual([])
  })

  it('只返回回指该需求的 drafting 任务', () => {
    const tasks = [splitTask('T-02'), splitTask('T-03', { state: 'implementing' })]
    expect(existingSplitTasks(tasks, 'REQ-01').map(task => task.id)).toEqual(['T-02'])
    expect(existingSplitTasks([splitTask('T-02', { requirement: 'REQ-02' })], 'REQ-01')).toEqual([])
  })

  it('持久判据不限状态：已进待开发或更后的拆分任务仍算拆过', () => {
    const tasks = [
      splitTask('T-02', { state: 'contracted' }),
      splitTask('T-03', { state: 'implementing' }),
      splitTask('T-04', { requirement: 'REQ-02' }),
    ]
    expect(splitTasksOf(tasks, 'REQ-01').map(task => task.id)).toEqual(['T-02', 'T-03'])
    expect(splitTasksOf(tasks, 'REQ-02')).toEqual([tasks[2]])
  })
})

describe('按轨汇总', () => {
  it('统计每条轨的条数，保持投影里的首次出现顺序', () => {
    const tasks = [
      splitTask('T-02', { track: 'h5' }),
      splitTask('T-03', { track: 'api' }),
      splitTask('T-04', { track: 'h5' }),
    ]
    expect(trackDistribution(tasks)).toEqual([
      { track: 'h5', count: 2 },
      { track: 'api', count: 1 },
    ])
  })

  it('未标轨任务留下编号；没有轨时不进分布', () => {
    const { track: withoutTrack, ...untracked } = splitTask('T-03')
    void withoutTrack
    const summary = summarizeSplit([splitTask('T-02'), untracked])
    expect(summary.taskCount).toBe(2)
    expect(summary.tracks).toEqual([{ track: 'h5', count: 1 }])
    expect(summary.untracked).toEqual(['T-03'])
  })
})

describe('中文指令', () => {
  it('项目经理指令带完整需求文档，只写 drafting 任务且不改需求与方案', () => {
    const prompt = buildPmSplitPrompt(REQUIREMENT, { document: DOCUMENT }, TRACKS)
    expect(prompt).toContain('《项目需求概要》正文（.spec/requirements/REQ-01.md）')
    expect(prompt).toContain('- 记一笔\n- 翻记录')
    expect(prompt).toContain('暂不开发的范围不要拆成任务')
    expect(prompt).toContain('执行身份：你是这条需求的项目经理')
    expect(prompt).toContain('明确的拆分授权')
    expect(prompt).toContain('只产出 .spec/tasks 下的任务文件，state 一律 drafting')
    expect(prompt).toContain('不改需求文档、.spec/project.yaml、已有方案与规格条目')
    expect(prompt).toContain('requirement: REQ-01')
    expect(prompt).toContain('不要写 proposal')
  })

  it('拆分前先调研仓库，并把结论写进回复', () => {
    const prompt = buildPmSplitPrompt(REQUIREMENT, { document: DOCUMENT }, TRACKS)
    expect(prompt).toContain('先用 file_list 查看仓库根目录与关键目录')
    expect(prompt).toContain('再读 README 与构建清单')
    expect(prompt).toContain('判断这是空仓、只有需求文档，还是已有可运行框架以及它用的技术栈')
    expect(prompt).toContain('不得只凭需求文档猜技术选型')
  })

  it('每条任务必须从给定集合里标一条轨，禁写 role 与分配', () => {
    const prompt = buildPmSplitPrompt(REQUIREMENT, { document: DOCUMENT }, TRACKS)
    expect(prompt).toContain('track 只能取：h5（H5 前端）、admin（管理端）、api（接口）、desktop（桌面端）、host（宿主端）、general（通用）、payment（支付端）')
    expect(prompt).toContain('一任务一轨')
    expect(prompt).toContain('基础框架任务按项目主技术栈定轨')
    expect(prompt).toContain('不要写 role，也不要调用任何分配命令')
    expect(prompt).toContain('拆完只回报新建任务的编号、标题、轨与依赖')
  })

  it('空仓时第一条仍是基础框架任务，功能任务都依赖它', () => {
    const prompt = buildPmSplitPrompt(REQUIREMENT, { document: DOCUMENT }, TRACKS)
    expect(prompt).toContain('第一条任务必须是「项目基础框架与脚手架」')
    expect(prompt).toContain('技术选型落地（语言、桌面外壳、本地存储形式）')
    expect(prompt).toContain('所有功能任务都在 depends_on 里依赖这条基础任务')
    expect(prompt).toContain('scope.allowed_paths、track')
  })
})

/** 一次流程测试用的世界：会话、推流与投影都可从外面改。 */
interface SplitWorld {
  clock: number
  readonly created: { readonly sessionId: string; readonly preset: string }[]
  readonly prompts: { readonly sessionId: string; readonly text: string }[]
  readonly messages: Map<string, readonly ShellMessage[]>
  readonly running: Map<string, boolean | undefined>
  readonly notices: Map<string, ShellSessionNotice | null>
  tasks: readonly ShellTask[]
  released: number
  onSleep?: () => void
}

/** 组装注入面；`createSession` 依次给 s-1、s-2，并把会话置为运行中。 */
function splitWorld(overrides: Partial<SplitWorld> = {}): { world: SplitWorld; ports: RequirementSplitPorts } {
  const world: SplitWorld = {
    clock: 0,
    created: [],
    prompts: [],
    messages: new Map(),
    running: new Map(),
    notices: new Map(),
    tasks: [],
    released: 0,
    ...overrides,
  }
  const ports: RequirementSplitPorts = {
    createSession: async (preset) => {
      const sessionId = `s-${world.created.length + 1}`
      world.created.push({ sessionId, preset })
      world.running.set(sessionId, true)
      world.messages.set(sessionId, [])
      return sessionId
    },
    sendPrompt: async (sessionId, text) => { world.prompts.push({ sessionId, text }) },
    holdSession: () => () => { world.released += 1 },
    readMessages: sessionId => world.messages.get(sessionId) ?? [],
    readNotice: sessionId => world.notices.get(sessionId) ?? null,
    isRunning: sessionId => world.running.get(sessionId),
    loadTasks: async () => world.tasks,
    now: () => world.clock,
    sleep: async (ms) => {
      world.clock += ms
      world.onSleep?.()
    },
  }
  return { world, ports }
}

/** 让一条会话结束，并写入它最后的助手答复。 */
function finishSession(world: SplitWorld, sessionId: string, text: string): void {
  world.messages.set(sessionId, [{ role: 'assistant', text }])
  world.running.set(sessionId, false)
}

/** 默认流程输入。 */
function planOf(overrides: Partial<Parameters<typeof runRequirementSplit>[0]> = {}) {
  return {
    requirement: REQUIREMENT,
    source: { document: DOCUMENT },
    tracks: TRACKS,
    beforeTaskIds: ['T-01'],
    timeoutMs: 5_000,
    pollMs: 1_000,
    ...overrides,
  }
}

describe('一键拆分链路', () => {
  it('只建项目经理会话，拆完按轨汇总，不调用分配', async () => {
    const { world, ports } = splitWorld()
    const progress: string[] = []
    world.onSleep = () => {
      if (world.running.get('s-1') === true) {
        finishSession(world, 's-1', '已拆出 T-02、T-03。')
        world.tasks = [...world.tasks, splitTask('T-02'), splitTask('T-03', { track: 'api' })]
      }
    }

    const outcome = await runRequirementSplit(planOf(), ports, {
      onProgress: (item) => { progress.push(item.stage) },
    })

    expect(progress).toEqual(['pm'])
    expect(world.created).toEqual([{ sessionId: 's-1', preset: REQUIREMENT_SPLIT_PM_PRESET }])
    expect(world.prompts).toHaveLength(1)
    expect(world.prompts[0]?.text).toContain('执行身份：你是这条需求的项目经理')
    expect(world.released).toBe(1)
    expect(outcome).toMatchObject({
      kind: 'done',
      pmSession: 's-1',
      summary: {
        taskCount: 2,
        tracks: [{ track: 'h5', count: 1 }, { track: 'api', count: 1 }],
        untracked: [],
      },
    })
  })

  it('有任务没标轨时明确失败，带出未标轨编号', async () => {
    const { world, ports } = splitWorld()
    const { track: _track, ...untrackedTask } = splitTask('T-02')
    void _track
    world.onSleep = () => {
      if (world.running.get('s-1') === true) {
        finishSession(world, 's-1', '已拆出 T-02。')
        world.tasks = [...world.tasks, untrackedTask]
      }
    }
    const outcome = await runRequirementSplit(planOf(), ports)
    expect(outcome).toMatchObject({
      kind: 'failed',
      stage: 'pm',
      reason: 'untracked',
      untracked: ['T-02'],
    })
    expect(outcome.kind === 'failed' ? outcome.newTasks.map(task => task.id) : []).toEqual(['T-02'])
  })

  it('已有拆分结果时不再建会话、不再拆第二遍', async () => {
    const { world, ports } = splitWorld()
    const outcome = await runRequirementSplit(planOf({
      existingTasks: [splitTask('T-02'), splitTask('T-03', { track: 'api' })],
    }), ports)
    expect(world.created).toEqual([])
    expect(world.prompts).toEqual([])
    expect(outcome).toMatchObject({
      kind: 'done',
      summary: { taskCount: 2, untracked: [] },
    })
  })

  it('已有任务里有未标轨时按失败报，不建会话', async () => {
    const { world, ports } = splitWorld()
    const { track: _track, ...untrackedTask } = splitTask('T-02')
    void _track
    const outcome = await runRequirementSplit(planOf({
      existingTasks: [untrackedTask],
    }), ports)
    expect(world.created).toEqual([])
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'untracked', untracked: ['T-02'] })
  })

  it('没有完整需求文档时不建任何会话', async () => {
    const { world, ports } = splitWorld()
    const outcome = await runRequirementSplit(planOf({ source: { document: '   ' } }), ports)
    expect(world.created).toEqual([])
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'pm', reason: 'no-document' })
  })

  it('项目经理超时按失败报，释放会话', async () => {
    const { world, ports } = splitWorld()
    const outcome = await runRequirementSplit(planOf({ timeoutMs: 3_000 }), ports)
    expect(world.created).toEqual([{ sessionId: 's-1', preset: REQUIREMENT_SPLIT_PM_PRESET }])
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'pm', reason: 'timeout', newTasks: [] })
    expect(world.released).toBe(1)
  })

  it('项目经理结束但没拆出新任务时报空结果失败', async () => {
    const { world, ports } = splitWorld()
    world.onSleep = () => { finishSession(world, 's-1', '没有需要拆的。') }
    const outcome = await runRequirementSplit(planOf(), ports)
    expect(world.created).toHaveLength(1)
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'pm', reason: 'empty', newTasks: [] })
  })

  it('会话失败时原样带回原因', async () => {
    const { world, ports } = splitWorld()
    world.notices.set('s-1', { key: 'shell.turnFailed', detail: '模型不可用' })
    const outcome = await runRequirementSplit(planOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'pm', reason: 'session-failed', detail: '模型不可用' })
    expect(world.created).toHaveLength(1)
  })

  it('最后一条非空助手答复才是读取来源', () => {
    const messages: readonly ShellMessage[] = [
      { role: 'assistant', text: '先看一下任务。' },
      { role: 'user', text: '继续' },
      { role: 'assistant', text: '已拆出 T-02。' },
      { role: 'assistant', text: '  ' },
    ]
    expect(lastAssistantText(messages)).toBe('已拆出 T-02。')
    expect(lastAssistantText([{ role: 'user', text: 'hi' }])).toBeNull()
  })
})
