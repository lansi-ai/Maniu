/**
 * 方案讨论与契约门禁：会议规模三档、岗位映射与去重、看板列派生、契约完整性、
 * 多岗位/单岗位会议链路与确认后的逐条签署推进。
 *
 * 流程不碰 React；这里用注入端口模拟宿主推流、契约投影与两条人机命令。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ContractRow, JobRoleRow } from '../src/client/projection.ts'
import type { ShellMessage, ShellSignResult, ShellTask } from '../src/client/shell/shell-data.ts'
import type { ShellSessionNotice } from '../src/client/model-status.ts'
import {
  boardColumnOf, buildContractDraftPrompt, buildMeetingPrompt, confirmPlan, contractComplete, contractOf,
  contractSigned, discussionNeeded, discussionTasksOf, meetingRoleOf, meetingTierOf, planDiscussionGroups,
  runPlanDiscussion,
} from '../src/client/shell/plan-discussion.ts'
import type {
  MeetingRole, PlanConfirmPorts, PlanDiscussionPorts,
} from '../src/client/shell/plan-discussion.ts'

const DOCUMENT = '# 项目需求概要 V1\n\n## 第一版功能清单\n- 记一笔\n- 翻记录\n'

const ROSTER: readonly JobRoleRow[] = [
  { id: 'architect', name: '架构师', inherits: 'architect' },
  {
    id: 'vue-engineer',
    name: 'Vue 工程师',
    inherits: 'dev',
    persona: '负责页面与交互。',
    signals: { strong: ['vue'], medium: ['页面'], preferredPaths: ['src/views/'] },
  },
  { id: 'ops-engineer', name: '运维工程师', inherits: 'ops' },
  { id: 'reviewer', name: '评审员', inherits: 'review' },
]

/** 一条拆分任务；默认 B 级、已分配 Vue 岗位。 */
function taskOf(id: string, overrides: Partial<ShellTask> = {}): ShellTask {
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
    proposal: 'P-01',
    role: 'vue-engineer',
    openedAt: '2026-11-12T09:00:02.084Z',
    ...overrides,
  }
}

/** 需求本体：drafting、带方案回指但没有岗位。 */
function requirementOf(id: string, overrides: Partial<ShellTask> = {}): ShellTask {
  const { role, ...rest } = taskOf(id, overrides)
  void role
  return rest
}

/** 一份完整契约；默认未签。 */
function contractOfTask(id: string, overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    id,
    change: ['实现记一笔'],
    notChange: ['不改需求'],
    acceptance: ['保存后能在列表看到'],
    failIf: ['金额不合法仍落账'],
    signedBy: null,
    signedAt: null,
    ...overrides,
  }
}

describe('会议规模与岗位映射', () => {
  it('A 级、有不可逆项、基础框架与架构任务开完整会', () => {
    expect(meetingTierOf(taskOf('T-02', { grade: 'A' }))).toBe('full')
    expect(meetingTierOf(taskOf('T-02', { irreversible: ['删库'] }))).toBe('full')
    expect(meetingTierOf(taskOf('T-02', { title: '项目基础框架与脚手架' }))).toBe('full')
    expect(meetingTierOf(taskOf('T-02'), meetingRoleOf('architect', ROSTER))).toBe('full')
  })

  it('涉及三个以上不同岗位时整批开完整会', () => {
    expect(meetingTierOf(taskOf('T-02'), undefined, 3)).toBe('full')
  })

  it('B 级单岗位加架构师，C 级且无不可逆项走单岗位轻量会', () => {
    expect(meetingTierOf(taskOf('T-02'))).toBe('paired')
    expect(meetingTierOf(taskOf('T-02', { grade: 'C' }))).toBe('solo')
    expect(meetingTierOf(taskOf('T-02', { grade: 'C', irreversible: ['部署'] }))).toBe('full')
  })

  it('名册岗位按 inherits 映射到预设；内置角色直接用 id；未知岗位返回 undefined', () => {
    expect(meetingRoleOf('vue-engineer', ROSTER)).toMatchObject({ id: 'vue-engineer', inherits: 'dev', preset: 'lcoder' })
    expect(meetingRoleOf('ops-engineer', ROSTER)).toMatchObject({ inherits: 'ops', preset: 'lcoder-ops' })
    expect(meetingRoleOf('reviewer', ROSTER)).toMatchObject({ inherits: 'review', preset: 'lcoder-review' })
    expect(meetingRoleOf('architect', ROSTER)).toMatchObject({ inherits: 'architect', preset: 'lcoder-architect' })
    expect(meetingRoleOf('ghost', ROSTER)).toBeUndefined()
  })
})

