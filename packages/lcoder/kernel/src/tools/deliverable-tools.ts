/**
 * 交付索引工具：`deliverable_draft` 是模型唯一的交付登记入口。
 *
 * 它不写工程文档本身——README/docs 仍由实施线用 `file_edit` 写进仓库；
 * 这里只把「这条任务交付了什么、落在哪些文档、怎么验收」登记成
 * `.spec/deliverables/<任务编号>.yaml`，供收口闸门与界面读取。
 *
 * 存在性在这里查：docs 是仓库相对路径，写盘前按仓库根逐条确认是真实文件。
 * schema 只拒绝绝对路径与 `..`，它没有仓库根。
 */
import { statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { readDeliverable, saveDeliverable } from '../kernel/deliverable-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'
import { assertTaskId, listTasks } from '../kernel/task-store.js'
import { Deliverable } from '../schema/deliverable.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

/**
 * 按仓库根复核交付文档：必须是仓库内的真实文件。
 * @param repoRoot - 仓库根（规格根的上一级）。
 * @param docs - 已通过 schema 的仓库相对路径。
 * @throws 路径跳出仓库，或有文件不存在。
 */
function assertDocsExist(repoRoot: string, docs: readonly string[]): void {
  const escaped: string[] = []
  const missing: string[] = []
  for (const doc of docs) {
    const target = relative(repoRoot, resolve(repoRoot, doc))
    if (target === '' || target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target)) {
      escaped.push(doc)
      continue
    }
    const entry = statSync(resolve(repoRoot, doc), { throwIfNoEntry: false })
    if (entry === undefined || !entry.isFile()) missing.push(doc)
  }
  if (escaped.length > 0) {
    throw new Error(`docs 里有跳出仓库根的路径：${escaped.join('、')}；交付文档必须是仓库相对路径`)
  }
  if (missing.length > 0) {
    throw new Error(`docs 里有仓库中不存在的文件：${missing.join('、')}；先把工程文档写进仓库，再用 deliverable_draft 登记`)
  }
}

export function createDeliverableTools(specRootInput: RootInput): ToolDefinition[] {
  return [
    defineTool({
      name: 'deliverable_draft',
      description:
        '把一条任务的交付物登记成 .spec/deliverables/<任务编号>.yaml：summary 写这条任务交付了什么，docs 是工程文档的仓库相对路径（至少一条，必须真实存在），commands 是验收命令（可以为空）。按任务覆盖写，保留首次创建时间。它只登记索引，不写工程文档本身——README、docs 仍用 file_edit 写进仓库。',
      parameters: {
        task: { type: 'string', required: true, description: '任务编号，如 T-014；任务必须已存在' },
        summary: { type: 'string', required: true, description: '一句话摘要：这条任务交付了什么' },
        docs: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description: '工程文档的仓库相对路径，如 README.md、docs/architecture.md；至少一条，且必须真实存在',
        },
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: '验收命令，如 pnpm test；可以为空',
        },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const specRoot = resolveRoot(specRootInput, exec)
        if (!hasSpecRoot(specRoot)) {
          throw new Error('这个仓库还没有 .spec 规格库；先用 task_draft 立项，交付索引才有落点')
        }

        const taskId = assertTaskId(args.task.trim())
        const known = listTasks(specRoot).map(task => task.id)
        if (!known.includes(taskId)) {
          throw new Error(`task 里的任务不存在：${taskId}；${known.length === 0 ? '这个规格里还没有任务，先用 task_draft 立项' : `已有任务 ${known.join('、')}`}`)
        }

        const summary = args.summary.trim()
        if (summary === '') throw new Error('deliverable_draft 需要非空的 summary：一句话说清这条任务交付了什么')

        const docs = args.docs.map(doc => doc.trim())
        if (docs.length === 0) throw new Error('docs 至少登记一条工程文档：交付物要指向仓库里真实存在的文件')
        const commands = (args.commands ?? []).map(command => command.trim())
        const at = new Date().toISOString()
        const existing = readDeliverable(specRoot, taskId)
        const createdAt = existing.kind === 'ok' ? existing.value.created_at : at

        // 先过 schema（绝对路径、`..`、空摘要），再按仓库根查文件是否存在：
        // 形态错误与文件缺失要分开报，模型才知道该改哪一处。
        const deliverable = Deliverable.parse({
          task: taskId,
          summary,
          docs,
          commands,
          created_at: createdAt,
          updated_at: at,
        })
        const repoRoot = resolve(specRoot, '..')
        assertDocsExist(repoRoot, deliverable.docs)
        const path = saveDeliverable(specRoot, deliverable)

        return {
          task_id: taskId,
          path,
          summary: deliverable.summary,
          docs: deliverable.docs,
          commands: deliverable.commands,
          created_at: deliverable.created_at,
          updated_at: deliverable.updated_at,
          replaced: existing.kind === 'ok',
          note: '交付索引已写入。工程文档本身仍需用 file_edit 写进仓库；收口时按这份索引判定。',
        }
      },
    }),
  ]
}
