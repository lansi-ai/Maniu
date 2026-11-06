/**
 * 人机命令 `agent_bind`：把常驻调度会话号写回 `.spec/agents.yaml`。
 *
 * 两个调度角色（智能调度、流程控制）每个仓库只有一条会话；会话号与 `Task.session`
 * 同口径，是宿主 home 里的运行时标识。失效时界面会重新找一条同 preset 的会话或新建，
 * 再通过这条命令写回——浏览器不写规格库，写盘只走 kernel。
 *
 * 与 `task_bind` 同档：人机命令，不进任何角色的工具面；它不改任务状态。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { AgentsRegistry } from '../schema/spec.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'

/** 两个常驻角色；键名与 `.spec/agents.yaml` 的字段一一对应。 */
const ROLES = {
  scheduler: 'schedulerSession',
  flow: 'flowSession',
} as const

type AgentRole = keyof typeof ROLES

/** 会话号的形态：宿主给出的是 UUID 一类标识，只接受 ASCII 字母、数字与连字符。 */
const SESSION_ID = /^[A-Za-z0-9-]{1,200}$/u

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface AgentBindInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type AgentBindCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface AgentBindCommandDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: AgentBindInvocation) => AgentBindCommandResult
}

/**
 * 建 `agent_bind` 命令定义。
 * @param rootInput - 规格根解析，与工具和另外几条命令共用同一条会话来源。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createAgentBindCommand(rootInput: RootInput): AgentBindCommandDefinition {
  return {
    name: 'agent_bind',
    description: '把常驻调度会话号写回 .spec/agents.yaml（智能调度或流程控制）',
    input: { hint: '<scheduler|flow> <会话号>' },
    handler: invocation => bind(rootInput, invocation),
  }
}

function bind(rootInput: RootInput, invocation: AgentBindInvocation): AgentBindCommandResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要角色与会话号，例如 /agent_bind scheduler <会话号>' }
  const split = raw.search(/\s/u)
  if (split <= 0) return { kind: 'error', text: '会话号缺失：角色之后还要跟一个会话号' }

  const roleArg = raw.slice(0, split)
  const sessionId = raw.slice(split).trim()
  if (!isRole(roleArg)) return { kind: 'error', text: `未知常驻角色：${roleArg}（可用 scheduler / flow）` }
  if (!SESSION_ID.test(sessionId)) return { kind: 'error', text: `会话号形态不对：${sessionId}` }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可登记的会话` }
  }

  const path = `${root}/agents.yaml`
  let current: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      const doc: unknown = parseYaml(readFileSync(path, 'utf8'))
      if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
        // 原样保留键：schema 是 strict 的，多出来的键要在下面 parse 时炸出来，
        // 不能被这里悄悄过滤掉后覆盖写。
        current = doc as Record<string, unknown>
      } else {
        return { kind: 'error', text: `${path} 不是能读的对象，拒绝在它上面覆盖写` }
      }
    } catch (error: unknown) {
      return { kind: 'error', text: `${path} 读不懂，拒绝在它上面覆盖写：${errorMessage(error)}` }
    }
  }

  const key = ROLES[roleArg]
  if (current[key] === sessionId) {
    return { kind: 'success', text: `${roleArg} 已是会话 ${sessionId}，无需重复写入（${path}）` }
  }
  let next: AgentsRegistry
  try {
    next = AgentsRegistry.parse({ ...current, [key]: sessionId })
  } catch (error: unknown) {
    return { kind: 'error', text: `${path} 里有不认识的键或值，拒绝覆盖写：${errorMessage(error)}` }
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, stringifyYaml(next), 'utf8')
  } catch (error: unknown) {
    return { kind: 'error', text: `会话号写不进去（${path}）：${errorMessage(error)}` }
  }

  const other = roleArg === 'scheduler' ? 'flowSession' : 'schedulerSession'
  return {
    kind: 'success',
    text: `已把 ${roleArg} 的会话写成 ${sessionId}（${path}）${next[other] === undefined ? '' : `；另一条常驻会话仍是 ${next[other]}`}`,
  }
}

function isRole(value: string): value is AgentRole {
  return value === 'scheduler' || value === 'flow'
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