describe('讨论分组', () => {
  it('同岗位只建一次会：两条 Vue 任务共用一个岗位加架构师的会', () => {
    const plan = planDiscussionGroups([taskOf('T-02'), taskOf('T-03')], ROSTER)
    expect(plan.unresolved).toEqual([])
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]).toMatchObject({ tier: 'paired', taskIds: ['T-02', 'T-03'] })
    expect(plan.groups[0]?.roles.map(role => role.id)).toEqual(['vue-engineer', 'architect'])
  })

  it('C 级小改动只邀请该岗位，不加架构师', () => {
    const plan = planDiscussionGroups([taskOf('T-02', { grade: 'C' })], ROSTER)
    expect(plan.groups[0]).toMatchObject({ tier: 'solo', taskIds: ['T-02'] })
    expect(plan.groups[0]?.roles.map(role => role.id)).toEqual(['vue-engineer'])
  })

  it('三个岗位的任务整批进完整会，参与岗位是并集加架构师', () => {
    const plan = planDiscussionGroups([
      taskOf('T-02'),
      taskOf('T-03', { role: 'ops-engineer' }),
      taskOf('T-04', { role: 'reviewer' }),
    ], ROSTER)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.tier).toBe('full')
    expect(plan.groups[0]?.roles.map(role => role.id)).toEqual(['vue-engineer', 'ops-engineer', 'reviewer', 'architect'])
  })

  it('岗位映射不了时如实记进 unresolved，不猜预设', () => {
    const plan = planDiscussionGroups([taskOf('T-02', { role: 'ghost' })], ROSTER)
    expect(plan.groups).toEqual([])
    expect(plan.unresolved).toEqual([{ taskId: 'T-02', role: 'ghost' }])
  })
})

describe('看板列与契约判据', () => {
  it('拆分后已分配岗位的 drafting 任务进方案讨论，需求本体留在需求确认', () => {
    expect(boardColumnOf(taskOf('T-02'))).toBe('discussion')
    expect(boardColumnOf(requirementOf('T-01'))).toBe('drafting')
    expect(boardColumnOf(taskOf('T-02', { state: 'contracted' }))).toBe('contracted')
  })

  it('契约缺失、缺必填项与已签分别读出三种状态', () => {
    expect(contractSigned(undefined)).toBe(false)
    expect(contractComplete(undefined)).toBe(false)
    expect(contractComplete(contractOfTask('T-02', { failIf: [] }))).toBe(false)
    expect(contractComplete(contractOfTask('T-02'))).toBe(true)
    expect(contractSigned(contractOfTask('T-02', { signedBy: 'human', signedAt: '10:00' }))).toBe(true)
  })

  it('已有完整契约时不再重复讨论；缺契约或缺必填项时需要讨论', () => {
    const tasks = [taskOf('T-02'), taskOf('T-03')]
    expect(discussionNeeded(tasks, [contractOfTask('T-02'), contractOfTask('T-03')])).toBe(false)
    expect(discussionNeeded(tasks, [contractOfTask('T-02')])).toBe(true)
    expect(discussionNeeded(tasks, [contractOfTask('T-02'), contractOfTask('T-03', { acceptance: [] })])).toBe(true)
    expect(contractOf([contractOfTask('T-02')], 'T-03')).toBeUndefined()
  })

  it('同需求下仍待讨论的任务按方案取、需求本体与已推进任务不进这批', () => {
    const tasks = [
      requirementOf('T-01'),
      taskOf('T-02'),
      taskOf('T-03', { state: 'contracted' }),
      taskOf('T-04', { proposal: 'P-02' }),
    ]
    expect(discussionTasksOf(tasks, taskOf('T-02')).map(row => row.id)).toEqual(['T-02'])
    expect(discussionTasksOf(tasks, requirementOf('T-01'))).toEqual([])
  })
})

/** 名册里某个岗位的讨论形态；测试里缺就是名册写错。 */
function roleOf(id: string): MeetingRole {
  const role = meetingRoleOf(id, ROSTER)
  if (role === undefined) throw new Error(`missing meeting role ${id}`)
  return role
}

