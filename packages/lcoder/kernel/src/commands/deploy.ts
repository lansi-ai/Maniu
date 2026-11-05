/**
 * 人机命令 `deploy`：人触发一次登记为 `exec: human` 的部署命令，并把输出落成证据。
 *
 * 为什么是命令而不是工具：部署是仓外不可逆副作用。模型能写脚本、能读环境、能指导，
 * 但「上线」这一下必须由人按下——与 `contract_sign`、`task_bind`、`proposal_approve` 同档，
 * 这条能力永不进任何角色与状态的工具面。
 *
 * 为什么只认 `exec: human`：`ai-auto` 与 `ai-confirm` 的命令已有 `cmd_run` 与审批那条路，
 * 再开一条等于给同一条命令两个执行口，失败时说不清是谁放的行。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { findCommand } from '../kernel/env-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertTaskId, listTasks, pickTaskForSession } from '../kernel/task-store.js'
import { spawnRunner } from '../tools/edit-tools.js'
import type { CommandRunner } from '../tools/edit-tools.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface DeployInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type DeployResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface DeployDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: DeployInvocation) => Promise<DeployResult>
}

/** 输出摘要的字符上限：部署日志可能很长，回执只留尾部。 */
const OUTPUT_LIMIT = 2000

/**
 * 建 `deploy` 命令定义。
 * @param rootInput - 规格根解析，与工具和其它命令共用同一条会话来源。
 * @param run - 命令执行器；测试注入假执行器，生产用 `spawnRunner`。
 * @param now - 证据时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createDeployCommand(
  rootInput: RootInput,
  run: CommandRunner = spawnRunner,
  now: () => string = () => new Date().toISOString(),
): DeployDefinition {
  return {
    name: 'deploy',
    description: '执行一条登记为 human 权限的部署命令，并把输出落成任务证据',
    input: { hint: '<命令 id> [任务编号]' },
    handler: invocation => deploy(rootInput, run, now, invocation),
  }
}

async function deploy(
  rootInput: RootInput,
  run: CommandRunner,
  now: () => string,
  invocation: DeployInvocation,
): Promise<DeployResult> {
  const [commandId = '', taskArg = ''] = invocation.rawInput.trim().split(/\s+/)
  if (commandId === '') return { kind: 'error', text: '需要命令 id，例如 /deploy deploy-prod；id 来自 .spec/env.yaml 的 commands' }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可读的环境档案` }
  }

  let command
  try {
    command = findCommand(root, commandId)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }
  if (command.exec !== 'human') {
    return {
      kind: 'error',
      text: `${command.id} 的权限是 ${command.exec}，那条路归 cmd_run 与审批；/deploy 只跑登记为 human 的命令`,
    }
  }

  let taskId: string | undefined
  if (taskArg !== '') {
    try {
      taskId = assertTaskId(taskArg)
    } catch (error: unknown) {
      return { kind: 'error', text: errorMessage(error) }
    }
  } else {
    const tasks = listTasks(root)
    taskId = pickTaskForSession(tasks, invocation.agent?.session.header.id, undefined)?.id
  }

  // Command.cwd 是相对仓库根写的；执行器按进程 cwd 解析会跑错目录，这里先定到本检出。
  const result = await run({ ...command, cwd: resolve(root, '..', command.cwd) })
  const tail = (result.stdout + result.stderr).trim().slice(-OUTPUT_LIMIT)

  if (result.code !== 0) {
    return {
      kind: 'error',
      text: `${command.id} 退出码 ${String(result.code)}：${tail || '(无输出)'}`,
    }
  }

  const evidence = taskId === undefined ? null : writeEvidence(root, taskId, command.cmd, result.code, tail, now())
  return {
    kind: 'success',
    text: `${command.id} 已执行（退出码 0）。${
      evidence === null
        ? '这条命令没有对应任务，输出没落成证据。'
        : `证据落在 ${evidence}`
    }`,
  }
}

/** 把一次部署的原文写成证据；证据目录按任务号分档，文件名固定 deploy.log。 */
function writeEvidence(root: string, taskId: string, cmd: string, code: number, tail: string, at: string): string {
  const path = join(root, 'evidence', taskId, 'deploy.log')
  mkdirSync(join(root, 'evidence', taskId), { recursive: true })
  writeFileSync(path, `cmd: ${cmd}\ncode: ${String(code)}\nat: ${at}\n\n${tail}\n`, 'utf8')
  return path
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
