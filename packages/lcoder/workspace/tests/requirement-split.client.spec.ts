/**
 * 需求拆分→岗位分配流程：映射解析与校验、新任务过滤、两段会话只建一次、
 * 超时与空结果失败、分配成功/失败汇总，以及两条中文指令的范围约束。
 *
 * 流程本身不碰 React；这里用注入端口模拟宿主推流与投影，跑整条链路。
 */
import { describe, expect, it } from 'vitest'
import type { JobRoleRow } from '../src/client/projection.ts'
import type { ShellMessage, ShellSignResult, ShellTask } from '../src/client/shell/shell-data.ts'
import type { ShellSessionNotice } from '../src/client/model-status.ts'
import {
  REQUIREMENT_SPLIT_MANAGER_PRESET, REQUIREMENT_SPLIT_PM_PRESET,
  buildManagerAssignPrompt, buildPmSplitPrompt, existingSplitTasks, lastAssistantText,
  newDraftingTasks, parseAssignmentMapping, runRequirementSplit, splitTasksOf, summarizeSplit, validateAssignments,
} from '../src/client/shell/requirement-split.ts'
import type { AssignmentPair, RequirementSplitPorts } from '../src/client/shell/requirement-split.ts'

/** 被拆分的需求本体。 */
function requirementTask(overrides: Partial<ShellTask> = {}): ShellTask {
  return {
    id: 'T-01',
    title: '随手记账',
    description: '第一版只做记一笔与翻记录。',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: ['R-01'],
    evidence: [],
    surface: '读 / 契约',
    paths: [],
    irreversible: [],
    proposal: 'P-01',
    openedAt: '2026-11-12T09:00:02.084Z',
    ...overrides,
  }
}

/** 拆分后的一条开发任务。 */
function splitTask(id: string, overrides: Partial<ShellTask> = {}): ShellTask {
  return {
    ...requirementTask(),
    id,
    title: `${id} 的开发任务`,
    description: '按需求第一版清单实现。',
    ...overrides,
  }
}

const DOCUMENT = '# 项目需求概要 V1\n\n## 第一版功能清单\n- 记一笔\n- 翻记录\n\n## 暂不开发\n- 云同步\n'

const ROSTER: readonly JobRoleRow[] = [
  { id: 'architect', name: '架构师', inherits: 'architect' },
  {
    id: 'vue-engineer',
    name: 'Vue 工程师',
    inherits: 'dev',
    signals: { strong: ['vue'], medium: ['页面'], preferredPaths: ['src/views/'] },
  },
]

describe('新任务过滤', () => {
  it('只留同方案、拆分前不存在且仍为 drafting 的任务', () => {
    const after = [
      requirementTask(),
      splitTask('T-02'),
      splitTask('T-03', { proposal: 'P-02' }),
      splitTask('T-04', { state: 'contracted' }),
    ]
    expect(newDraftingTasks(['T-01'], after, 'P-01').map(task => task.id)).toEqual(['T-02'])
    expect(newDraftingTasks(['T-01', 'T-02'], after, 'P-01')).toEqual([])
    expect(newDraftingTasks(['T-01'], after, undefined)).toEqual([])
  })

  it('已拆任务排除需求本体，只返回同方案的 drafting 任务', () => {
    const tasks = [requirementTask(), splitTask('T-02'), splitTask('T-03', { state: 'implementing' })]
    expect(existingSplitTasks(tasks, requirementTask()).map(task => task.id)).toEqual(['T-02'])
    expect(existingSplitTasks([requirementTask()], requirementTask())).toEqual([])
    const { proposal: withoutProposal, ...rest } = requirementTask()
    void withoutProposal
    expect(existingSplitTasks(tasks, rest)).toEqual([])
  })

  it('持久判据不限状态：已进待开发或更后的拆分任务仍算拆过', () => {
    const tasks = [
      requirementTask(),
      splitTask('T-02', { state: 'contracted' }),
      splitTask('T-03', { state: 'implementing' }),
      splitTask('T-04', { proposal: 'P-02' }),
    ]
    expect(splitTasksOf(tasks, requirementTask()).map(task => task.id)).toEqual(['T-02', 'T-03'])
    expect(splitTasksOf([requirementTask()], requirementTask())).toEqual([])
  })
})