describe('讨论与起草指令', () => {
  const roles = [roleOf('vue-engineer'), roleOf('architect')]

  it('会议指令带需求、任务、岗位职责，并明确不写代码不改任务', () => {
    const prompt = buildMeetingPrompt({
      document: DOCUMENT, proposal: 'P-01', tasks: [taskOf('T-02')], roles,
    }, roles[0] as MeetingRole)
    expect(prompt).toContain('《项目需求概要》（.spec/requirements/P-01.md）')
    expect(prompt).toContain('- T-02：T-02 的开发任务')
    expect(prompt).toContain('分级：B；规则：R-01；依赖：（无）')
    expect(prompt).toContain('负责页面与交互。')
    expect(prompt).toContain('不写代码、不改任务与需求、不签契约、不推进任务状态')
  })

  it('起草指令要求四项必填并附会议记录', () => {
    const prompt = buildContractDraftPrompt({
      document: DOCUMENT, proposal: 'P-01', tasks: [taskOf('T-02')], roles,
    }, [{ role: 'Vue 工程师', text: '先定表单与列表边界。' }])
    expect(prompt).toContain('contract_draft')
    expect(prompt).toContain('change（要改什么')
    expect(prompt).toContain('not_change')
    expect(prompt).toContain('acceptance')
    expect(prompt).toContain('fail_if')
    expect(prompt).toContain('【Vue 工程师】')
    expect(prompt).toContain('先定表单与列表边界。')
    expect(prompt).toContain('不签契约、不推进任务状态')
  })
})

/** 一次讨论测试用的世界：会话、推流、契约投影都可从外面改。 */
interface DiscussionWorld {
  clock: number
  readonly created: { readonly sessionId: string; readonly role: MeetingRole }[]
  readonly prompts: { readonly sessionId: string; readonly text: string }[]
  readonly messages: Map<string, readonly ShellMessage[]>
  readonly running: Map<string, boolean | undefined>
  readonly notices: Map<string, ShellSessionNotice | null>
  contracts: readonly ContractRow[]
  released: number
  /** 收到起草指令时写入契约；缺省为每条任务写一份完整契约。 */
  draft?: (sessionId: string, text: string) => void
}

/** 组装注入面；每次建会话立刻把它标成运行中，`sendPrompt` 默认马上给出答复。 */
function discussionWorld(overrides: Partial<DiscussionWorld> = {}): {
  world: DiscussionWorld
  ports: PlanDiscussionPorts
} {
  const world: DiscussionWorld = {
    clock: 0,
    created: [],
    prompts: [],
    messages: new Map(),
    running: new Map(),
    notices: new Map(),
    contracts: [],
    released: 0,
    ...overrides,
  }
  const answer = (sessionId: string, text: string): void => {
    world.messages.set(sessionId, [{ role: 'assistant', text }])
    world.running.set(sessionId, false)
  }
  const ports: PlanDiscussionPorts = {
    createSession: async (role) => {
      const sessionId = `s-${world.created.length + 1}`
      world.created.push({ sessionId, role })
      world.running.set(sessionId, true)
      world.messages.set(sessionId, [])
      return sessionId
    },
    sendPrompt: async (sessionId, text) => {
      world.prompts.push({ sessionId, text })
      if (text.startsWith('契约起草')) {
        world.draft?.(sessionId, text)
        answer(sessionId, '契约已起草。')
        return
      }
      answer(sessionId, '方案关注点、风险与验收建议。')
    },
    holdSession: () => () => { world.released += 1 },
    readMessages: sessionId => world.messages.get(sessionId) ?? [],
    readNotice: sessionId => world.notices.get(sessionId) ?? null,
    isRunning: sessionId => world.running.get(sessionId),
    loadContracts: async () => world.contracts,
    now: () => world.clock,
    sleep: async (ms) => {
      world.clock += ms
    },
  }
  return { world, ports }
}

/** 默认输入：两条同岗位 B 级任务。 */
function inputOf(overrides: Partial<Parameters<typeof runPlanDiscussion>[0]> = {}) {
  return {
    tasks: [taskOf('T-02'), taskOf('T-03')],
    roster: ROSTER,
    document: DOCUMENT,
    proposal: 'P-01',
    timeoutMs: 5_000,
    pollMs: 1_000,
    ...overrides,
  }
}

