/**
 * 方案讨论与契约门禁：固定三方加按轨技术岗位、会议分组、看板列派生、
 * 契约完整性、讨论与起草链路，以及确认后的逐条签署推进。
 *
 * 流程不碰 React；这里用注入端口模拟宿主推流、契约投影与两条人机命令。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ContractRow } from '../src/client/projection.ts'
import type { ShellMessage, ShellSignResult, ShellTask } from '../src/client/shell/shell-data.ts'
import type { ShellSessionNotice } from '../src/client/model-status.ts'
import type { TrackDescriptor } from '@lcoder/kernel/src/schema/tracks.ts'
import {
  ARCHITECT_ROLE, boardColumnOf, buildContractDraftPrompt, buildMeetingPrompt, confirmPlan,
  contractComplete, contractOf, contractSigned, discussionNeeded, discussionTasksOf, meetingTierOf,
  MEETING_ROLE_MARKER, planDiscussionGroups, runPlanDiscussion, technicalRoleOf,
} from '../src/client/shell/plan-discussion.ts'
import type {
  MeetingRole, PlanConfirmPorts, PlanDiscussionPorts,
} from '../src/client/shell/plan-discussion.ts'

const DOCUMENT = '# 项目需求概要 V1\n\n## 第一版功能清单\n- 记一笔\n- 翻记录\n'

const TRACKS: readonly TrackDescriptor[] = [
  { id: 'h5', name: 'H5 前端' },
  { id: 'admin', name: '管理端' },
  { id: 'api', name: '接口' },
  { id: 'desktop', name: '桌面端' },
  { id: 'host', name: '宿主端' },
  { id: 'general', name: '通用' },
  { id: 'payment', name: '支付端' },
]

/** 一条拆分任务；默认 B 级、标 H5 轨、没有岗位。 */
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
    track: 'h5',
    openedAt: '2026-11-12T09:00:02.084Z',
    ...overrides,
  }
}

/** 需求本体：drafting、带方案回指、没有轨也没有岗位。 */
function requirementOf(id: string, overrides: Partial<ShellTask> = {}): ShellTask {
  const { track: _track, role: _role, ...rest } = taskOf(id, overrides)
  void _track
  void _role
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

describe('会议规模与按轨角色', () => {
  it('A 级、有不可逆项、基础框架与 general 轨开完整会', () => {
    expect(meetingTierOf(taskOf('T-02', { grade: 'A' }))).toBe('full')
    expect(meetingTierOf(taskOf('T-02', { irreversible: ['删库'] }))).toBe('full')
    expect(meetingTierOf(taskOf('T-02', { title: '项目基础框架与脚手架' }))).toBe('full')
    expect(meetingTierOf(taskOf('T-02', { track: 'general' }), technicalRoleOf('general', TRACKS))).toBe('full')
  })

  it('涉及三个以上不同轨时整批开完整会', () => {
    expect(meetingTierOf(taskOf('T-02'), undefined, 3)).toBe('full')
  })

  it('B 级按配对会，C 级且无不可逆项按轻量会', () => {
    expect(meetingTierOf(taskOf('T-02'))).toBe('paired')
    expect(meetingTierOf(taskOf('T-02', { grade: 'C' }))).toBe('solo')
    expect(meetingTierOf(taskOf('T-02', { grade: 'C', irreversible: ['部署'] }))).toBe('full')
  })

  it('技术岗位按轨映射：内置轨走 dev 面，general 走架构师，项目轨用项目名', () => {
    expect(technicalRoleOf('h5', TRACKS)).toMatchObject({
      id: 'track-h5', name: 'H5 前端工程师', kind: 'track', inherits: 'dev', preset: 'lcoder',
    })
    expect(technicalRoleOf('api', TRACKS)).toMatchObject({ id: 'track-api', name: '接口工程师' })
    expect(technicalRoleOf('general', TRACKS)).toEqual(ARCHITECT_ROLE)
    expect(technicalRoleOf('payment', TRACKS)).toMatchObject({
      id: 'track-payment', name: '支付端工程师', inherits: 'dev',
    })
    expect(technicalRoleOf(undefined, TRACKS)).toEqual(ARCHITECT_ROLE)
    expect(technicalRoleOf('ghost', TRACKS)).toBeUndefined()
  })
})

describe('讨论分组', () => {
  it('同轨只建一次会：两条 H5 任务共用一个会，三方与技术岗、架构师都在场', () => {
    const plan = planDiscussionGroups([taskOf('T-02'), taskOf('T-03')], TRACKS)
    expect(plan.unresolved).toEqual([])
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]).toMatchObject({ tier: 'paired', taskIds: ['T-02', 'T-03'], tracks: ['h5'] })
    expect(plan.groups[0]?.roles.map(role => role.id))
      .toEqual(['analyst', 'pm', 'manager', 'track-h5', 'architect'])
  })

  it('C 级轻量会也固定三方入会，不因任务小就少人', () => {
    const plan = planDiscussionGroups([taskOf('T-02', { grade: 'C' })], TRACKS)
    expect(plan.groups[0]).toMatchObject({ tier: 'solo', taskIds: ['T-02'] })
    expect(plan.groups[0]?.roles.map(role => role.id))
      .toEqual(['analyst', 'pm', 'manager', 'track-h5', 'architect'])
  })

  it('三条不同轨的任务整批进完整会，技术岗取并集', () => {
    const plan = planDiscussionGroups([
      taskOf('T-02'),
      taskOf('T-03', { track: 'api' }),
      taskOf('T-04', { track: 'payment' }),
    ], TRACKS)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]?.tier).toBe('full')
    expect(plan.groups[0]?.roles.map(role => role.id))
      .toEqual(['analyst', 'pm', 'manager', 'track-h5', 'track-api', 'track-payment', 'architect'])
    expect(plan.groups[0]?.tracks).toEqual(['h5', 'api', 'payment'])
  })

  it('旧数据没有轨时按 general 处理，不从 task.role 推导参与者', () => {
    const { track: _track, ...legacy } = taskOf('T-02', { role: 'vue-engineer' })
    void _track
    const plan = planDiscussionGroups([legacy], TRACKS)
    expect(plan.groups[0]?.roles.map(role => role.id)).toEqual(['analyst', 'pm', 'manager', 'architect'])
  })

  it('未知轨如实记进 unresolved，不猜一个岗位顶上', () => {
    const plan = planDiscussionGroups([taskOf('T-02', { track: 'ghost' })], TRACKS)
    expect(plan.groups).toEqual([])
    expect(plan.unresolved).toEqual([{ taskId: 'T-02', track: 'ghost' }])
  })
})

