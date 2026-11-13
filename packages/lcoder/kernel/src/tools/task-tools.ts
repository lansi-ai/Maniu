/**
 * 任务侧工具：读任务、立项、申请收口。
 *
 * `task_close` 是"凭什么算做完"的落点：它把 P1/P3/P4 三条检查器串起来，
 * **全部通过才允许转移状态**。不通过就把违规清单原样交出来，一条也不吞。
 *
 * 状态图本身也会拦：`implementing` 不能直接到 `closed`，必须先过 `verifying`。
 *
 * `task_draft` 是模型唯一的立项入口：它只新建 `drafting` 任务，状态、时间戳
 * 由代码写定——模型说不出「已经签过」，也说不出「什么时候开的」。
 */
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { checkP1, checkP3, checkP4 } from '../checkers/index.js'
import type { Violation } from '../checkers/index.js'
import { loadAutomationPolicy } from '../kernel/automation.js'
import { loadContractFact } from '../kernel/contract.js'
import { loadEvidence } from '../kernel/evidence-store.js'
import { hasProject, loadProject } from '../kernel/project-store.js'
import { assertProposalId, listProposals } from '../kernel/proposal-store.js'
import { assertRequirementId, listRequirementIds } from '../kernel/requirement-store.js'
import { loadSpec, textCodeIndexFromDir } from '../kernel/spec-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'
import { assertTaskId, dependencyCycle, findByTitle, listTasks, loadTask, nextTaskId, openTask, saveTask, taskPath, transition, unknownDependencies } from '../kernel/task-store.js'
import { BUILTIN_TRACKS } from '../schema/tracks.js'
import type { TrackDescriptor } from '../schema/tracks.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

/**
 * 当前规格库可用的轨：内置六轨在前，项目追加轨在后。
 * @param specRoot - 规格根。
 * @returns 可供任务标注的轨；项目文件缺失时只有内置轨。
 */
export function availableTracks(specRoot: string): TrackDescriptor[] {
  const project = hasProject(specRoot) ? loadProject(specRoot) : null
  return [
    ...BUILTIN_TRACKS.map(track => ({ id: track.id, name: track.name })),
    ...(project?.tracks ?? []),
  ]
}

/**
 * 校验 `task_draft` 给出的轨。
 *
 * 填了就必须是内置轨或项目追加轨——任务标一条不存在的轨，看板与讨论分组都找不到
 * 对应的技术岗位；错误信息直接列出可用轨，让模型一次改对。
 * @param specRoot - 规格根。
 * @param raw - 模型给的 track，可能缺省或空白。
 * @returns 校验过的轨 id；缺省时 undefined。
 */
function taskDraftTrack(specRoot: string, raw: string | undefined): string | undefined {
  const text = raw?.trim()
  if (text === undefined || text === '') return undefined
  const tracks = availableTracks(specRoot)
  if (!tracks.some(track => track.id === text)) {
    throw new Error(`track 里的轨不存在：${text}；可用轨：${tracks.map(track => `${track.id}（${track.name}）`).join('、')}`)
  }
  return text
}

/**
 * 校验 task_draft 给出的方案编号。
 *
 * 填了就必须在规格里查得到——拆出来的任务回指一个不存在的方案，看板上就是一条断链，
 * 与其在读侧显示「未知方案」，不如在写盘前响一次。
 * @param specRoot - 规格根。
 * @param raw - 模型给的 proposal，可能缺省或空白。
 * @returns 校验过的编号；缺省时 undefined。
 */
function taskDraftProposal(specRoot: string, raw: string | undefined): string | undefined {
  const text = raw?.trim()
  if (text === undefined || text === '') return undefined
  assertProposalId(text)
  const known = listProposals(specRoot).map(proposal => proposal.id)
  if (!known.includes(text)) {
    throw new Error(`proposal 里的方案不存在：${text}；${known.length === 0 ? '这个规格里还没有方案，可省略该字段，或先用 proposal_draft 出方案' : `已有方案 ${known.join(', ')}`}`)
  }
  return text
}

/**
 * 校验 task_draft 给出的需求编号。
 *
 * 与方案编号同一口径：填了就必须在 `.spec/requirements/` 里查得到，否则看板上就是断链。
 * @param specRoot - 规格根。
 * @param raw - 模型给的 requirement，可能缺省或空白。
 * @returns 校验过的编号；缺省时 undefined。
 */