describe('分配映射解析', () => {
  it('裸 JSON 正常解析，任务与岗位都去首尾空白', () => {
    expect(parseAssignmentMapping('{"assignments":[{"task":" T-02 ","role":" architect "}]}')).toEqual({
      kind: 'ok',
      pairs: [{ task: 'T-02', role: 'architect' }],
    })
  })

  it('带说明文字与 json 代码围栏也能解析', () => {
    const text = '已按领域分配：\n\n```json\n{"assignments":[{"task":"T-02","role":"vue-engineer"}]}\n```\n'
    expect(parseAssignmentMapping(text)).toEqual({
      kind: 'ok',
      pairs: [{ task: 'T-02', role: 'vue-engineer' }],
    })
  })

  it('坏 JSON 与结构不对都按读不懂报，不猜分配', () => {
    expect(parseAssignmentMapping('{"assignments":[{"task":"T-02",')).toEqual({ kind: 'bad' })
    expect(parseAssignmentMapping('{"items":[]}')).toEqual({ kind: 'bad' })
    expect(parseAssignmentMapping('{"assignments":[{"task":1,"role":"dev"}]}')).toEqual({ kind: 'bad' })
  })

  it('没有 JSON 形状的答复按映射缺失处理', () => {
    expect(parseAssignmentMapping(null)).toEqual({ kind: 'missing' })
    expect(parseAssignmentMapping('  ')).toEqual({ kind: 'missing' })
    expect(parseAssignmentMapping('都分配好了，没有映射。')).toEqual({ kind: 'missing' })
  })

  it('最后一条非空助手答复才是映射来源', () => {
    const messages: readonly ShellMessage[] = [
      { role: 'assistant', text: '先看一下任务。' },
      { role: 'user', text: '继续' },
      { role: 'assistant', text: '{"assignments":[]}' },
      { role: 'assistant', text: '  ' },
    ]
    expect(lastAssistantText(messages)).toBe('{"assignments":[]}')
    expect(lastAssistantText([{ role: 'user', text: 'hi' }])).toBeNull()
  })
})

describe('分配校验与汇总', () => {
  it('未知任务、空岗位与重复条目被拒，可用条目保持顺序', () => {
    const pairs: readonly AssignmentPair[] = [
      { task: 'T-02', role: 'architect' },
      { task: 'T-09', role: 'architect' },
      { task: 'T-03', role: '' },
      { task: 'T-02', role: 'dev' },
      { task: 'T-03', role: 'vue-engineer' },
    ]
    expect(validateAssignments(pairs, new Set(['T-02', 'T-03']))).toEqual({
      accepted: [
        { task: 'T-02', role: 'architect' },
        { task: 'T-03', role: 'vue-engineer' },
      ],
      rejected: [
        { task: 'T-09', role: 'architect', reason: 'unknown-task' },
        { task: 'T-03', role: '', reason: 'empty-role' },
        { task: 'T-02', role: 'dev', reason: 'duplicate' },
      ],
    })
  })

  it('汇总把命令失败、被拒条目、晋级结果与最终未分配分别记下', () => {
    const tasks = [splitTask('T-02'), splitTask('T-03'), splitTask('T-04', { role: 'architect' })]
    const summary = summarizeSplit(tasks, [
      { taskId: 'T-02', roleId: 'architect', ok: true, detail: '已分配' },
      { taskId: 'T-03', roleId: 'dev', ok: false, detail: '岗位不认识' },
    ], [{ task: 'T-09', role: 'dev', reason: 'unknown-task' }], [
      { taskId: 'T-02', ok: true, detail: '已进入待开发' },
      { taskId: 'T-03', ok: false, detail: '还没分配岗位' },
    ])
    expect(summary.taskCount).toBe(3)
    expect(summary.assignedCount).toBe(2)
    expect(summary.advancedCount).toBe(1)
    expect(summary.unassigned).toEqual(['T-03'])
    expect(summary.rejected).toHaveLength(1)
    expect(summary.advances).toHaveLength(2)
    expect(summarizeSplit(
      [splitTask('T-02')], [], [{ task: 'T-02', role: '', reason: 'empty-role' }], [],
    )).toMatchObject({ assignedCount: 0, advancedCount: 0, unassigned: [] })
  })
})

