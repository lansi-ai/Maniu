/**
 * 人机命令 `flow_log`：把一次开工或流程判定追加到 `.spec/evidence/<任务>/flow.jsonl`。
 *
 * 与 `task_schedule` 同档：只追加、不改任务文件。开工本身不推进状态，所以这份
 * 流水就是「点过什么、结果如何、为什么没开」的唯一审计依据；失败也照写，
 * 界面再点一次重试时能对上同一份记录。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertTaskId, listTasks, taskPath } from '../kernel/task-store.js'

/** 一条流水最长的原文；超出直接拒绝，免得把整段日志塞进证据。 */
const MAX_PAYLOAD_CHARS = 8_192

/** 引擎能给出的动作；与 `flow.ts` 的 `FlowAction` 同序同名。 */
const ACTIONS = new Set(['draft', 'contract', 'sign', 'implement', 'verify', 'close', 'commit', 'external', 'stop'])

/** 一次开工的结果；缺省表示只记录了判定，没有执行。 */
const RESULTS = new Set(['success', 'failed', 'held', 'skipped'])

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface FlowLogInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type FlowLogCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface FlowLogCommandDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: FlowLogInvocation) => FlowLogCommandResult
}

/**
 * 建 `flow_log` 命令定义。
 * @param rootInput - 规格根解析，与工具和另外几条命令共用同一条会话来源。
 * @param now - 记录时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createFlowLogCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): FlowLogCommandDefinition {
  return {
    name: 'flow_log',
    description: '把一次开工或流程判定追加到任务证据目录，供事后审计',
    input: { hint: '<任务编号> <动作 JSON>' },
    handler: invocation => record(rootInput, invocation, now),
  }
}

function record(rootInput: RootInput, invocation: FlowLogInvocation, now: () => string): FlowLogCommandResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要任务编号与动作 JSON，例如 /flow_log T-01 {"action":"implement","result":"success"}' }
  const split = raw.search(/\s/u)
  if (split <= 0) return { kind: 'error', text: '动作 JSON 缺失：任务编号之后还要跟一行 JSON' }
  const taskArg = raw.slice(0, split)
  const payload = raw.slice(split).trim()

  let taskId: string
  try {
    taskId = assertTaskId(taskArg)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }
  if (payload.length > MAX_PAYLOAD_CHARS) {
    return { kind: 'error', text: `动作 JSON 超过 ${String(MAX_PAYLOAD_CHARS)} 字符，拒绝落盘` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (error: unknown) {
    return { kind: 'error', text: `动作 JSON 读不懂：${errorMessage(error)}` }
  }
  if (!isRecord(parsed)) return { kind: 'error', text: '动作 JSON 必须是一个对象' }

  const action = parsed.action
  if (typeof action !== 'string' || !ACTIONS.has(action)) {
    return { kind: 'error', text: '动作 JSON 缺少合法 action（draft / contract / sign / implement / verify / close / commit / external / stop）' }
  }
  if (parsed.result !== undefined && (typeof parsed.result !== 'string' || !RESULTS.has(parsed.result))) {
    return { kind: 'error', text: 'result 只能是 success / failed / held / skipped' }
  }
  if (parsed.blockers !== undefined && !Array.isArray(parsed.blockers)) {
    return { kind: 'error', text: 'blockers 必须是数组' }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可记录的任务` }
  }
  let tasks
  try {
    tasks = listTasks(root)
  } catch (error: unknown) {
    return { kind: 'error', text: `${root}/tasks 读不懂：${errorMessage(error)}` }
  }
  if (!tasks.some(task => task.id === taskId)) {
    return { kind: 'error', text: `读不到任务 ${taskId}（${taskPath(root, taskId)}）` }
  }

  const sessionId = invocation.agent?.session.header.id
  const line = JSON.stringify({
    ...parsed,
    taskId,
    at: now(),
    ...(sessionId === undefined ? {} : { by: sessionId }),
  })
  const path = join(root, 'evidence', taskId, 'flow.jsonl')
  try {
    mkdirSync(join(root, 'evidence', taskId), { recursive: true })
    appendFileSync(path, `${line}\n`, 'utf8')
  } catch (error: unknown) {
    return { kind: 'error', text: `动作流水写不进去（${path}）：${errorMessage(error)}` }
  }
  return { kind: 'success', text: `动作流水已追加到 ${path}` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