function taskDraftRequirement(specRoot: string, raw: string | undefined): string | undefined {
  const text = raw?.trim()
  if (text === undefined || text === '') return undefined
  assertRequirementId(text)
  const known = listRequirementIds(specRoot)
  if (!known.includes(text)) {
    throw new Error(`requirement 里的需求不存在：${text}；${known.length === 0 ? '这个规格里还没有需求，可省略该字段，或先用 requirement_draft 起草' : `已有需求 ${known.join(', ')}`}`)
  }
  return text
}

/**
 * 附件路径写盘前复核：解析后的目标必须仍在规格根内。
 *
 * schema 已拒绝绝对路径与 `..`；这里按实际解析结果再查一次，
 * 让「写进 YAML 的路径」与「磁盘上的落点」用同一套判定。
 * @param specRoot - 规格根。
 * @param attachments - 已通过 schema 的附件路径。
 */
function assertAttachmentsInsideSpec(specRoot: string, attachments: readonly string[]): void {
  for (const attachment of attachments) {
    const target = relative(specRoot, resolve(specRoot, attachment))
    if (target === '' || target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target)) {
      throw new Error(`附件路径不能跳出 .spec 根目录：${attachment}`)
    }
  }
}

export function createTaskTools(specRootInput: RootInput): ToolDefinition[] {
  return [
    defineTool({
      name: 'task_read',
      description: '读取任务对象。不传 task_id 时返回全部任务摘要。',
      parameters: {
        task_id: { type: 'string', description: '任务编号，如 T-01' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const specRoot = resolveRoot(specRootInput, exec)
        // 没有 `.spec` 是起点，不是故障：读盘会抛 ENOENT，这里先挡掉。
        if (!hasSpecRoot(specRoot)) {
          if (args.task_id) throw new Error(`这个仓库还没有 .spec 规格库，读不到任务 ${args.task_id}；先用 task_draft 立项`)
          return { tasks: [], note: '这个仓库还没有 .spec 规格库；用 task_draft 把调研结论落成起草态任务。' }
        }
        if (args.task_id) {
          const t = loadTask(specRoot, args.task_id)
          return {
            id: t.id,
            title: t.title,
            description: t.description,
            ...(t.category === undefined ? {} : { category: t.category }),
            ...(t.change_type === undefined ? {} : { change_type: t.change_type }),
            attachments: t.attachments,
            grade: t.grade,
            state: t.state,
            rules: t.rules,
            scope: t.scope,
            evidence_required: t.evidence_required,
            ...(t.role === undefined ? {} : { role: t.role }),
            ...(t.track === undefined ? {} : { track: t.track }),
            ...(t.proposal === undefined ? {} : { proposal: t.proposal }),
            ...(t.requirement === undefined ? {} : { requirement: t.requirement }),
          }
        }
        return {
          tasks: listTasks(specRoot).map(t => ({
            id: t.id,
            title: t.title,
            state: t.state,
            grade: t.grade,
            ...(t.track === undefined ? {} : { track: t.track }),
            ...(t.proposal === undefined ? {} : { proposal: t.proposal }),
            ...(t.requirement === undefined ? {} : { requirement: t.requirement }),
          })),
        }
      },
    }),

    defineTool({
      name: 'task_draft',
      description:
        '新建一个起草态（drafting）任务，把调研结论落成 .spec/tasks/<编号>.yaml。任务可标一条归属轨（内置轨或项目追加轨），方案讨论按轨邀请技术岗位；可回指一条需求（requirement）或旧流程的方案（proposal），两者可以并存。状态由本工具写死为 drafting，时间戳取执行时刻：本工具不能改任务状态、不能签契约、不能改代码。同标题已存在任务时返回那个任务，不重复建。',
      parameters: {
        title: { type: 'string', required: true, description: '任务标题，一句话说清要办成什么' },
        description: { type: 'string', description: '需求描述：具体要做什么、为什么，允许换行，最多 4000 个字符' },
        category: { type: 'string', description: '领域分类：page（页面）、api（接口）、data（数据）、other（其他）' },
        change_type: { type: 'string', description: '变更类型：bug（缺陷）、feature（新功能）、improvement（改进）、style（样式）' },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: '图片附件，相对 .spec 根目录，如 attachments/T-01/shot.png；只允许 png、jpg、jpeg、webp、gif，最多 8 张',
        },
        grade: { type: 'string', required: true, description: '分级：A（契约/架构/规则变更）、B（常规功能）、C（小修）' },
        rules: { type: 'array', items: { type: 'string' }, description: '触及的规格条目编号，必须已存在于 spec/rules.yaml' },
        allowed_paths: { type: 'array', items: { type: 'string' }, description: '允许改动的仓库内路径前缀' },
        irreversible: { type: 'array', items: { type: 'string' }, description: '不可逆对象名；填了就必须有人签署的契约才能收口（P3）' },
        evidence_required: { type: 'array', items: { type: 'string' }, description: '收口必备的证据项，对应 env.yaml 里登记的命令 id' },
        proposal: { type: 'string', description: '这条任务出自哪个方案（如 P-01），必须已存在于 proposals/；省略表示不是拆出来的' },
        requirement: { type: 'string', description: '这条任务出自哪条需求（如 REQ-01），必须已存在于 requirements/；与 proposal 可以并存，读侧优先 requirement' },
        track: { type: 'string', description: '这条任务归属的轨：内置轨 h5 / admin / api / desktop / host / general，或 .spec/project.yaml 的 tracks 里项目追加的轨 id；一任务一轨，未知轨会被拒绝' },
        depends_on: { type: 'array', items: { type: 'string' }, description: '前置任务编号；这些任务收口之前本条不会开始' },
        task_id: { type: 'string', description: '指定编号，形如 T-014；省略则取现有 T- 编号之后的下一个空号' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const specRoot = resolveRoot(specRootInput, exec)
        const title = args.title.trim()
        if (title === '') throw new Error('task_draft 需要非空的 title：一句话说清这个任务要办成什么')

        const grade = args.grade.trim().toUpperCase()
        if (grade !== 'A' && grade !== 'B' && grade !== 'C') {
          throw new Error(`task_draft 的 grade 只能是 A、B、C，收到：${args.grade}`)
        }

        const existing = hasSpecRoot(specRoot) ? listTasks(specRoot) : []

        const duplicate = findByTitle(existing, title)
        if (duplicate !== undefined) {
          return {
            task_id: duplicate.id,
            path: taskPath(specRoot, duplicate.id),
            state: duplicate.state,
            grade: duplicate.grade,
            rules: duplicate.rules,
            description: duplicate.description,
            ...(duplicate.category === undefined ? {} : { category: duplicate.category }),
            ...(duplicate.change_type === undefined ? {} : { change_type: duplicate.change_type }),
            ...(duplicate.track === undefined ? {} : { track: duplicate.track }),
            ...(duplicate.proposal === undefined ? {} : { proposal: duplicate.proposal }),
            ...(duplicate.requirement === undefined ? {} : { requirement: duplicate.requirement }),
            attachments: duplicate.attachments,
            created: false,
            note: `已有一个同标题任务 ${duplicate.id}（${duplicate.state}），没有重复新建。要继续就基于它起草契约。`,
          }
        }

        const id = args.task_id === undefined ? nextTaskId(existing) : assertTaskId(args.task_id)
        const occupied = existing.find(task => task.id === id)
        if (occupied !== undefined) {
          throw new Error(`任务编号 ${id} 已被「${occupied.title}」占用；省略 task_id 可自动取下一个空号`)
        }

        const requestedRules = args.rules ?? []
        if (requestedRules.length > 0) {
          if (!hasSpecRoot(specRoot)) {
            throw new Error('这个仓库还没有 .spec 规格库，rules 只能留空；先把规格条目登记进 spec/rules.yaml')
          }
          const known = new Set(loadSpec(specRoot).rules.map(rule => rule.id))
          const unknown = requestedRules.filter(ruleId => !known.has(ruleId))
          if (unknown.length > 0) {
            throw new Error(
              `rules 里有规格库不存在的编号：${unknown.join(', ')}。可用编号：${[...known].join(', ') || '（规格库还没有条目）'}`,
            )
          }
        }

        const proposalId = taskDraftProposal(specRoot, args.proposal)
        const requirementId = taskDraftRequirement(specRoot, args.requirement)
        const track = taskDraftTrack(specRoot, args.track)
        const dependsOn = args.depends_on ?? []
        if (dependsOn.length > 0) {
          if (dependsOn.includes(id)) throw new Error(`任务不能依赖自己：${id}`)
          const unknown = unknownDependencies(existing, dependsOn)
          if (unknown.length > 0) {
            throw new Error(`depends_on 里有不存在的任务：${unknown.join(', ')}；先建好前置任务再挂依赖`)
          }
          const cycle = dependencyCycle(existing, id, dependsOn)
          if (cycle !== undefined) throw new Error(`depends_on 会成环：${cycle.join(' 依赖 ')}`)
        }

        const task = openTask({
          id,
          title,
          description: args.description ?? '',
          ...(args.category === undefined ? {} : { category: args.category }),
          ...(args.change_type === undefined ? {} : { change_type: args.change_type }),
          attachments: args.attachments ?? [],
          grade,
          rules: requestedRules,
          scope: { irreversible: args.irreversible ?? [], allowed_paths: args.allowed_paths ?? [] },
          evidence_required: args.evidence_required ?? [],
          ...(proposalId === undefined ? {} : { proposal: proposalId }),
          ...(requirementId === undefined ? {} : { requirement: requirementId }),
          ...(track === undefined ? {} : { track }),
          ...(dependsOn.length === 0 ? {} : { depends_on: dependsOn }),
          opened_at: new Date().toISOString(),
        })
        assertAttachmentsInsideSpec(specRoot, task.attachments)
        const path = saveTask(specRoot, task)

        return {
          task_id: task.id,
          path,
          state: task.state,
          grade: task.grade,
          rules: task.rules,
          description: task.description,
          ...(task.category === undefined ? {} : { category: task.category }),
          ...(task.change_type === undefined ? {} : { change_type: task.change_type }),
          ...(task.track === undefined ? {} : { track: task.track }),
          ...(task.proposal === undefined ? {} : { proposal: task.proposal }),
          ...(task.requirement === undefined ? {} : { requirement: task.requirement }),
          attachments: task.attachments,
          depends_on: task.depends_on,
          created: true,
          note: '任务已建，状态 drafting。契约用 contract_draft 起草；签署只能由人完成，本工具不提供签署。',
        }
      },
    }),

    defineTool({
      name: 'task_close',
      description:
        '申请收口。依次跑 P1（条目有落点）、P3（不可逆项需合法签署，且签名覆盖当前正文）、P4（条目有证据），全部通过才把任务转为 closed。任一不过则返回违规清单，状态不变。',
      parameters: {
        task_id: { type: 'string', required: true, description: '任务编号' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const specRoot = resolveRoot(specRootInput, exec)
        /** `.spec` 的上一级就是被开发的仓库根，落点路径相对它。 */
        const repoRoot = resolve(specRoot, '..')
        const task = loadTask(specRoot, args.task_id)

        const evidence = loadEvidence(specRoot, task.id)
        const violations: Violation[] = [
          ...checkP1(loadSpec(specRoot), textCodeIndexFromDir(repoRoot)).violations,
          ...checkP3(task, loadContractFact(specRoot, task.id), {
            policy: loadAutomationPolicy(specRoot).policy,
            evidence,
          }).violations,
          ...checkP4(task, evidence).violations,
        ]

        if (violations.length > 0) {
          return {
            ok: false,
            task_id: task.id,
            state: task.state,
            violations: violations.map(v => ({
              checker: v.checker,
              subject: v.subject,
              detail: v.detail,
              hint: v.hint,
            })),
            note: '状态未变更。按 hint 逐条处理后重试。',
          }
        }

        const at = new Date().toISOString()
        const { task: closed, event } = transition(task, 'closed', at)
        saveTask(specRoot, closed)

        return {
          ok: true,
          task_id: closed.id,
          state: closed.state,
          event: {
            type: event.type,
            task_id: event.task_id,
            from: event.from,
            to: event.to,
            at: event.at,
          },
        }
      },
    }),
  ]
}
