/**
 * 人机命令 `task_assign`：把一条任务分配给一个岗位。
 *
 * 三条理由，决定它是命令而不是工具：
 *   1. **分配是硬约束。** 调度复用会话前会比对任务的岗位与会话的角色，模型能自己
 *      分配就等于能自己挑能复用它的会话——和 `/task_bind` 同一档。
 *   2. **人机命令正好留证。** 执行不产生模型消息，但 `command/run` 与 `command/done`
 *      会进会话日志：谁在什么时候把哪条任务分给哪个岗位都能对上。
 *   3. **前端不写盘。** 岗位名册只由 kernel 写；浏览器只在会话里发起这一次命令。
 *
 * 岗位解析名册优先、其次内置角色；两边都不认识就拒绝，不写一个读侧只能显示
 * 「未知岗位」的 id。任务状态不由本命令改动。
 */
import { Task } from '../schema/spec.js'
import { resolveRole, rolesPath } from '../kernel/role-store.js'
import type { RoleResolution } from '../kernel/role-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertTaskId, listTasks, saveTask, taskPath } from '../kernel/task-store.js'
import { ROLES } from '../kernel/surface.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface AssignInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type AssignCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface AssignCommandDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: AssignInvocation) => AssignCommandResult
}

/**
 * 建 `task_assign` 命令定义。
 * @param rootInput - 规格根解析，与工具共用同一条会话来源。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createTaskAssignCommand(rootInput: RootInput): AssignCommandDefinition {
  return {
    name: 'task_assign',
    description: '把一条任务分配给岗位：岗位优先取自 .spec/roles.yaml，其次内置角色',
    input: { hint: '<任务编号> <岗位 id>' },
    handler: invocation => assignTask(rootInput, invocation),
  }
}

function assignTask(rootInput: RootInput, invocation: AssignInvocation): AssignCommandResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') {
    return { kind: 'error', text: '需要任务编号与岗位 id，例如 /task_assign T-01 vue-engineer' }
  }
  const split = raw.search(/\s/u)
  if (split <= 0) {
    return { kind: 'error', text: '岗位 id 缺失：任务编号之后还要跟一个岗位 id，例如 /task_assign T-01 vue-engineer' }
  }
  const taskArg = raw.slice(0, split)
  const roleId = raw.slice(split).trim()
  if (roleId === '') {
    return { kind: 'error', text: '岗位 id 缺失：任务编号之后还要跟一个岗位 id' }
  }

  let taskId: string
  try {
    taskId = assertTaskId(taskArg)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可分配的任务；先用 task_draft 立项` }
  }

  let tasks: Task[]
  try {
    tasks = listTasks(root)
  } catch (error: unknown) {
    return { kind: 'error', text: `${root}/tasks 读不懂：${errorMessage(error)}` }
  }

  const target = tasks.find(task => task.id === taskId)
  if (target === undefined) {
    return { kind: 'error', text: `找不到 ${taskId} 的任务文件（${taskPath(root, taskId)}）；先用 task_draft 立项` }
  }

  let resolution: RoleResolution | undefined
  try {
    resolution = resolveRole(root, roleId)
  } catch (error: unknown) {
    return { kind: 'error', text: `${rolesPath(root)} 读不懂：${errorMessage(error)}` }
  }
  if (resolution === undefined) {
    return {
      kind: 'error',
      text: `岗位 ${roleId} 不认识：名册里没有，也不是内置角色（${ROLES.join(' / ')}）；先用 role_draft 起草岗位，或改用内置角色 id`,
    }
  }

  if (target.role === roleId) {
    return {
      kind: 'success',
      text: `${taskId} 已分配给${roleLabel(roleId, resolution)}，无需重复分配；工具面仍按任务状态 ${target.state} 与岗位继承的角色装配`,
    }
  }
  saveTask(root, Task.parse({ ...target, role: roleId }))

  const inheritance = resolution.kind === 'job'
    ? `继承角色 ${resolution.role.inherits}`
    : '按内置角色自身的工具天花板'
  return {
    kind: 'success',
    text: [
      `${taskId} 已分配给${roleLabel(roleId, resolution)}，${inheritance}`,
      `写入 ${taskPath(root, taskId)}；任务状态不由本命令改动，仍在 ${target.state}`,
    ].join('。'),
  }
}

/** 给人看的岗位称呼：自定岗位用显示名，内置角色直接用 id。 */
function roleLabel(id: string, resolution: RoleResolution): string {
  return resolution.kind === 'job' ? `岗位「${resolution.role.name}」（${id}）` : `内置角色 ${resolution.id}`
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
