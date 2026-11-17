/**
 * 需求工具：把一条需求落成 `.spec/requirements/REQ-xx.yaml` 与同名正文，
 * 并负责需求分析师改稿、项目经理出评审报告这两条模型写入口。
 *
 * 三条刻意的限制：
 *   1. **只写 `draft`。** 批准、发布与关闭都是人机命令，模型能起草需求、能比较候选、
 *      能改稿、能出评审报告，不能替人拍板——与 `proposal_draft` 和 `/proposal_approve` 的分工同构。
 *   2. **正文与元数据一起落。** 先写正文与快照再写 YAML，任一步失败回滚，磁盘上不留半截需求。
 *   3. **评审只出报告。** `requirement_review_draft` 不改状态与正文；改稿由
 *      `requirement_revise` 单独做，两条工具分别只对项目经理与需求分析师可见。
 *
 * 输出统一用 `{ type: 'json' }` + JSON 渲染，理由见 docs/cookbook/adding-a-tool.md。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import type { RequirementOption, RequirementSplitPlanEntry, Task } from '../schema/spec.js'
import {
  assertRequirementId,
  createRequirement,
  loadRequirement,
  readRequirementDocument,
  recordRequirementReview,
  requirementDocPath,
  requirementPath,
  requirementSplitPlanPath,
  reviseRequirement,
  saveSplitPlan,
} from '../kernel/requirement-store.js'
import { resolveRole, rolesPath } from '../kernel/role-store.js'
import { resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'
import { listTasks } from '../kernel/task-store.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

/** 落盘后给模型的下一步口径：正文讲给用户，状态推进等人。 */
const PENDING_NOTE = '需求已落盘，状态 draft。把正文讲给用户；确认、发布、关闭都由人机命令完成，本工具不提供。'

/** 工具参数里的一条候选：三个字段都由模型直接给对象，逐项校验后落盘。 */
interface RequirementOptionArg {
  readonly name?: string
  readonly summary?: string
  readonly cost?: string
}

/**
 * 校验并归一候选做法。
 * @param raw - 模型给的候选数组；省略或空数组表示这次没有候选。
 * @returns 名字与做法非空、代价空白即省略的候选。
 */
function optionsOf(raw: readonly RequirementOptionArg[] | undefined): RequirementOption[] {
  return (raw ?? []).map((option, index) => {
    const name = (option.name ?? '').trim()
    const summary = (option.summary ?? '').trim()
    const cost = (option.cost ?? '').trim()
    if (name === '' || summary === '') {
      throw new Error(`第 ${String(index + 1)} 条候选缺字段：name 与 summary 都要写，方案才有比较价值`)
    }
    return {
      name,
      summary,
      ...(cost === '' ? {} : { cost }),
    }
  })
}

/** 工具参数里的一条岗位建议：任务编号、岗位 id 与可选理由。 */
interface SplitPlanEntryArg {
  readonly task?: string
  readonly role?: string
  readonly reason?: string
}

/**
 * 校验一条拆分计划：任务必须属于该需求且仍在起草态，岗位必须能解析。
 *
 * 计划只是建议——这里不建任务、不写 `Task.role`、不改状态；
 * 分配仍由人机命令 `/task_assign` 写。
 * @param raw - 模型给的建议数组。
 * @param root - 规格根，用于解析岗位名册。
 * @param requirementId - 本次拆分对应的需求编号。
 * @param tasks - 当前全部任务。
 * @returns 归一后的建议条目。
 */
function splitPlanEntriesOf(
  raw: readonly SplitPlanEntryArg[] | undefined,
  root: string,
  requirementId: string,
  tasks: readonly Task[],
): RequirementSplitPlanEntry[] {
  if (raw === undefined || raw.length === 0) {
    throw new Error('requirement_split_plan 需要非空的 tasks：逐条给任务编号与建议岗位')
  }
  const seen = new Set<string>()
  return raw.map((entry, index) => {
    const where = `第 ${String(index + 1)} 条建议`
    const taskId = (entry.task ?? '').trim()
    const role = (entry.role ?? '').trim()
    const reason = (entry.reason ?? '').trim()
    if (taskId === '' || role === '') {
      throw new Error(`${where}缺字段：task 与 role 都要写`)
    }
    if (seen.has(taskId)) {
      throw new Error(`${where}重复写了任务 ${taskId}；一条任务只能有一条岗位建议`)
    }
    seen.add(taskId)

    const task = tasks.find(item => item.id === taskId)
    if (task === undefined) {
      throw new Error(`${where}的任务 ${taskId} 不存在；先用 task_draft 建任务`)
    }
    if (task.requirement !== requirementId) {
      throw new Error(
        `${where}的任务 ${taskId} 没有回指需求 ${requirementId}（现在回指 ${task.requirement ?? '无'}）；拆分计划只收本需求拆出的任务`,
      )
    }
    if (task.state !== 'drafting') {
      throw new Error(`${where}的任务 ${taskId} 现在在「${task.state}」，只有起草态任务能写入岗位建议`)
    }

    let known: boolean
    try {
      known = resolveRole(root, role) !== undefined
    } catch (error: unknown) {
      throw new Error(`读 ${rolesPath(root)} 失败：${errorMessage(error)}`)
    }
    if (!known) {
      throw new Error(`${where}的岗位 ${role} 不认识：.spec/roles.yaml 里没有，也不是内置角色`)
    }

    return { task: taskId, role, ...(reason === '' ? {} : { reason }) }
  })
}

