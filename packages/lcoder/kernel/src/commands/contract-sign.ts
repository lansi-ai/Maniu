/**
 * 人机命令 `contract_sign`：人给契约签字，宿主把签名写进规格库；
 * 以及 AI 自签的内部入口 `selfSignContract`（三补偿闸成立时由流程执行器调用）。
 *
 * 三条理由，决定它是命令而不是工具、由宿主写而不是前端写：
 *   1. **不能是普通工具。** 模型若能在任意时刻调用签署，S1（未签契约不能改代码）当场失效。
 *      AI 自签不是「模型多了一个工具」，而是流程执行器在三闸成立时的一次受控写入：
 *      策略为 auto、任务无可逆项、契约有评审复核证据，缺一不签。
 *   2. **人机命令正好是这一档。** `@deepseek-ai/dsh-commands` 的执行不产生模型消息，
 *      但 `command/run` 与 `command/done` 会进会话日志：人做的动作，留得下证据。
 *   3. **前端不写盘。** `workspaceFiles` 命名空间没有任何改动能力，规格库这个唯一
 *      事实源也只能由 kernel 写；浏览器算哈希还要把 `node:crypto` 带进渲染端。
 *
 * 命令与自签都只写 `sig`，不改任务状态：状态流转仍走 `/task_contract` 或人改 YAML。
 */
import { Contract } from '../schema/spec.js'
import { AUTOMATION_FILE, loadAutomationPolicy } from '../kernel/automation.js'
import { contractPath, loadContractFact, saveContract } from '../kernel/contract.js'
import { hasReviewEvidence, loadEvidence } from '../kernel/evidence-store.js'
import { describeSelfSignFailure, evaluateSelfSignGate } from '../kernel/sign-gate.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertTaskId, loadTask, taskPath } from '../kernel/task-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface SignInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type SignCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface SignCommandDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: SignInvocation) => SignCommandResult
}

/**
 * 建 `contract_sign` 命令定义。
 * @param rootInput - 规格根解析，与工具共用同一条会话来源。
 * @param now - 签署时刻的取值；默认取本机时钟，测试可注入以确定结果。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createContractSignCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): SignCommandDefinition {
  return {
    name: 'contract_sign',
    description: '以人的身份签署指定任务的契约；只有已签署的契约才能动不可逆项',
    input: { hint: '<任务编号>' },
    handler: invocation => signContract(rootInput, invocation, now),
  }
}

/** 签名哈希在回执里的预览长度：够认出是哪一版正文，又不至于刷满一行。 */
const HASH_PREVIEW = 'sha256:'.length + 12