describe('两段中文指令', () => {
  it('项目经理指令带完整需求文档，只写 drafting 任务且不改需求与方案', () => {
    const prompt = buildPmSplitPrompt(requirementTask(), { document: DOCUMENT })
    expect(prompt).toContain('《项目需求概要》正文（.spec/requirements/P-01.md）')
    expect(prompt).toContain('- 记一笔\n- 翻记录')
    expect(prompt).toContain('暂不开发的范围不要拆成任务')
    expect(prompt).toContain('执行身份：你是这条需求的项目经理')
    expect(prompt).toContain('明确的拆分授权')
    expect(prompt).toContain('只产出 .spec/tasks 下的任务文件，state 一律 drafting')
    expect(prompt).toContain('不改需求文档、.spec/project.yaml、已有方案与规格条目')
  })

  it('研发经理指令带需求、任务清单、名册与唯一映射契约', () => {
    const prompt = buildManagerAssignPrompt({
      task: requirementTask(),
      source: { document: DOCUMENT },
      newTasks: [splitTask('T-02'), splitTask('T-03', { description: '  前端页面与交互  ' })],
      roster: ROSTER,
    })
    expect(prompt).toContain('岗位分配')
    expect(prompt).toContain('- T-02：T-02 的开发任务')
    expect(prompt).toContain('描述摘要：前端页面与交互')
    expect(prompt).toContain('- architect（架构师，继承 architect）')
    expect(prompt).toContain('- vue-engineer（Vue 工程师，继承 dev；强特征：vue；弱语义：页面；落点：src/views/）')
    expect(prompt).toContain('role_draft')
    expect(prompt).toContain('{"assignments":[{"task":"T-02","role":"architect"}]}')
    expect(prompt).toContain('不改任务状态、不写代码、不跑命令')
    expect(prompt).toContain('《项目需求概要》正文（.spec/requirements/P-01.md）')
  })

  it('名册为空时如实写出来，并要求先起草岗位', () => {
    const prompt = buildManagerAssignPrompt({
      task: requirementTask(), source: { document: DOCUMENT }, newTasks: [splitTask('T-02')], roster: [],
    })
    expect(prompt).toContain('名册为空')
    expect(prompt).toContain('先用 role_draft 起草')
  })
})

/** 一次流程测试用的世界：会话、推流、投影与分配回执都可从外面改。 */
interface SplitWorld {
  clock: number
  readonly created: { readonly sessionId: string; readonly preset: string }[]
  readonly prompts: { readonly sessionId: string; readonly text: string }[]
  readonly assignments: { readonly sessionId: string; readonly taskId: string; readonly roleId: string }[]
  readonly readyCalls: string[]
  readonly messages: Map<string, readonly ShellMessage[]>
  readonly running: Map<string, boolean | undefined>
  readonly notices: Map<string, ShellSessionNotice | null>
  tasks: readonly ShellTask[]
  roster: readonly JobRoleRow[]
  released: number
  onSleep?: () => void
  assignResult?: (taskId: string, roleId: string) => ShellSignResult
  splitReadyResult?: (taskId: string) => ShellSignResult
}