describe('看板列与契约判据', () => {
  it('有轨或旧数据有岗位的 drafting 任务进方案讨论，需求本体留在需求确认', () => {
    const { track: _track, ...legacyRole } = taskOf('T-02', { role: 'architect' })
    void _track
    expect(boardColumnOf(taskOf('T-02'))).toBe('discussion')
    expect(boardColumnOf(legacyRole)).toBe('discussion')
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

  it('同需求下仍待讨论的任务按方案取，需求本体与已推进任务不进这批', () => {
    const tasks = [
      requirementOf('T-01'),
      taskOf('T-02'),
      taskOf('T-03', { state: 'contracted' }),
      taskOf('T-04', { proposal: 'P-02' }),
    ]
    expect(discussionTasksOf(tasks, taskOf('T-02')).map(row => row.id)).toEqual(['T-02'])
    expect(discussionTasksOf(tasks, requirementOf('T-01')).map(row => row.id)).toEqual(['T-02'])
  })
})

describe('讨论与起草指令', () => {
  const plan = planDiscussionGroups([taskOf('T-02')], TRACKS)
  const roles = plan.groups[0]?.roles ?? []

  it('会议指令带身份标记、需求、任务与轨', () => {
    const analyst = roles.find(role => role.kind === 'analyst') as MeetingRole
    const prompt = buildMeetingPrompt({
      document: DOCUMENT, proposal: 'P-01', tasks: [taskOf('T-02')], roles, tracks: TRACKS,
    }, analyst)
    expect(prompt).toContain(`${MEETING_ROLE_MARKER}需求分析师（analyst）`)
    expect(prompt).toContain('《项目需求概要》（.spec/requirements/P-01.md）')
    expect(prompt).toContain('- T-02：T-02 的开发任务')
    expect(prompt).toContain('轨：H5 前端；分级：B；规则：R-01')
    expect(prompt).toContain('不写代码、不改任务与需求、不签契约、不推进任务状态')
  })

  it('三方各有固定职责：分析师核覆盖、项目经理讲拆分、研发经理评风险', () => {
    const context = { document: DOCUMENT, proposal: 'P-01', tasks: [taskOf('T-02')], roles, tracks: TRACKS }
    const analyst = roles.find(role => role.kind === 'analyst') as MeetingRole
    const pm = roles.find(role => role.kind === 'pm') as MeetingRole
    const manager = roles.find(role => role.kind === 'manager') as MeetingRole
    expect(buildMeetingPrompt(context, analyst)).toContain('核对需求覆盖')
    expect(buildMeetingPrompt(context, analyst)).toContain('不写任务、不给技术实现')
    expect(buildMeetingPrompt(context, pm)).toContain('说明拆分依据')
    expect(buildMeetingPrompt(context, pm)).toContain('说明轨划分的理由')
    expect(buildMeetingPrompt(context, manager)).toContain('跨轨依赖与落地风险')
    expect(buildMeetingPrompt(context, manager)).toContain('不落盘、不调用分配命令')
  })

  it('技术岗只谈自己那条轨，架构师负责汇总与契约要点', () => {
    const context = { document: DOCUMENT, proposal: 'P-01', tasks: [taskOf('T-02')], roles, tracks: TRACKS }
    const tech = roles.find(role => role.id === 'track-h5') as MeetingRole
    expect(buildMeetingPrompt(context, tech)).toContain('你代表「H5 前端工程师」这条轨')
    expect(buildMeetingPrompt(context, ARCHITECT_ROLE)).toContain('汇总三方与技术岗位的意见')
  })

  it('起草指令要求四项必填并附会议记录', () => {
    const prompt = buildContractDraftPrompt({
      document: DOCUMENT, proposal: 'P-01', tasks: [taskOf('T-02')], roles, tracks: TRACKS,
    }, [{ role: 'H5 前端工程师', text: '先定表单与列表边界。' }])
    expect(prompt).toContain('contract_draft')
    expect(prompt).toContain('change（要改什么')
    expect(prompt).toContain('not_change')
    expect(prompt).toContain('acceptance')
    expect(prompt).toContain('fail_if')
    expect(prompt).toContain('【H5 前端工程师】')
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

/** 默认输入：两条同轨 B 级任务。 */
function inputOf(overrides: Partial<Parameters<typeof runPlanDiscussion>[0]> = {}) {
  return {
    tasks: [taskOf('T-02'), taskOf('T-03')],
    tracks: TRACKS,
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
  it('B 级同轨任务：三方加技术岗加架构师各一次会话，架构师逐任务起草契约', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => { writeContracts(world, ['T-02', 'T-03']) }
    const progress: string[] = []
    const outcome = await runPlanDiscussion(inputOf(), ports, {
      onProgress: item => progress.push(`${item.stage}:${item.taskIds.join(',')}`),
    })

    expect(world.created.map(item => item.role.id))
      .toEqual(['analyst', 'pm', 'manager', 'track-h5', 'architect'])
    expect(world.prompts).toHaveLength(6)
    expect(world.prompts.filter(item => item.text.startsWith('方案讨论'))).toHaveLength(5)
    expect(world.prompts[5]?.sessionId).toBe('s-5')
    expect(world.prompts[5]?.text).toContain('契约起草')
    expect(progress).toEqual(['meeting:T-02,T-03', 'drafting:T-02,T-03'])
    expect(world.released).toBe(5)
    expect(outcome).toMatchObject({ kind: 'done', drafts: [{ taskId: 'T-02', ok: true }, { taskId: 'T-03', ok: true }] })
  })

  it('C 级轻量会同样固定三方入会', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => { writeContracts(world, ['T-02']) }
    const outcome = await runPlanDiscussion(inputOf({ tasks: [taskOf('T-02', { grade: 'C' })] }), ports)

    expect(world.created.map(item => item.role.id))
      .toEqual(['analyst', 'pm', 'manager', 'track-h5', 'architect'])
    expect(world.prompts).toHaveLength(6)
    expect(outcome.kind).toBe('done')
  })

  it('同角色跨组只建一次会话：两条不同轨的配对会复用同一位架构师', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => { writeContracts(world, ['T-02', 'T-03']) }
    await runPlanDiscussion(inputOf({
      tasks: [taskOf('T-02'), taskOf('T-03', { track: 'api' })],
    }), ports)
    expect(world.created).toHaveLength(6)
    expect(world.created.filter(item => item.role.id === 'architect')).toHaveLength(1)
    expect(world.created.map(item => item.role.id).sort())
      .toEqual(['analyst', 'architect', 'manager', 'pm', 'track-api', 'track-h5'])
  })

  it('契约没起草出来时按失败报，任务编号原样带回', async () => {
    const { world, ports } = discussionWorld()
    world.draft = () => { writeContracts(world, ['T-02']) }
    const outcome = await runPlanDiscussion(inputOf(), ports)
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'missing-contract', taskIds: ['T-03'] })
    expect(world.released).toBe(5)
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
    expect(world.released).toBe(5)
  })

  it('轨映射不了时不建会话，并带回未知轨', async () => {
    const { world, ports } = discussionWorld()
    const outcome = await runPlanDiscussion(inputOf({ tasks: [taskOf('T-02', { track: 'ghost' })] }), ports)
    expect(world.created).toEqual([])
    expect(outcome).toMatchObject({
      kind: 'failed',
      reason: 'unknown-role',
      unresolved: [{ taskId: 'T-02', track: 'ghost' }],
    })
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
