/**
 * Git 工具集：状态、差异、提交。三条都是窄口，参数面里没有 shell 字符串。
 *
 * 为什么不用 `cmd_run` 跑 git：那条路的能力边界由 `.spec/env.yaml` 登记的命令决定，
 * 一条 `git -c core.pager=cat log` 之类的写法就把参数面变成了字符串拼接。这里每个工具
 * 只把自己那几个 argv 交给执行器，`git` 与参数分开传、不走 shell，模型拼不出额外子命令。
 *
 * 三条硬约束，都在代码里不在提示词里：
 *   1. **没有 push。** 提交是本工具的终点，推远端由人执行（与「默认用户自己推」同一条口径）。
 *   2. **路径必须落在仓库内。** 与 `file_edit` 共用同一条越界判定。
 *   3. **不带 `--amend`、不带 `--no-verify`。** 钩子与签名提交者的语义由仓库自己定。
 */
import { spawn } from 'node:child_process'

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { resolveInsideRoot } from './edit-tools.js'
import type { CommandResult } from './edit-tools.js'
import { resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'

/** 一次 git 调用的结果；形状与 `CommandResult` 一致。 */
export type GitResult = CommandResult

/** 按 argv 跑一次 git：`args` 与可执行文件分开传，不经 shell。 */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>

/** 默认执行器：`git <args>`，工作目录固定在本检出根。 */
export const spawnGit: GitRunner = (args, cwd) =>
  new Promise((resolvePromise) => {
    const child = spawn('git', [...args], { cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      resolvePromise({ code: -1, stdout, stderr: String(error) })
    })
    child.on('close', (code) => {
      resolvePromise({ code: code ?? -1, stdout, stderr })
    })
  })

/** 输出截断：与 `cmd_run` 同一档，避免一次 `git diff` 把上下文吃满。 */
const OUTPUT_LIMIT = 4000

/**
 * 校验模型给出的路径列表：非空、逐个必须落在仓库内。
 * @param repoRoot - 仓库根（规格根的上一级）。
 * @param paths - 工具入参里的路径。
 * @returns 原样返回的相对路径列表。
 */
function assertRepoPaths(repoRoot: string, paths: readonly string[]): readonly string[] {
  if (paths.length === 0) throw new Error('路径列表不能为空：要提交或要看差异总得给出范围')
  for (const path of paths) {
    // 只用越界判定，不建目录：这里传的是既有路径。
    resolveInsideRoot(repoRoot, path)
  }
  return paths
}

/** 先确认这是一份工作树；不是就把话说清，别让 git 的英文报错当结论。 */
async function assertWorkTree(run: GitRunner, repoRoot: string): Promise<void> {
  const probe = await run(['rev-parse', '--is-inside-work-tree'], repoRoot)
  if (probe.code !== 0 || probe.stdout.trim() !== 'true') {
    throw new Error(`这个工作区不是 git 仓库（${repoRoot} 下没有可用的工作树）：${probe.stderr.trim() || probe.stdout.trim() || 'git rev-parse 无输出'}`)
  }
}

/**
 * 建 Git 工具。
 * @param repoRootInput - 仓库根解析（按会话工作区；不是规格根）。
 * @param run - git 执行器；测试注入假执行器，生产用 `spawnGit`。
 * @returns `git_status`、`git_diff`、`git_commit` 三个工具定义。
 */
export function createGitTools(repoRootInput: RootInput, run: GitRunner = spawnGit): ToolDefinition[] {
  return [
    defineTool({
      name: 'git_status',
      description:
        '看工作区状态（porcelain 格式）。省略 paths 时看整个仓库；只读，不改任何东西。',
      parameters: {
        paths: { type: 'array', items: { type: 'string' }, description: '仓库内相对路径前缀；省略表示全仓' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
      async execute(args, exec) {
        const repoRoot = resolveRoot(repoRootInput, exec)
        await assertWorkTree(run, repoRoot)
        const paths = args.paths ?? []
        if (paths.length > 0) assertRepoPaths(repoRoot, paths)
        const result = await run(paths.length === 0 ? ['status', '--porcelain=v1'] : ['status', '--porcelain=v1', '--', ...paths], repoRoot)
        if (result.code !== 0) throw new Error(`git status 失败：${result.stderr.trim() || result.stdout.trim()}`)
        const entries = result.stdout.split('\n').filter(line => line !== '')
        return {
          clean: entries.length === 0,
          count: entries.length,
          entries,
          ...(entries.length === 0 ? { note: '工作区干净，没有待提交的改动。' } : {}),
        }
      },
    }),

    defineTool({
      name: 'git_diff',
      description:
        '看改动内容。staged 为真时看已暂存的（git diff --cached），否则看工作区。只读，输出截到 4000 字符。',
      parameters: {
        paths: { type: 'array', items: { type: 'string' }, description: '仓库内相对路径前缀；省略表示全仓' },
        staged: { type: 'boolean', description: 'true 表示看已暂存的改动' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
      async execute(args, exec) {
        const repoRoot = resolveRoot(repoRootInput, exec)
        await assertWorkTree(run, repoRoot)
        const paths = args.paths ?? []
        if (paths.length > 0) assertRepoPaths(repoRoot, paths)
        const base = args.staged === true ? ['diff', '--cached'] : ['diff']
        const result = await run(paths.length === 0 ? base : [...base, '--', ...paths], repoRoot)
        if (result.code !== 0) throw new Error(`git diff 失败：${result.stderr.trim() || result.stdout.trim()}`)
        return {
          staged: args.staged === true,
          has_changes: result.stdout.trim() !== '',
          diff: result.stdout.slice(-OUTPUT_LIMIT),
        }
      },
    }),

    defineTool({
      name: 'git_commit',
      description:
        '把指定路径暂存并提交：先 git add -- <paths>，再 git commit -m <message>。只提交这些路径，不带 --amend、不带 --no-verify，**没有 push**——推远端由人执行。暂存区为空时不产生提交。',
      parameters: {
        paths: { type: 'array', items: { type: 'string' }, required: true, description: '要提交的文件，仓库内相对路径；只这些进本次提交' },
        message: { type: 'string', required: true, description: '提交说明，按 Conventional Commits 写' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
      async execute(args, exec) {
        const repoRoot = resolveRoot(repoRootInput, exec)
        const message = args.message.trim()
        if (message === '') throw new Error('git_commit 需要非空的 message：提交说明是仓库历史的一部分，不能空')
        const paths = assertRepoPaths(repoRoot, args.paths)
        await assertWorkTree(run, repoRoot)

        const added = await run(['add', '--', ...paths], repoRoot)
        if (added.code !== 0) throw new Error(`git add 失败：${added.stderr.trim() || added.stdout.trim()}`)

        const staged = await run(['diff', '--cached', '--name-only'], repoRoot)
        if (staged.code !== 0) throw new Error(`读暂存区失败：${staged.stderr.trim() || staged.stdout.trim()}`)
        const stagedFiles = staged.stdout.split('\n').filter(line => line !== '')
        if (stagedFiles.length === 0) {
          return {
            committed: false,
            staged_files: [],
            note: '这些路径没有可提交的改动，暂存区是空的，没有产生提交。',
          }
        }

        const committed = await run(['commit', '-m', message], repoRoot)
        if (committed.code !== 0) {
          throw new Error(`git commit 失败（暂存区保留，未回滚）：${committed.stderr.trim() || committed.stdout.trim()}`)
        }
        const head = await run(['log', '-1', '--pretty=format:%h %s'], repoRoot)

        return {
          committed: true,
          staged_files: stagedFiles,
          head: head.code === 0 ? head.stdout.trim() : '(提交成功，但读不到 HEAD 摘要)',
          output: committed.stdout.slice(-OUTPUT_LIMIT),
          note: '提交只落在本地仓库；推远端由人执行。',
        }
      },
    }),
  ]
}