/** 组装注入面；`createSession` 依次给 s-1、s-2，并把会话置为运行中。 */
function splitWorld(overrides: Partial<SplitWorld> = {}): { world: SplitWorld; ports: RequirementSplitPorts } {
  const world: SplitWorld = {
    clock: 0,
    created: [],
    prompts: [],
    assignments: [],
    readyCalls: [],
    messages: new Map(),
    running: new Map(),
    notices: new Map(),
    tasks: [requirementTask()],
    roster: ROSTER,
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
    assignTask: async (sessionId, taskId, roleId) => {
      world.assignments.push({ sessionId, taskId, roleId })
      return world.assignResult?.(taskId, roleId) ?? { ok: true, text: '已分配' }
    },
    splitReady: async (taskId) => {
      world.readyCalls.push(taskId)
      return world.splitReadyResult?.(taskId) ?? { ok: true, text: '已进入待开发' }
    },
    loadTasks: async () => world.tasks,
    loadRoster: async () => world.roster,
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
    task: requirementTask(),
    source: { document: DOCUMENT },
    roster: ROSTER,
    beforeTaskIds: ['T-01'],
    timeoutMs: 5_000,
    pollMs: 1_000,
    ...overrides,
  }
}

describe('一键拆分链路', () => {
  it('项目经理先拆、研发经理再定岗，外壳按映射逐条分配', async () => {
    const { world, ports } = splitWorld()
    const progress: string[] = []
    world.onSleep = () => {
      if (world.created[0] !== undefined && world.running.get('s-1') === true) {
        finishSession(world, 's-1', '已拆出 T-02。')
        world.tasks = [...world.tasks, splitTask('T-02')]
        return
      }
      if (world.running.get('s-2') === true) {
        finishSession(world, 's-2', '{"assignments":[{"task":"T-02","role":"architect"}]}')
      }
    }

    const outcome = await runRequirementSplit(planOf(), ports, {
      onProgress: (item) => { progress.push(item.stage) },
    })

    expect(progress).toEqual(['pm', 'manager', 'assigning', 'readying'])
    expect(world.created).toEqual([
      { sessionId: 's-1', preset: REQUIREMENT_SPLIT_PM_PRESET },
      { sessionId: 's-2', preset: REQUIREMENT_SPLIT_MANAGER_PRESET },
    ])
    expect(world.prompts[0]?.sessionId).toBe('s-1')
    expect(world.prompts[0]?.text).toContain('执行身份：你是这条需求的项目经理')
    expect(world.prompts[1]?.text).toContain('- T-02：T-02 的开发任务')
    expect(world.prompts[1]?.text).toContain('当前岗位名册')
    expect(world.assignments).toEqual([{ sessionId: 's-2', taskId: 'T-02', roleId: 'architect' }])
    expect(world.readyCalls).toEqual(['T-02'])
    expect(world.released).toBe(2)
    expect(outcome).toMatchObject({
      kind: 'done',
      pmSession: 's-1',
      managerSession: 's-2',
      summary: { taskCount: 1, assignedCount: 1, advancedCount: 1, unassigned: [] },
    })
  })

  it('没有完整需求文档时不建任何会话', async () => {
    const { world, ports } = splitWorld()
    const outcome = await runRequirementSplit(planOf({ source: { document: '   ' } }), ports)
    expect(world.created).toEqual([])
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'pm', reason: 'no-document' })
  })

  it('项目经理超时按失败报，不建研发经理会话', async () => {
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

  it('会话失败时原样带回原因，不继续往下走', async () => {
    const { world, ports } = splitWorld()
    world.notices.set('s-1', { key: 'shell.turnFailed', detail: '模型不可用' })
    const outcome = await runRequirementSplit(planOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'pm', reason: 'session-failed', detail: '模型不可用' })
    expect(world.created).toHaveLength(1)
  })

  it('研发经理给不出映射时不猜分配，任务留在失败结果里可重试', async () => {
    const { world, ports } = splitWorld()
    world.onSleep = () => {
      if (world.created[0] !== undefined && world.running.get('s-1') === true) {
        finishSession(world, 's-1', '已拆出 T-02。')
        world.tasks = [...world.tasks, splitTask('T-02')]
        return
      }
      if (world.running.get('s-2') === true) finishSession(world, 's-2', '都分配好了。')
    }
    const outcome = await runRequirementSplit(planOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'manager', reason: 'missing-mapping' })
    expect(outcome.kind === 'failed' ? outcome.newTasks.map(task => task.id) : []).toEqual(['T-02'])
    expect(world.assignments).toEqual([])
  })

  it('映射是坏 JSON 时同样不分配', async () => {
    const { world, ports } = splitWorld()
    world.onSleep = () => {
      if (world.created[0] !== undefined && world.running.get('s-1') === true) {
        finishSession(world, 's-1', '已拆出 T-02。')
        world.tasks = [...world.tasks, splitTask('T-02')]
        return
      }
      if (world.running.get('s-2') === true) finishSession(world, 's-2', '{"assignments":[{"task":"T-02",')
    }
    const outcome = await runRequirementSplit(planOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'manager', reason: 'bad-mapping' })
    expect(world.assignments).toEqual([])
  })

  it('映射只含未知任务时按无可用条目失败', async () => {
    const { world, ports } = splitWorld()
    world.onSleep = () => {
      if (world.created[0] !== undefined && world.running.get('s-1') === true) {
        finishSession(world, 's-1', '已拆出 T-02。')
        world.tasks = [...world.tasks, splitTask('T-02')]
        return
      }
      if (world.running.get('s-2') === true) {
        finishSession(world, 's-2', '{"assignments":[{"task":"T-09","role":"dev"}]}')
      }
    }
    const outcome = await runRequirementSplit(planOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'manager', reason: 'no-valid-assignment' })
    expect(world.assignments).toEqual([])
  })

  it('分配回执成功与失败分开汇总，未分配任务留在明细里', async () => {
    const { world, ports } = splitWorld()
    world.assignResult = taskId => taskId === 'T-02'
      ? { ok: true, text: '已分配' }
      : { ok: false, text: '岗位不认识' }
    world.onSleep = () => {
      if (world.created[0] !== undefined && world.running.get('s-1') === true) {
        finishSession(world, 's-1', '已拆出 T-02、T-03。')
        world.tasks = [...world.tasks, splitTask('T-02'), splitTask('T-03')]
        return
      }
      if (world.running.get('s-2') === true) {
        finishSession(world, 's-2', '{"assignments":[{"task":"T-02","role":"architect"},{"task":"T-03","role":"dev"}]}')
      }
    }
    const outcome = await runRequirementSplit(planOf(), ports)
    expect(outcome.kind).toBe('done')
    if (outcome.kind !== 'done') return
    expect(outcome.summary.assignedCount).toBe(1)
    expect(outcome.summary.unassigned).toEqual(['T-03'])
    expect(outcome.summary.assignments.map(item => [item.taskId, item.ok])).toEqual([
      ['T-02', true], ['T-03', false],
    ])
  })

  it('已有拆分结果时跳过项目经理，只为未分配任务建研发经理会话并推进待开发', async () => {
    const { world, ports } = splitWorld()
    world.onSleep = () => {
      if (world.running.get('s-1') === true) {
        finishSession(world, 's-1', '{"assignments":[{"task":"T-02","role":"architect"}]}')
      }
    }
    const outcome = await runRequirementSplit(planOf({ existingTasks: [splitTask('T-02')] }), ports)
    expect(world.created).toEqual([{ sessionId: 's-1', preset: REQUIREMENT_SPLIT_MANAGER_PRESET }])
    expect(world.prompts).toHaveLength(1)
    expect(world.assignments).toEqual([{ sessionId: 's-1', taskId: 'T-02', roleId: 'architect' }])
    expect(world.readyCalls).toEqual(['T-02'])
    expect(outcome).toMatchObject({
      kind: 'done',
      summary: { taskCount: 1, assignedCount: 1, advancedCount: 1 },
    })
  })

  it('重试只补未分配的岗位，已分配任务照常推进到待开发', async () => {
    const { world, ports } = splitWorld()
    world.onSleep = () => {
      if (world.running.get('s-1') === true) {
        finishSession(world, 's-1', '{"assignments":[{"task":"T-03","role":"dev"}]}')
      }
    }
    const outcome = await runRequirementSplit(planOf({
      existingTasks: [splitTask('T-02', { role: 'architect' }), splitTask('T-03')],
    }), ports)

    expect(world.created).toEqual([{ sessionId: 's-1', preset: REQUIREMENT_SPLIT_MANAGER_PRESET }])
    // 已分配的 T-02 不再进研发经理的清单。
    expect(world.prompts[0]?.text).not.toContain('- T-02：')
    expect(world.prompts[0]?.text).toContain('- T-03：')
    expect(world.assignments).toEqual([{ sessionId: 's-1', taskId: 'T-03', roleId: 'dev' }])
    expect(world.readyCalls).toEqual(['T-02', 'T-03'])
    expect(outcome).toMatchObject({
      kind: 'done',
      summary: { taskCount: 2, assignedCount: 2, advancedCount: 2, unassigned: [] },
    })
  })

  it('已不是起草态的任务跳过推进，不报错也不建研发经理会话', async () => {
    const { world, ports } = splitWorld()
    const outcome = await runRequirementSplit(planOf({
      existingTasks: [
        splitTask('T-02', { role: 'architect', state: 'contracted' }),
        splitTask('T-03', { role: 'dev' }),
      ],
    }), ports)

    expect(world.created).toEqual([])
    expect(world.prompts).toEqual([])
    expect(world.assignments).toEqual([])
    expect(world.readyCalls).toEqual(['T-03'])
    expect(outcome).toMatchObject({
      kind: 'done',
      summary: { taskCount: 2, assignedCount: 2, advancedCount: 1, unassigned: [] },
    })
  })

  it('推进失败逐条记下原文，其余任务照常晋级', async () => {
    const { world, ports } = splitWorld()
    world.splitReadyResult = taskId => taskId === 'T-02'
      ? { ok: true, text: '已进入待开发' }
      : { ok: false, text: 'T-03 还没分配岗位' }
    world.onSleep = () => {
      if (world.running.get('s-1') === true) {
        finishSession(world, 's-1', '{"assignments":[{"task":"T-02","role":"architect"},{"task":"T-03","role":"dev"}]}')
      }
    }
    const outcome = await runRequirementSplit(planOf({
      existingTasks: [splitTask('T-02'), splitTask('T-03')],
    }), ports)

    expect(outcome.kind).toBe('done')
    if (outcome.kind !== 'done') return
    expect(outcome.summary.advancedCount).toBe(1)
    expect(outcome.summary.advances).toEqual([
      { taskId: 'T-02', ok: true, detail: '已进入待开发' },
      { taskId: 'T-03', ok: false, detail: 'T-03 还没分配岗位' },
    ])
  })

  it('研发经理超时保留已拆出的任务，重试不必再拆一遍', async () => {
    const { world, ports } = splitWorld()
    world.onSleep = () => {
      if (world.created[0] !== undefined && world.running.get('s-1') === true) {
        finishSession(world, 's-1', '已拆出 T-02。')
        world.tasks = [...world.tasks, splitTask('T-02')]
      }
    }
    const outcome = await runRequirementSplit(planOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'manager', reason: 'timeout' })
    const failed = outcome.kind === 'failed' ? outcome : null
    expect(failed?.newTasks.map(task => task.id)).toEqual(['T-02'])
  })
})