/**
 * 建需求工具：起草、评审、改稿与拆分岗位建议四条模型写入口；可见性由角色天花板收窄。
 * @param rootInput - 规格根解析（按会话工作区）。
 * @returns `requirement_draft`、`requirement_review_draft`、`requirement_revise` 与 `requirement_split_plan` 工具定义。
 */
export function createRequirementTools(rootInput: RootInput): ToolDefinition[] {
  return [
    defineTool({
      name: 'requirement_draft',
      description:
        '把一条需求登记成 `.spec/requirements/REQ-<编号>.yaml`，正文写到同名 `.md`。标题与完整 Markdown 正文必填；可附候选做法（options，每项 name 与 summary 必填、cost 可选）与推荐（recommendation）。编号自动取现有 REQ- 编号之后的下一个空号，不覆盖已有文件。状态固定写 draft——确认、发布与关闭是人的动作，本工具不提供。',
      parameters: {
        title: { type: 'string', required: true, description: '一句话说清这条需求要解决什么' },
        content: { type: 'string', required: true, description: '完整的需求正文，Markdown；去空白后必须非空' },
        options: {
          type: 'array',
          description: '候选做法，可选；每项要有 name 与 summary，cost 可省',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', required: true, description: '候选的名字' },
              summary: { type: 'string', required: true, description: '这条候选怎么做' },
              cost: { type: 'string', description: '这条候选的代价' },
            },
          },
        },
        recommendation: { type: 'string', description: '推荐哪一条以及为什么，要能对着 options 读' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        const title = args.title.trim()
        if (title === '') throw new Error('requirement_draft 需要非空的 title：一句话说清这条需求要解决什么')

        const content = args.content
        if (content.trim() === '') throw new Error('requirement_draft 需要非空的 content：正文去空白后不能为空')

        const recommendation = args.recommendation?.trim()
        if (recommendation === '') throw new Error('requirement_draft 的 recommendation 不能是空白；没有推荐就省略这个字段')

        const draft = createRequirement(root, {
          title,
          content,
          options: optionsOf(args.options),
          ...(recommendation === undefined ? {} : { recommendation }),
          opened_at: new Date().toISOString(),
        })

        return {
          requirement_id: draft.requirement.id,
          path: draft.yamlPath,
          document_path: draft.documentPath,
          characters: draft.characters,
          state: draft.requirement.state,
          version: 1,
          note: PENDING_NOTE,
        }
      },
    }),
    defineTool({
      name: 'requirement_review_draft',
      description:
        '给一条起草态需求追加一轮评审，报告写到 `.spec/requirements/<编号>/reviews/R<轮次>.md`，并把轮次记进 YAML。参数 id 是需求编号，report 是完整 Markdown 评审报告；要求需求 state 为 draft 且正文已存在。本工具只追加评审，不改需求状态与正文——改稿由需求分析师用 requirement_revise 做，过审由人完成。',
      parameters: {
        id: { type: 'string', required: true, description: '需求编号，如 REQ-01' },
        report: { type: 'string', required: true, description: '完整的评审报告，Markdown；去空白后必须非空' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        const id = assertRequirementId(args.id.trim())
        if (args.report.trim() === '') {
          throw new Error('requirement_review_draft 需要非空的 report：评审报告不能为空')
        }

        let requirement
        try {
          requirement = loadRequirement(root, id)
        } catch (error: unknown) {
          throw new Error(`读不到需求 ${id}（${requirementPath(root, id)}）：${errorMessage(error)}`)
        }
        if (requirement.state !== 'draft') {
          throw new Error(`${id} 现在在「${requirement.state}」，只有起草态需求能评审`)
        }
        if (readRequirementDocument(root, id) === undefined) {
          throw new Error(`${id} 还没有正文（${requirementDocPath(root, id)} 不存在或为空）；先补正文再评审`)
        }

        const sessionId = exec.agent?.session.header.id
        const review = recordRequirementReview(root, id, {
          report: args.report,
          at: new Date().toISOString(),
          ...(sessionId === undefined ? {} : { sessionId }),
        })

        return {
          requirement_id: id,
          round: review.round,
          report_path: review.relativeReport,
          state: review.requirement.state,
          note: '评审报告已落盘，只追加评审记录；本工具不改需求状态与正文，改稿与过审都不由本工具完成。',
        }
      },
    }),
    defineTool({
      name: 'requirement_revise',
      description:
        '改写一条起草态需求的正文，并把新正文记成下一个版本；版本快照写在 `.spec/requirements/<编号>/versions/v<版本号>.md`。参数 id 是需求编号，content 是新的完整 Markdown 正文；要求需求 state 为 draft 且正文已存在。旧需求还没有版本表时先补录 v1，再写新版本。本工具不改需求状态，过审由人完成。',
      parameters: {
        id: { type: 'string', required: true, description: '需求编号，如 REQ-01' },
        content: { type: 'string', required: true, description: '新的完整需求正文，Markdown；去空白后必须非空' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        const id = assertRequirementId(args.id.trim())
        if (args.content.trim() === '') {
          throw new Error('requirement_revise 需要非空的 content：新正文去空白后不能为空')
        }

        let requirement
        try {
          requirement = loadRequirement(root, id)
        } catch (error: unknown) {
          throw new Error(`读不到需求 ${id}（${requirementPath(root, id)}）：${errorMessage(error)}`)
        }
        if (requirement.state !== 'draft') {
          throw new Error(`${id} 现在在「${requirement.state}」，只有起草态需求能改稿`)
        }

        const revision = reviseRequirement(root, id, {
          content: args.content,
          at: new Date().toISOString(),
        })

        return {
          requirement_id: id,
          version: revision.version,
          path: revision.documentPath,
          snapshot_path: revision.snapshotPath,
          backfilled: revision.backfilled,
          characters: args.content.trim().length,
          state: revision.requirement.state,
          note: '新正文已落盘并记为新的版本；本工具不改需求状态，过审仍由人机命令完成。',
        }
      },
    }),
    defineTool({
      name: 'requirement_split_plan',
      description:
        '把一次拆分给出的逐条岗位建议写成 `.spec/requirements/<编号>/split-plan.yaml`，覆盖上一份计划。参数 id 是需求编号，tasks 是建议数组，每项含 task（本需求拆出的任务编号）、role（岗位 id 或内置角色 id）与可选 reason。要求需求 state 为 confirmed，每个任务存在、回指该需求且 state 为 drafting，每个 role 能从 `.spec/roles.yaml` 或内置角色解析。本工具只写建议文件：不创建任务、不分配岗位、不改任务状态；分配由人逐条确认后经 `/task_assign` 写入。',
      parameters: {
        id: { type: 'string', required: true, description: '需求编号，如 REQ-01' },
        tasks: {
          type: 'array',
          required: true,
          description: '逐条岗位建议；至少一条，每条要有 task 与 role，reason 可省',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              task: { type: 'string', required: true, description: '本需求拆出的任务编号，如 T-01' },
              role: { type: 'string', required: true, description: '建议岗位：.spec/roles.yaml 的岗位 id，或内置角色 id' },
              reason: { type: 'string', description: '一句技术理由，说明为什么这条任务归这个岗位' },
            },
          },
        },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        const id = assertRequirementId(args.id.trim())

        let requirement
        try {
          requirement = loadRequirement(root, id)
        } catch (error: unknown) {
          throw new Error(`读不到需求 ${id}（${requirementPath(root, id)}）：${errorMessage(error)}`)
        }
        if (requirement.state !== 'confirmed') {
          throw new Error(`${id} 现在在「${requirement.state}」，拆分岗位建议只能写给已过审（confirmed）的需求`)
        }

        let tasks
        try {
          tasks = listTasks(root)
        } catch (error: unknown) {
          throw new Error(`读 .spec/tasks 失败：${errorMessage(error)}`)
        }
        const entries = splitPlanEntriesOf(args.tasks, root, id, tasks)
        const at = new Date().toISOString()
        saveSplitPlan(root, { requirement: id, at, tasks: entries })

        return {
          requirement_id: id,
          path: requirementSplitPlanPath(root, id),
          at,
          tasks: entries.map(entry => ({ task: entry.task, role: entry.role, reason: entry.reason ?? null })),
          note: '岗位建议已落盘。本工具不创建任务、不分配岗位、不改任务状态；请在界面上逐条确认，分配经 /task_assign 由人执行。',
        }
      },
    }),
  ]
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