/** 从契约起草指令里认出任务编号，为它们写契约。 */
function writeContracts(world: DiscussionWorld, ids: readonly string[]): void {
  world.contracts = [...world.contracts.filter(row => !ids.includes(row.id)), ...ids.map(id => contractOfTask(id))]
}

describe('讨论链路', () => {
  it('B 级单岗位任务开岗位加架构师两个会话，架构师起草逐任务契约', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => { writeContracts(world, ['T-02', 'T-03']) }
    const progress: string[] = []
    const outcome = await runPlanDiscussion(inputOf(), ports, {
      onProgress: item => progress.push(`${item.stage}:${item.taskIds.join(',')}`),
    })

    expect(world.created.map(item => item.role.id)).toEqual(['vue-engineer', 'architect'])
    expect(world.prompts).toHaveLength(3)
    expect(world.prompts[0]?.text).toContain('方案讨论')
    expect(world.prompts[2]?.sessionId).toBe('s-2')
    expect(world.prompts[2]?.text).toContain('契约起草')
    expect(progress).toEqual(['meeting:T-02,T-03', 'drafting:T-02,T-03'])
    expect(world.released).toBe(2)
    expect(outcome).toMatchObject({ kind: 'done', drafts: [{ taskId: 'T-02', ok: true }, { taskId: 'T-03', ok: true }] })
  })

  it('C 级单岗位小改动只建一个会话，不建架构师', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => { writeContracts(world, ['T-02']) }
    const outcome = await runPlanDiscussion(inputOf({ tasks: [taskOf('T-02', { grade: 'C' })] }), ports)

    expect(world.created.map(item => item.role.id)).toEqual(['vue-engineer'])
    expect(world.prompts).toHaveLength(2)
    expect(world.prompts[1]?.text).toContain('契约起草')
    expect(outcome.kind).toBe('done')
  })

  it('评审岗位没有契约工具时，轻量会改由架构师起草', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => { writeContracts(world, ['T-02']) }
    const outcome = await runPlanDiscussion(inputOf({
      tasks: [taskOf('T-02', { grade: 'C', role: 'reviewer' })],
    }), ports)

    expect(world.created.map(item => item.role.id)).toEqual(['reviewer', 'architect'])
    expect(world.prompts[1]?.sessionId).toBe('s-2')
    expect(world.prompts[1]?.text).toContain('契约起草')
    expect(outcome.kind).toBe('done')
  })

  it('同岗位跨任务只建一次会话', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => { writeContracts(world, ['T-02', 'T-03', 'T-04']) }
    await runPlanDiscussion(inputOf({ tasks: [taskOf('T-02'), taskOf('T-03'), taskOf('T-04')] }), ports)
    expect(world.created).toHaveLength(2)
    expect(world.prompts.filter(item => item.text.startsWith('方案讨论'))).toHaveLength(2)
  })

  it('契约没起草出来时按失败报，任务编号原样带回', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => { writeContracts(world, ['T-02']) }
    const outcome = await runPlanDiscussion(inputOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'missing-contract', taskIds: ['T-03'] })
    expect(world.released).toBe(2)
  })

  it('契约缺必填项时按不完整报，不把半截契约当完成', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => {
      world.contracts = [contractOfTask('T-02'), contractOfTask('T-03', { failIf: [] })]
    }
    const outcome = await runPlanDiscussion(inputOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'incomplete-contract', taskIds: ['T-03'] })
  })

  it('会话失败原样带回原因，已建会话全部释放', async () => {
    const { world, ports } = discussionWorld()
    world.notices.set('s-1', { key: 'shell.turnFailed', detail: '模型不可用' })
    const outcome = await runPlanDiscussion(inputOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'meeting', reason: 'session-failed', detail: '模型不可用' })
    expect(world.released).toBe(2)
  })

  it('岗位映射不了时不建会话', async () => {
    const { world, ports } = discussionWorld()
    const outcome = await runPlanDiscussion(inputOf({ tasks: [taskOf('T-02', { role: 'ghost' })] }), ports)
    expect(world.created).toEqual([])
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'unknown-role' })
  })

  it('没有需求文档时不建会话', async () => {
    const { world, ports } = discussionWorld()
    const outcome = await runPlanDiscussion(inputOf({ document: '  ' }), ports)
    expect(world.created).toEqual([])
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'no-document' })
  })
})