function signContract(rootInput: RootInput, invocation: SignInvocation, now: () => string): SignCommandResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') {
    return { kind: 'error', text: '需要任务编号，例如 /contract_sign T-01' }
  }

  let taskId: string
  try {
    taskId = assertTaskId(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可签署的契约；先用 task_draft 立项` }
  }

  let fact: ReturnType<typeof loadContractFact>
  try {
    fact = loadContractFact(root, taskId)
  } catch (error: unknown) {
    return { kind: 'error', text: `${contractPath(root, taskId)} 读不懂：${errorMessage(error)}` }
  }
  if (fact === null) {
    return { kind: 'error', text: `找不到 ${taskId} 的契约（${contractPath(root, taskId)}）；先用 contract_draft 起草` }
  }

  const { contract, bodyHash } = fact
  const previous = contract.sig
  if (previous !== null && previous.by === 'human' && previous.hash === bodyHash) {
    return { kind: 'error', text: `${taskId} 的契约已在 ${previous.at} 由人签署，无需重复签署` }
  }

  const at = now()
  const path = saveContract(root, Contract.parse({ ...contract, sig: { by: 'human', at, hash: bodyHash } }))
  const notes = [
    `${taskId} 的契约已由人签署于 ${at}，签名覆盖正文 ${bodyHash.slice(0, HASH_PREVIEW)}…`,
    previous === null ? '' : `作废上一份签名（${previous.by} 签于 ${previous.at}）`,
    previous !== null && previous.hash !== bodyHash ? '上一份签的正文与当前不一致，这是一次重签' : '',
    `写入 ${path}；任务状态不由本命令改动，仍在 .spec/tasks/${taskId}.yaml 里由人推进`,
  ]

  return { kind: 'success', text: notes.filter(note => note !== '').join('。') }
}

/** 一次 AI 自签请求：哪条任务、由哪个 preset 发起。 */
export interface SelfSignRequest extends SpecRootContext {
  /** 任务编号。 */
  readonly taskId: string
  /** 具体 preset（如 `maniu-flow`），写进 `sig.actor`。 */
  readonly actor: string
}

/**
 * AI 自签：三补偿闸同时成立时，把 `by: agent` 的签名写进契约。
 *
 * 不注册成命令，也不注册成工具——入口只给流程执行器。签名里必须留下 actor 与
 * 策略授权依据（策略文件名、内容哈希、判定时刻），否则以后没人能解释「这次自签凭什么成立」。
 * @param rootInput - 规格根解析，与命令共用同一条会话来源。
 * @param request - 任务编号、发起自签的 preset 与会话事实。
 * @param now - 签署时刻的取值；默认取本机时钟，测试可注入以确定结果。
 * @returns 成功回执说明签名覆盖的正文与授权依据；任一道闸不成立即拒绝。
 */
export function selfSignContract(
  rootInput: RootInput,
  request: SelfSignRequest,
  now: () => string = () => new Date().toISOString(),
): SignCommandResult {
  const actor = request.actor.trim()
  if (actor === '') return { kind: 'error', text: 'AI 自签必须说明发起的具体 preset（actor）' }

  let taskId: string
  try {
    taskId = assertTaskId(request.taskId.trim())
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, request)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可签署的契约` }
  }

  let task
  try {
    task = loadTask(root, taskId)
  } catch (error: unknown) {
    return { kind: 'error', text: `读不到任务 ${taskId}（${taskPath(root, taskId)}）：${errorMessage(error)}` }
  }

  let policy
  try {
    policy = loadAutomationPolicy(root)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  let fact
  try {
    fact = loadContractFact(root, taskId)
  } catch (error: unknown) {
    return { kind: 'error', text: `${contractPath(root, taskId)} 读不懂：${errorMessage(error)}` }
  }
  if (fact === null) {
    return { kind: 'error', text: `找不到 ${taskId} 的契约（${contractPath(root, taskId)}）；先用 contract_draft 起草` }
  }

  const gate = evaluateSelfSignGate({
    signAuto: policy.policy.actions.sign === 'auto',
    irreversible: task.scope.irreversible,
    reviewEvidence: hasReviewEvidence(loadEvidence(root, taskId)),
  })
  if (!gate.allowed) {
    return {
      kind: 'error',
      text: `拒绝 AI 自签 ${taskId}：${describeSelfSignFailure(gate)}；这三项必须同时成立`,
    }
  }

  // 三闸成立意味着签署为 auto，而 auto 只能来自策略文件：下面两项必不为空。
  if (policy.source !== 'file' || policy.hash === null || policy.at === null) {
    return { kind: 'error', text: `拒绝 AI 自签 ${taskId}：没有可引用的策略文件，无法记录授权依据` }
  }

  const { contract, bodyHash } = fact
  const previous = contract.sig
  if (previous !== null && previous.by === 'agent' && previous.hash === bodyHash) {
    return {
      kind: 'error',
      text: `${taskId} 的契约已在 ${previous.at} 由 AI 自签（${previous.actor ?? '未记 actor'}），无需重复签署`,
    }
  }

  const at = now()
  const path = saveContract(root, Contract.parse({
    ...contract,
    sig: {
      by: 'agent',
      at,
      hash: bodyHash,
      actor,
      authorization: { policy: AUTOMATION_FILE, hash: policy.hash, at: policy.at },
    },
  }))

  return {
    kind: 'success',
    text: [
      `${taskId} 的契约已由 AI 自签（actor ${actor}）于 ${at}，签名覆盖正文 ${bodyHash.slice(0, HASH_PREVIEW)}…`,
      `授权依据：${AUTOMATION_FILE} 的 ${policy.hash.slice(0, HASH_PREVIEW)}…（文件时间 ${policy.at}）`,
      previous === null ? '' : `作废上一份签名（${previous.by} 签于 ${previous.at}）`,
      `写入 ${path}；任务状态不由本函数改动，推进仍走 /task_contract`,
    ].filter(note => note !== '').join('。'),
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
