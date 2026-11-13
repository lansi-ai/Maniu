/**
 * 需求工具：把一条需求落成 `.spec/requirements/REQ-xx.yaml` 与同名正文。
 *
 * 两条刻意的限制：
 *   1. **只写 `draft`。** 批准、发布与关闭都是人机命令，模型能起草需求、能比较候选，
 *      不能替人拍板——与 `proposal_draft` 和 `/proposal_approve` 的分工同构。
 *   2. **正文与元数据一起落。** 先写正文再写 YAML，任一步失败回滚，磁盘上不留半截需求。
 *
 * 输出统一用 `{ type: 'json' }` + JSON 渲染，理由见 docs/cookbook/adding-a-tool.md。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import type { RequirementOption } from '../schema/spec.js'
import { createRequirement } from '../kernel/requirement-store.js'
import { resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'

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

/**
 * 建需求工具。
 * @param rootInput - 规格根解析（按会话工作区）。
 * @returns `requirement_draft` 工具定义。
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
          note: PENDING_NOTE,
        }
      },
    }),
  ]
}
