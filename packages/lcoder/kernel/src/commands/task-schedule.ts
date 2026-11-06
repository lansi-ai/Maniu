/**
 * 人机命令 `task_schedule`：把一次调度判定追加到 `.spec/evidence/<任务>/schedule.jsonl`。
 *
 * 判定发生在工作台点「开始对话」那一下，浏览器不写盘；这条命令是唯一的落盘口。
 * 只追加、不改任务文件——决策是审计事实，不是任务字段；任务 schema 因此不必为它扩字段。
 *
 * 与 `task_bind` 同档：它不改状态、不进工具面。命令本身也会作为 `command/run`
 * 与 `command/done` 进会话日志，所以哪条会话、什么时候判的都能从日志对上。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertTaskId, loadTask, taskPath } from '../kernel/task-store.js'

/** 一条判定最长的原文；超出直接拒绝，免得把二进制或整段日志塞进证据。 */
const MAX_PAYLOAD_CHARS = 8_192

/** 允许的判定值；与 `scheduling.ts` 的 `SchedulingVerdict` 一致。 */
const VERDICTS = new Set(['reuse', 'enqueue', 'new', 'wait'])

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface ScheduleInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type ScheduleCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface ScheduleCommandDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: ScheduleInvocation) => ScheduleCommandResult
}

/**
 * 建 `task_schedule` 命令定义。
 * @param rootInput - 规格根解析，与工具和另外几条命令共用同一条会话来源。
 * @param now - 记录时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createTaskScheduleCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): ScheduleCommandDefinition {
  return {
    name: 'task_schedule',
    description: '把一次调度判定追加到任务证据目录，供事后审计',
    input: { hint: '<任务编号> <判定 JSON>' },
    handler: invocation => record(rootInput, invocation, now),
  }
}

function record(rootInput: RootInput, invocation: ScheduleInvocation, now: () => string): ScheduleCommandResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要任务编号与判定 JSON，例如 /task_schedule T-01 {"verdict":"new"}' }
  const split = raw.search(/\s/u)
  if (split <= 0) return { kind: 'error', text: '判定 JSON 缺失：任务编号之后还要跟一行 JSON' }
  const taskArg = raw.slice(0, split)
  const payload = raw.slice(split).trim()

  let taskId: string
  try {
    taskId = assertTaskId(taskArg)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  if (payload.length > MAX_PAYLOAD_CHARS) {
    return { kind: 'error', text: `判定 JSON 超过 ${String(MAX_PAYLOAD_CHARS)} 字符，拒绝落盘` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (error: unknown) {
    return { kind: 'error', text: `判定 JSON 读不懂：${errorMessage(error)}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'error', text: '判定 JSON 必须是一个对象' }
  }
  const verdict = (parsed as Record<string, unknown>).verdict
  if (typeof verdict !== 'string' || !VERDICTS.has(verdict)) {
    return { kind: 'error', text: '判定 JSON 缺少合法 verdict（reuse / enqueue / new / wait）' }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可记录的任务` }
  }
  try {
    loadTask(root, taskId)
  } catch (error: unknown) {
    return { kind: 'error', text: `读不到任务 ${taskId}（${taskPath(root, taskId)}）：${errorMessage(error)}` }
  }

  const sessionId = invocation.agent?.session.header.id
  const line = JSON.stringify({
    at: now(),
    ...(sessionId === undefined ? {} : { by: sessionId }),
    ...(parsed as Record<string, unknown>),
  })
  const path = join(root, 'evidence', taskId, 'schedule.jsonl')
  try {
    mkdirSync(join(root, 'evidence', taskId), { recursive: true })
    appendFileSync(path, `${line}\n`, 'utf8')
  } catch (error: unknown) {
    return { kind: 'error', text: `调度记录写不进去（${path}）：${errorMessage(error)}` }
  }
  return { kind: 'success', text: `调度记录已追加到 ${path}` }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
