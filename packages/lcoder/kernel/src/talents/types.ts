/**
 * 人才库宿主动态 preset 的传输类型与错误码。
 *
 * 云端的人才配置是一份版本化的静态 JSON；宿主只把它注册成运行时的
 * agent preset，不拉云端、不写云端。字段口径与 LCoder-cloud 的
 * `TalentConfig` 一致，宿主侧再做一次结构校验，因为这是 wire 边界。
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** 人才引用的一行本机已安装插件。 */
export interface TalentPluginInput {
  /** 本机已安装插件的包名。 */
  readonly name: string
  /** 插件自身定义的静态配置对象。 */
  readonly config?: Readonly<Record<string, JsonValue>>
}

/** 人才使用的模型路由。 */
export interface TalentModelInput {
  /** 已注册的模型 provider。 */
  readonly provider: string
  /** provider 内的模型 id。 */
  readonly modelId: string
}

/** 人才的单会话预算；网关按会话硬限。 */
export interface TalentBudgetInput {
  /** 单会话成本上限，微美元。 */
  readonly maxCostMicroUsd?: number
  /** 单会话模型请求上限。 */
  readonly maxRequestsPerSession?: number
}

/** 云端人才配置（版本 1）。 */
export interface TalentConfigInput {
  /** 配置结构版本；当前只接受 1。 */
  readonly version: number
  /** 继承的基础 preset id。 */
  readonly basePreset?: string
  /** 人才自带的人设提示。 */
  readonly persona?: string
  /** 追加或覆盖到基础 preset 的插件行。 */
  readonly plugins?: readonly TalentPluginInput[]
  /** 工具白名单；只列出的工具可见，空列表与缺省都不限制。 */
  readonly tools?: readonly string[]
  /** 人才默认模型；写入新会话的模型选择。 */
  readonly model?: TalentModelInput
  /** 人才的单会话预算；宿主随模型请求带给云端网关。 */
  readonly budget?: TalentBudgetInput
}

/** 客户端提交的一条人才。 */
export interface TalentInput {
  /** 云端人才 id；宿主拼成 `talent-<id>` 作为 preset id。 */
  readonly id: string
  /** 人才显示名。 */
  readonly name?: string
  /** 一句话描述。 */
  readonly description?: string
  /** 版本化配置。 */
  readonly config: TalentConfigInput
}

/** 应用/替换人才列表的请求。 */
export interface TalentApplyRequest {
  /** 本次要应用或替换的人才；未出现的已应用人才保持不变。 */
  readonly talents: readonly TalentInput[]
}

/** 一条已应用人才的登记结果。 */
export interface TalentApplied {
  /** 云端人才 id。 */
  readonly talentId: string
  /** 注册进 roaster 的 preset id。 */
  readonly presetId: string
  /** 继承的基础 preset，未继承时为 null。 */
  readonly basePreset: string | null
  /** 是否替换了同 id 的旧定义。 */
  readonly replaced: boolean
}

/** 应用结果。 */
export interface TalentApplyResult {
  /** 本次实际注册或替换的人才。 */
  readonly applied: readonly TalentApplied[]
  /** 配置与已登记版本完全相同、未重新挂载的人才。 */
  readonly skipped: readonly string[]
}

/** 撤回一条人才的结果。 */
export interface TalentRemoved {
  /** 云端人才 id。 */
  readonly talentId: string
  /** 已注销的 preset id。 */
  readonly presetId: string
}

/** 一条人才的会话引用。 */
export interface TalentSessionRef {
  /** 云端人才 id。 */
  readonly talentId: string
  /** 对应 preset id。 */
  readonly presetId: string
  /** 当前使用该 preset 的本机会话 id。 */
  readonly sessionIds: readonly string[]
}

/** 一个可选的本机插件包。 */
export interface TalentCatalogPlugin {
  /** 包名；提交进人才 `config.plugins[].name`。 */
  readonly name: string
  /** 本机包清单里声明的版本；无版本字段时缺省。 */
  readonly version?: string
}

/** 一个可作为基础 preset 的声明。 */
export interface TalentCatalogPreset {
  /** preset id。 */
  readonly id: string
  /** 显示名。 */
  readonly name?: string
  /** 是否为新会话的默认 preset。 */
  readonly isDefault: boolean
  /** 激活失败的诊断；能用时缺省。 */
  readonly broken?: string
}

/** 表单需要的本机只读清单。 */
export interface TalentCatalog {
  /** 本机可解析的插件包，按包名排序。 */
  readonly plugins: readonly TalentCatalogPlugin[]
  /** 可作为基础 preset 的声明；不含 `talent-` 动态预设。 */
  readonly presets: readonly TalentCatalogPreset[]
}

/** 基础 preset 工具面上的一个工具。 */
export interface TalentCatalogTool {
  /** 模型看到的工具名；白名单写这个值。 */
  readonly name: string
  /** 工具说明。 */
  readonly description: string
}

/** 一个基础 preset 的工具面。 */
export interface TalentPresetTools {
  /** 查询的 preset id。 */
  readonly presetId: string
  /** 工具面；激活失败时为空。 */
  readonly tools: readonly TalentCatalogTool[]
  /** preset 不可用的原因；可用时缺省。 */
  readonly broken?: string
}

/** 项目身份查询的上下文：项目工作区路径优先，其次会话 cwd。 */
export interface TalentProjectInput {
  /** 项目根目录（`.spec` 的父目录）。 */
  readonly path?: string
  /** 作用域会话 id；没有路径时用它取 `header.cwd`。 */
  readonly sessionId?: string
}

/** 项目身份的三种可解释结果。 */
export type TalentProjectState = 'ready' | 'unbound' | 'missing-project' | 'missing-context' | 'invalid'

/** 当前项目的稳定身份。 */
export interface TalentProjectIdentity {
  /** 已登记的 UUID；未登记或读取失败时为 null。 */
  readonly projectId: string | null
  /** 结果分支。 */
  readonly state: TalentProjectState
  /** 诊断用的人话；ready 时缺省。 */
  readonly detail?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** 人才输入不符合本地契约。 */
    'agent-talent/invalid': { readonly talentId: string; readonly reason: string }
    /** 人才引用了本机未安装的插件。 */
    'agent-talent/unknown-plugin': { readonly talentId: string; readonly plugin: string }
    /** 人才给宿主根组合已挂载的插件另配了一份配置，无法安全合并。 */
    'agent-talent/duplicate-plugin': { readonly talentId: string; readonly plugin: string }
    /** 白名单里的工具不在该 preset 的工具面上。 */
    'agent-talent/unknown-tool': { readonly talentId: string; readonly tools: readonly string[] }
    /** 目标 preset id 已被非动态定义占用。 */
    'agent-talent/reserved': { readonly talentId: string; readonly presetId: string }
    /** 本进程没有登记该人才。 */
    'agent-talent/not-found': { readonly talentId: string }
    /** 仍有本机会话引用该人才，拒绝撤回。 */
    'agent-talent/referenced': { readonly talentId: string; readonly sessions: readonly string[] }
  }
}
