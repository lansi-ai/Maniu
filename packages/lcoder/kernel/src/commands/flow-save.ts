/**
 * 人机命令 `flow_save`：人写项目的流程配置 `.spec/flow.yaml`。
 *
 * 与 `contract_sign`、`requirement_approve` 同档：人机命令，不进任何角色或状态的
 * 工具面——模型能写流程配置就等于自己挑评审岗位、自己定过审门槛。
 *
 * 两种输入：`/flow_save <json>` 整份写入节点配置（形状与岗位解析由 store 把关）；
 * `/flow_save preset` 删除配置文件，回到内核内置预制流程。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { flowConfigPath, resetFlowConfig, saveFlowConfig } from '../kernel/flow-config.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface FlowSaveInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type FlowSaveResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface FlowSaveDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: FlowSaveInvocation) => FlowSaveResult
}

/**
 * 建 `flow_save` 命令定义。
 * @param rootInput - 规格根解析，与工具和其它命令共用同一条会话来源。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createFlowSaveCommand(rootInput: RootInput): FlowSaveDefinition {
  return {
    name: 'flow_save',
    description: '写入项目流程配置 .spec/flow.yaml（节点岗位与自动衔接），或恢复内置预制流程；只有人能调用',
    input: { hint: '<json> 或 preset' },
    handler: invocation => save(rootInput, invocation),
  }
}

function save(rootInput: RootInput, invocation: FlowSaveInvocation): FlowSaveResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') {
    return { kind: 'error', text: '需要流程配置 JSON（形如 {"nodes":[{"node":"review","roles":["maniu-pm"],"auto":true}]}），或 preset 恢复预制流程' }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可配置的流程` }
  }

  if (raw === 'preset') {
    try {
      const removed = resetFlowConfig(root)
      return {
        kind: 'success',
        text: removed
          ? `已删除 ${flowConfigPath(root)}，流程回到内置预制：立项分析→需求评审（自动衔接）→需求修改→拆分并分配。`
          : '本来就没有流程配置文件，已在内置预制流程上。',
      }
    } catch (error: unknown) {
      return { kind: 'error', text: `恢复预制流程失败：${errorMessage(error)}` }
    }
  }

  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: `流程配置不是能读的 JSON：${errorMessage(error)}` }
  }

  try {
    const saved = saveFlowConfig(root, doc)
    const summary = saved.config.nodes.map(node => `${node.node}[${node.roles.join('、')}]${node.auto ? '自动' : '人工'}`).join('，')
    return { kind: 'success', text: `流程配置已写入 ${saved.path}：${summary}。节点之间仍由人触发。` }
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
