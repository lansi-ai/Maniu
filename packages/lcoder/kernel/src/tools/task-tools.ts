/**
 * 任务侧工具：读任务、申请收口。
 *
 * `task_close` 是"凭什么算做完"的落点：它把 P1/P3/P4 三条检查器串起来，
 * **全部通过才允许转移状态**。不通过就把违规清单原样交出来，一条也不吞。
 *
 * 状态图本身也会拦：`implementing` 不能直接到 `closed`，必须先过 `verifying`。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { parse as parseYaml } from 'yaml'

import { checkP1, checkP3, checkP4 } from '../checkers/index.js'
import type { Violation } from '../checkers/index.js'
import { loadSpec, textCodeIndexFromDir } from '../kernel/spec-store.js'
import { resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'
import { listTasks, loadTask, saveTask, transition } from '../kernel/task-store.js'
import { Contract } from '../schema/spec.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

/** 读契约；不存在返回 null（"没有契约"本身是 P3 要判的一种状态）。 */
function loadContract(specRoot: string, taskId: string): Contract | null {
  const path = join(specRoot, 'contracts', `${taskId}.contract.yaml`)
  if (!existsSync(path)) return null
  return Contract.parse(parseYaml(readFileSync(path, 'utf8')))
}

/** 读证据目录：文件名（去掉 .log）→ 字节数。空文件会被 P4 判出来。 */
function loadEvidence(specRoot: string, taskId: string): Record<string, number> {
  const dir = join(specRoot, 'evidence', taskId)
  if (!existsSync(dir)) return {}

  const out: Record<string, number> = {}
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (!statSync(full).isFile()) continue
    out[name.replace(/\.log$/, '')] = statSync(full).size
  }
  return out
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
        if (args.task_id) {
          const t = loadTask(specRoot, args.task_id)
          return {
            id: t.id,
            title: t.title,
            grade: t.grade,
            state: t.state,
            rules: t.rules,
            scope: t.scope,
            evidence_required: t.evidence_required,
          }
        }
        return {
          tasks: listTasks(specRoot).map(t => ({
            id: t.id,
            title: t.title,
            state: t.state,
            grade: t.grade,
          })),
        }
      },
    }),

    defineTool({
      name: 'task_close',
      description:
        '申请收口。依次跑 P1（条目有落点）、P3（不可逆项需人签署）、P4（条目有证据），全部通过才把任务转为 closed。任一不过则返回违规清单，状态不变。',
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

        const violations: Violation[] = [
          ...checkP1(loadSpec(specRoot), textCodeIndexFromDir(repoRoot)).violations,
          ...checkP3(task, loadContract(specRoot, task.id)).violations,
          ...checkP4(task, loadEvidence(specRoot, task.id)).violations,
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