describe('确认方案并进入待开发', () => {
  interface ConfirmWorld {
    readonly tasks?: readonly ShellTask[]
    readonly contracts?: readonly ContractRow[]
    readonly sign?: (taskId: string) => Promise<ShellSignResult>
    readonly advance?: (taskId: string) => Promise<ShellSignResult>
  }

  /** 确认用的端口与两个可断言的命令替身。 */
  function confirmWorld(options: ConfirmWorld = {}): {
    ports: PlanConfirmPorts
    signContract: ReturnType<typeof vi.fn>
    advanceContract: ReturnType<typeof vi.fn>
  } {
    const signContract = vi.fn(options.sign ?? (async (): Promise<ShellSignResult> => ({ ok: true, text: '已签署' })))
    const advanceContract = vi.fn(options.advance ?? (async (): Promise<ShellSignResult> => ({ ok: true, text: '已进入待开发' })))
    return {
      ports: {
        loadTasks: async () => options.tasks ?? [taskOf('T-02'), taskOf('T-03')],
        loadContracts: async () => options.contracts ?? [contractOfTask('T-02'), contractOfTask('T-03')],
        signContract,
        advanceContract,
      },
      signContract,
      advanceContract,
    }
  }

  it('逐条先签后推进，成功后计入已确认', async () => {
    const { ports, signContract, advanceContract } = confirmWorld()
    const summary = await confirmPlan(['T-02', 'T-03'], ports)
    expect(summary.confirmedCount).toBe(2)
    expect(signContract).toHaveBeenCalledTimes(2)
    expect(advanceContract).toHaveBeenCalledTimes(2)
    expect(summary.attempts.map(item => [item.taskId, item.ok, item.action])).toEqual([
      ['T-02', true, 'sign-advance'],
      ['T-03', true, 'sign-advance'],
    ])
  })

  it('已人签的契约跳过签署，只推进', async () => {
    const { ports, signContract, advanceContract } = confirmWorld({
      contracts: [
        contractOfTask('T-02', { signedBy: 'human', signedAt: '10:00' }),
        contractOfTask('T-03', { signedBy: 'human', signedAt: '10:00' }),
      ],
    })
    const summary = await confirmPlan(['T-02'], ports)
    expect(signContract).not.toHaveBeenCalled()
    expect(advanceContract).toHaveBeenCalledWith('T-02')
    expect(summary.attempts[0]?.action).toBe('advance')
  })

  it('签署失败不推进，失败逐条记下，其余任务继续', async () => {
    const { ports, advanceContract } = confirmWorld({
      sign: async taskId => taskId === 'T-02'
        ? { ok: false, text: '签名被拒' }
        : { ok: true, text: '已签署' },
    })
    const summary = await confirmPlan(['T-02', 'T-03'], ports)
    expect(advanceContract).toHaveBeenCalledTimes(1)
    expect(advanceContract).toHaveBeenCalledWith('T-03')
    expect(summary.confirmedCount).toBe(1)
    expect(summary.attempts[0]).toMatchObject({ taskId: 'T-02', ok: false, reason: 'sign-failed', detail: '签名被拒' })
  })

  it('缺契约不签也不推；已不在起草态的跳过', async () => {
    const { ports, signContract } = confirmWorld({
      tasks: [taskOf('T-02'), taskOf('T-03', { state: 'contracted' })],
      contracts: [contractOfTask('T-02')],
    })
    const summary = await confirmPlan(['T-02', 'T-03'], ports)
    expect(signContract).toHaveBeenCalledTimes(1)
    expect(summary.attempts[1]).toMatchObject({ taskId: 'T-03', ok: true, action: 'skip' })
    expect(summary.confirmedCount).toBe(2)
  })

  it('推进失败按 advance-failed 记下原文', async () => {
    const { ports } = confirmWorld({
      advance: async () => ({ ok: false, text: '状态机拒绝' }),
    })
    const summary = await confirmPlan(['T-02'], ports)
    expect(summary.confirmedCount).toBe(0)
    expect(summary.attempts[0]).toMatchObject({ ok: false, reason: 'advance-failed', detail: '状态机拒绝' })
  })
})
