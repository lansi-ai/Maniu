/**
 * 人机命令 `task_schedule`：把一次调度判定追加到 `.spec/evidence/<任务>/schedule.jsonl`。
 *
 * 判定发生在工作台点「开始对话」那一下，浏览器不写盘；这条命令是唯一的落盘口。
 * 只追加、不改任务文件——决策是审计事实，不是任务字段；任务 schema 因此不必为它扩字段。
 * 入队判定还会带 `joint`（目标会话与成员任务），这时再写一份
 * `.spec/evidence/scheduling/group-<n>.yaml`，同一会话只维护一个组文件。
 *
 * 与 `task_bind` 同档：它不改状态、不进工具面。命令本身也会作为 `command/run`
 * 与 `command/done` 进会话日志，所以哪条会话、什么时候判的都能从日志对上。
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertTaskId, listTasks, taskPath } from '../kernel/task-store.js'

/** 一条判定最长的原文；超出直接拒绝，免得把二进制或整段日志塞进证据。 */
const MAX_PAYLOAD_CHARS = 8_192

/** 一个联调组最多的成员数；防止一次入队把整张看板写进一个组。 */
const MAX_GROUP_MEMBERS = 20

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
  const fields = parsed as Record<string, unknown>
  const verdict = fields.verdict
  if (typeof verdict !== 'string' || !VERDICTS.has(verdict)) {
    return { kind: 'error', text: '判定 JSON 缺少合法 verdict（reuse / enqueue / new / wait）' }
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

  const joint = readJoint(fields.joint, verdict)
  if (joint.kind === 'error') return joint
  if (joint.value !== undefined) {
    for (const member of joint.value.members) {
      if (member !== taskId && !tasks.some(task => task.id === member)) {
        return { kind: 'error', text: `联调组成员 ${member} 不存在；先建好任务再入队` }
      }
    }
  }

  const at = now()
  const sessionId = invocation.agent?.session.header.id
  const line = JSON.stringify({
    at,
    ...(sessionId === undefined ? {} : { by: sessionId }),
    ...fields,
  })
  const path = join(root, 'evidence', taskId, 'schedule.jsonl')
  try {
    mkdirSync(join(root, 'evidence', taskId), { recursive: true })
    appendFileSync(path, `${line}\n`, 'utf8')
  } catch (error: unknown) {
    return { kind: 'error', text: `调度记录写不进去（${path}）：${errorMessage(error)}` }
  }

  if (joint.value === undefined) return { kind: 'success', text: `调度记录已追加到 ${path}` }
  try {
    const groupPath = writeJointGroup(root, joint.value, taskId, at)
    return { kind: 'success', text: `调度记录已追加到 ${path}；联调组落在 ${groupPath}` }
  } catch (error: unknown) {
    return { kind: 'error', text: `调度记录已写入 ${path}，但联调组写不进去：${errorMessage(error)}` }
  }
}

/** 入队时随判定一起送来的联调组：目标会话与成员任务。 */
interface JointRequest {
  readonly sessionId: string
  readonly members: readonly string[]
}

/**
 * 解析并校验 `joint` 字段；只有 enqueue 允许带联调组。
 * @param raw - 判定 JSON 里的 joint 值。
 * @param verdict - 同一条判定的 verdict。
 * @returns 合法联调组、缺省（不建组），或错误回执。
 */
function readJoint(
  raw: unknown,
  verdict: string,
): { kind: 'ok'; value: JointRequest | undefined } | { kind: 'error'; text: string } {
  if (raw === undefined) return { kind: 'ok', value: undefined }
  if (verdict !== 'enqueue') return { kind: 'error', text: '只有 enqueue 判定能带联调组' }
  if (!isRecord(raw)) return { kind: 'error', text: 'joint 必须是一个对象' }
  const session = raw.sessionId
  if (typeof session !== 'string' || session.trim() === '') {
    return { kind: 'error', text: 'joint.sessionId 必须是非空字符串' }
  }
  if (!Array.isArray(raw.members) || raw.members.length === 0) {
    return { kind: 'error', text: 'joint.members 必须是非空任务编号数组' }
  }
  if (raw.members.length > MAX_GROUP_MEMBERS) {
    return { kind: 'error', text: `joint.members 超过 ${String(MAX_GROUP_MEMBERS)} 条，拒绝落盘` }
  }
  const members: string[] = []
  for (const value of raw.members) {
    if (typeof value !== 'string') return { kind: 'error', text: 'joint.members 只能放任务编号字符串' }
    try {
      members.push(assertTaskId(value))
    } catch (error: unknown) {
      return { kind: 'error', text: errorMessage(error) }
    }
  }
  return { kind: 'ok', value: { sessionId: session.trim(), members: [...new Set(members)] } }
}

const GROUP_FILE = /^group-(\d+)\.yaml$/u

/**
 * 写联调组：同一目标会话只保留一个组文件，后来的成员并进去。
 * @param root - 规格根。
 * @param joint - 目标会话与成员。
 * @param taskId - 本次入队的任务，始终算成员。
 * @param at - 建立或更新时间。
 * @returns 组文件路径。
 */
function writeJointGroup(root: string, joint: JointRequest, taskId: string, at: string): string {
  const dir = join(root, 'evidence', 'scheduling')
  mkdirSync(dir, { recursive: true })
  let existingName: string | undefined
  let existing: Record<string, unknown> | undefined
  let max = 0
  for (const entry of readdirSync(dir)) {
    const match = GROUP_FILE.exec(entry)
    if (match === null || match[1] === undefined) continue
    max = Math.max(max, Number(match[1]))
    if (existing !== undefined) continue
    try {
      const doc: unknown = parseYaml(readFileSync(join(dir, entry), 'utf8'))
      if (isRecord(doc) && doc.session === joint.sessionId) {
        existingName = entry
        existing = doc
      }
    } catch {
      // 读不懂的组文件跳过，绝不在它上面覆盖写。
    }
  }
  const previous = existing === undefined ? [] : stringArray(existing.members)
  const members = [...new Set([...previous, ...joint.members, taskId])]
  const id = typeof existing?.id === 'string'
    ? existing.id
    : existingName === undefined ? `group-${String(max + 1)}` : existingName.replace(/\.yaml$/u, '')
  const record = {
    id,
    session: joint.sessionId,
    members,
    created_at: typeof existing?.created_at === 'string' ? existing.created_at : at,
    updated_at: at,
  }
  const name = existingName ?? `group-${String(max + 1)}.yaml`
  const path = join(dir, name)
  writeFileSync(path, stringifyYaml(record), 'utf8')
  return path
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
