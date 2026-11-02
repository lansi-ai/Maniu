/**
 * 签约态工具集：改文件、跑登记过的命令、回填证据。
 *
 * 三个工具各带一道硬约束，不是提示词，是代码：
 *   1. `file_edit` 只能写仓库内部路径。`../` 与绝对路径直接拒绝。
 *   2. `cmd_run` **只接受环境档案里登记过的命令 id**，且只有 `exec: ai-auto`
 *      的才允许模型调用。其余一律拒绝并说明该谁跑。
 *   3. `evidence_attach` 只写入 `.spec/evidence/<task>/`，文件名做白名单清洗。
 *
 * 执行器可从外部注入：测试不需要真的 spawn 进程，生产才用 child_process。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { parse as parseYaml } from 'yaml'

import { Env } from '../schema/spec.js'
import type { Command } from '../schema/spec.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export type CommandRunner = (command: Command) => Promise<CommandResult>

/** 默认执行器：按档案里声明的 cmd / cwd / timeout 跑一次 shell 命令。 */
export const spawnRunner: CommandRunner = command =>
  new Promise((resolvePromise) => {
    const child = spawn(command.cmd, {
      cwd: command.cwd,
      shell: true,
      timeout: command.timeout * 1000,
    })

    let stdout = ''
    let stderr = ''
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawn 的 stdout/stderr 类型带 null，但 shell 模式下必然有管道。
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 同上。
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (err) => {
      resolvePromise({ code: -1, stdout, stderr: String(err) })
    })
    child.on('close', (code) => {
      resolvePromise({ code: code ?? -1, stdout, stderr })
    })
  })

/** 把相对路径解析到仓库内部；越界直接抛。 */
export function resolveInsideRoot(root: string, relPath: string): string {
  if (isAbsolute(relPath)) {
    throw new Error(`file_edit 只接受仓库内相对路径，收到绝对路径：${relPath}`)
  }
  const abs = resolve(root, relPath)
  const rel = relative(root, abs)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越出仓库范围：${relPath}`)
  }
  return abs
}

/** 证据文件名只允许小写字母、数字、下划线、短横线。 */
export function safeEvidenceName(kind: string): string {
  const cleaned = kind.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new Error(`非法的证据类型名：${kind}`)
  }
  return cleaned
}

/**
 * 任务编号必须在校验**原始输入**，不能先 join 再校验——
 * `path.join('evidence', '../x')` 会归一化成 `x`，越界校验就形同虚设。
 */
const TASK_ID = /^[A-Z]+-\d{2,}$/

export function assertTaskId(id: string): string {
  if (!TASK_ID.test(id)) {
    throw new Error(`非法的任务编号：${id}（应形如 T-014）`)
  }
  return id
}

function loadEnv(root: string): Env {
  return Env.parse(parseYaml(readFileSync(join(root, 'env.yaml'), 'utf8')))
}

export interface EditToolDeps {
  run?: CommandRunner
}

export function createEditTools(root: string, deps: EditToolDeps = {}): ToolDefinition[] {
  const run = deps.run ?? spawnRunner

  return [
    defineTool({
      name: 'file_read',
      description:
        '读取仓库内的文本文件。支持按行偏移与上限分段读取。只读，不改变任何文件。',
      parameters: {
        path: { type: 'string', required: true, description: '仓库内相对路径' },
        offset: { type: 'integer', description: '起始行号，从 1 开始' },
        limit: { type: 'integer', description: '最多读取的行数' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args) {
        const abs = resolveInsideRoot(root, args.path)
        const raw = readFileSync(abs, 'utf8')
        const lines = raw.split('\n')
        const start = Math.max(0, (args.offset ?? 1) - 1)
        const end = args.limit === undefined ? lines.length : start + args.limit

        return {
          path: args.path,
          total_lines: lines.length,
          offset: start + 1,
          content: lines.slice(start, end).join('\n'),
          truncated: end < lines.length,
        }
      },
    }),

    defineTool({
      name: 'file_edit',
      description:
        '把文件内容整体替换为给定文本（仓库内相对路径）。父目录不存在会自动创建。不接受绝对路径与 ../ 越界。',
      parameters: {
        path: { type: 'string', required: true, description: '仓库内相对路径，如 src/order.ts' },
        content: { type: 'string', required: true, description: '文件的完整新内容' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args) {
        const abs = resolveInsideRoot(root, args.path)
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, args.content, 'utf8')
        return { path: args.path, bytes: Buffer.byteLength(args.content, 'utf8'), written: true }
      },
    }),

    defineTool({
      name: 'cmd_run',
      description:
        '执行环境档案里登记过的命令（按 id）。只有 exec 为 ai-auto 的命令允许模型直接执行；其余需由人执行或经审批。未登记的命令一律拒绝。',
      parameters: {
        command_id: { type: 'string', required: true, description: 'env.yaml 里 commands[].id' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        const env = loadEnv(root)
        const command = env.commands.find(c => c.id === args.command_id)

        if (!command) {
          throw new Error(
            `未登记的命令：${args.command_id}。可用命令：${
              env.commands.map(c => `${c.id}(${c.exec})`).join(', ') || '(空)'
            }`,
          )
        }

        if (command.exec !== 'ai-auto') {
          const who = command.exec === 'human' ? '只能由人执行' : '需要人确认后才能执行'
          throw new Error(`命令 ${command.id} 的权限是 ${command.exec}，${who}；模型不能直接执行`)
        }

        const result = await run(command)
        return {
          command_id: command.id,
          ok: result.code === 0,
          code: result.code,
          stdout: result.stdout.slice(-4000),
          stderr: result.stderr.slice(-4000),
        }
      },
    }),

    defineTool({
      name: 'evidence_attach',
      description:
        '把一次执行的证据写入 .spec/evidence/<task_id>/<kind>.log。收口时按证据判定，所以这里写什么，收口就认什么。',
      parameters: {
        task_id: { type: 'string', required: true, description: '任务编号' },
        kind: { type: 'string', required: true, description: '证据类型，如 build / test' },
        content: { type: 'string', required: true, description: '证据正文（命令输出摘要等）' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args) {
        const taskId = assertTaskId(args.task_id)
        const taskDir = resolveInsideRoot(root, join('evidence', taskId))
        const name = safeEvidenceName(args.kind)
        const file = join(taskDir, `${name}.log`)

        mkdirSync(taskDir, { recursive: true })
        writeFileSync(file, args.content, 'utf8')

        return {
          task_id: args.task_id,
          kind: name,
          path: relative(root, file).split('\\').join('/'),
          bytes: Buffer.byteLength(args.content, 'utf8'),
        }
      },
    }),
  ]
}
