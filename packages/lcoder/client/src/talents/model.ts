/** 人才库的渲染端数据面：云端响应解析、下发摘要、内置名册与去重计划。 */

import { parse as parseYaml, type ScalarTag } from 'yaml'

/** 云端人才的一行插件。 */
export interface TalentPluginView {
  readonly name: string
  readonly config?: Readonly<Record<string, unknown>>
}

/** 人才默认模型。 */
export interface TalentModelView {
  readonly provider: string
  readonly modelId: string
}

/** 人才单会话预算，单位微美元与请求数。 */
export interface TalentBudgetView {
  readonly maxCostMicroUsd?: number
  readonly maxRequestsPerSession?: number
}

/** 版本化人才配置；只保留宿主与云端都认的字段。 */
export interface TalentConfigView {
  readonly version: number
  readonly basePreset?: string
  readonly persona?: string
  readonly plugins?: readonly TalentPluginView[]
  readonly tools?: readonly string[]
  readonly model?: TalentModelView
  readonly budget?: TalentBudgetView
}

/** 一条云端人才的渲染端形状。 */
export interface TalentRow {
  readonly id: string
  readonly scope: 'global' | 'project'
  readonly projectId: string | null
  readonly ownerUserId: string
  readonly createdBy: 'user' | 'ai'
  readonly name: string
  readonly description: string
  readonly config: TalentConfigView
  readonly revision: number
  /** 当前账号能否改删；云端判定并随每条返回。 */
  readonly canManage: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/** 本机插件候选。 */
export interface TalentCatalogPluginView {
  readonly name: string
  readonly version?: string
}

/** 基础 preset 候选。 */
export interface TalentCatalogPresetView {
  readonly id: string
  readonly name?: string
  readonly isDefault: boolean
  readonly broken?: string
}

/** 表单用的本机清单。 */
export interface TalentCatalogView {
  readonly plugins: readonly TalentCatalogPluginView[]
  readonly presets: readonly TalentCatalogPresetView[]
}

/** 基础 preset 工具面上的一项。 */
export interface TalentToolView {
  readonly name: string
  readonly description: string
}

/** 一个基础 preset 的工具面。 */
export interface TalentPresetToolsView {
  readonly presetId: string
  readonly tools: readonly TalentToolView[]
  readonly broken?: string
}

/** 项目身份查询结果。 */
export interface TalentProjectView {
  /** 查询时的项目根目录；用于丢弃过期的结果。 */
  readonly path: string | null
  readonly projectId: string | null
  readonly state: 'ready' | 'unbound' | 'missing-project' | 'missing-context' | 'invalid'
  readonly detail?: string
}

/**
 * 老项目是否需要自动补写 `projectId`：只有文件已存在且缺字段、并且本次会话还没补过时才补。
 * @param view - 一次只读身份查询的结果。
 * @param attempted - 本进程已尝试补写的项目路径。
 * @returns true 表示应当调用一次 `ensureProjectId`。
 */
export function needsProjectIdFix(
  view: TalentProjectView | null | undefined,
  attempted: ReadonlySet<string>,
): boolean {
  return view !== null && view !== undefined && view.state === 'unbound'
    && view.path !== null && !attempted.has(view.path)
}

/** 下发时提交给宿主的一条人才。 */
export interface TalentApplyRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly config: TalentConfigView
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function configOf(value: unknown): TalentConfigView | undefined {
  if (!isRecord(value) || typeof value.version !== 'number') return undefined
  let plugins: TalentPluginView[] | undefined
  if (value.plugins !== undefined) {
    if (!Array.isArray(value.plugins)) return undefined
    const parsed = value.plugins.flatMap((entry): TalentPluginView[] => {
      if (!isRecord(entry) || typeof entry.name !== 'string') return []
      return [{ name: entry.name, ...isRecord(entry.config) ? { config: entry.config } : {} }]
    })
    if (parsed.length !== value.plugins.length) return undefined
    plugins = parsed
  }
  let tools: string[] | undefined
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools) || !value.tools.every(item => typeof item === 'string')) return undefined
    tools = value.tools.filter((item): item is string => typeof item === 'string')
  }
  const model = isRecord(value.model) && typeof value.model.provider === 'string' && typeof value.model.modelId === 'string'
    ? { provider: value.model.provider, modelId: value.model.modelId }
    : undefined
  if (value.model !== undefined && model === undefined) return undefined
  const budget = isRecord(value.budget)
    ? {
      ...typeof value.budget.maxCostMicroUsd === 'number' ? { maxCostMicroUsd: value.budget.maxCostMicroUsd } : {},
      ...typeof value.budget.maxRequestsPerSession === 'number'
        ? { maxRequestsPerSession: value.budget.maxRequestsPerSession } : {},
    }
    : undefined
  if (value.budget !== undefined && budget === undefined) return undefined
  return {
    version: value.version,
    ...typeof value.basePreset === 'string' ? { basePreset: value.basePreset } : {},
    ...typeof value.persona === 'string' ? { persona: value.persona } : {},
    ...plugins === undefined ? {} : { plugins },
    ...tools === undefined ? {} : { tools },
    ...model === undefined ? {} : { model },
    ...budget === undefined ? {} : { budget },
  }
}

/**
 * 解析一条云端人才；字段不全时返回 undefined，由调用方给出可读失败。
 * @param value - 云端响应里的条目。
 * @returns 渲染端形状。
 */
export function talentOf(value: unknown): TalentRow | undefined {
  if (!isRecord(value)) return undefined
  const config = configOf(value.config)
  const { id, scope, projectId, ownerUserId, createdBy, name, description, revision, canManage, createdAt, updatedAt } = value
  if (typeof id !== 'string' || (scope !== 'global' && scope !== 'project')
    || typeof ownerUserId !== 'string' || (createdBy !== 'user' && createdBy !== 'ai')
    || typeof name !== 'string' || typeof description !== 'string' || config === undefined
    || typeof revision !== 'number' || typeof canManage !== 'boolean'
    || typeof createdAt !== 'string' || typeof updatedAt !== 'string'
    || !(projectId === null || typeof projectId === 'string')) return undefined
  return {
    id, scope, projectId, ownerUserId, createdBy, name, description, config, revision, canManage, createdAt, updatedAt,
  }
}

/**
 * 解析人才列表。
 * @param value - `lcoderCloud/talents` 的 value。
 * @returns 条目；任一条坏掉时返回 undefined。
 */
export function talentsOf(value: unknown): readonly TalentRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined
  const rows = value.items.flatMap((item): TalentRow[] => {
    const row = talentOf(item)
    return row === undefined ? [] : [row]
  })
  return rows.length === value.items.length ? rows : undefined
}

/**
 * 解析本机清单。
 * @param value - `agentTalents/catalog` 的返回值。
 * @returns 清单；结构不符时返回 undefined。
 */
export function catalogOf(value: unknown): TalentCatalogView | undefined {
  if (!isRecord(value) || !Array.isArray(value.plugins) || !Array.isArray(value.presets)) return undefined
  const plugins = value.plugins.flatMap((entry): TalentCatalogPluginView[] => {
    if (!isRecord(entry) || typeof entry.name !== 'string') return []
    return [{ name: entry.name, ...typeof entry.version === 'string' ? { version: entry.version } : {} }]
  })
  const presets = value.presets.flatMap((entry): TalentCatalogPresetView[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return []
    return [{
      id: entry.id,
      ...typeof entry.name === 'string' ? { name: entry.name } : {},
      isDefault: entry.isDefault === true,
      ...typeof entry.broken === 'string' ? { broken: entry.broken } : {},
    }]
  })
  return { plugins, presets }
}

/**
 * 解析工具面。
 * @param value - `agentTalents/presetTools` 的返回值。
 * @returns 工具面；结构不符时返回 undefined。
 */
export function presetToolsOf(value: unknown): TalentPresetToolsView | undefined {
  if (!isRecord(value) || typeof value.presetId !== 'string' || !Array.isArray(value.tools)) return undefined
  const tools = value.tools.flatMap((entry): TalentToolView[] => {
    if (!isRecord(entry) || typeof entry.name !== 'string') return []
    return [{ name: entry.name, description: typeof entry.description === 'string' ? entry.description : '' }]
  })
  return {
    presetId: value.presetId,
    tools,
    ...typeof value.broken === 'string' ? { broken: value.broken } : {},
  }
}

/**
 * 解析项目身份。
 * @param value - `agentTalents/projectIdentity` 或 `ensureProjectId` 的返回值。
 * @param path - 本次查询的项目路径。
 * @returns 带路径的身份结果；结构不符时返回 undefined。
 */
export function projectViewOf(value: unknown, path: string | null): TalentProjectView | undefined {
  if (!isRecord(value) || typeof value.state !== 'string') return undefined
  const state = value.state
  if (state !== 'ready' && state !== 'unbound' && state !== 'missing-project'
    && state !== 'missing-context' && state !== 'invalid') return undefined
  if (!(value.projectId === null || typeof value.projectId === 'string')) return undefined
  return {
    path,
    projectId: value.projectId,
    state,
    ...typeof value.detail === 'string' ? { detail: value.detail } : {},
  }
}

/**
 * 一条人才的下发摘要；配置顺序由解析器固定，重复读同一条人才得到同一个摘要。
 * @param row - 人才行。
 * @returns 稳定摘要。
 */
export function talentDigest(row: TalentRow): string {
  return JSON.stringify({ name: row.name, description: row.description, config: row.config })
}

/**
 * 折算下发请求里的单条人才。
 * @param row - 人才行。
 * @returns `applyTalents` 的条目。
 */
export function applyRowOf(row: TalentRow): TalentApplyRow {
  return { id: row.id, name: row.name, description: row.description, config: row.config }
}

/** 一次同步计划。 */
export interface TalentSyncPlan {
  /** 新增或配置已变、需要下发的条目。 */
  readonly apply: readonly TalentRow[]
  /** 已从云端消失或换库、需要撤回的 id。 */
  readonly remove: readonly string[]
  /** 摘要未变、不需要下发的 id。 */
  readonly unchanged: readonly string[]
}

/**
 * 对比本进程已下发摘要与本次云端列表，给出最小下发计划。
 * @param previous - 已下发摘要。
 * @param rows - 本次云端列表。
 * @returns 下发、撤回与未变动的 id。
 */
export function planSync(previous: ReadonlyMap<string, string>, rows: readonly TalentRow[]): TalentSyncPlan {
  const apply: TalentRow[] = []
  const unchanged: string[] = []
  const wanted = new Set<string>()
  for (const row of rows) {
    wanted.add(row.id)
    if (previous.get(row.id) === talentDigest(row)) unchanged.push(row.id)
    else apply.push(row)
  }
  const remove = [...previous.keys()].filter(id => !wanted.has(id))
  return { apply, remove, unchanged }
}

/**
 * 人才会话的 preset id。
 * @param talentId - 云端人才 id。
 * @returns `talent-<id>`。
 */
export function presetIdOf(talentId: string): string {
  return `talent-${talentId}`
}

/** 一次失败的下发尝试；摘要相同就不再重试同一份定义。 */
export interface TalentApplyFailure {
  readonly digest: string
  readonly message: string
}

/** 下一轮对一条人才的处置。 */
export type TalentAttempt =
  | { readonly kind: 'skip'; readonly message: string }
  | { readonly kind: 'apply'; readonly digest: string }

/**
 * 判断一条待下发人才本轮是否还要调用宿主。
 * @param row - 人才行。
 * @param failed - 已知失败的摘要与原因。
 * @returns 跳过并复用失败原因，或带上本轮摘要去下发。
 */
export function attemptOf(
  row: TalentRow,
  failed: ReadonlyMap<string, TalentApplyFailure>,
): TalentAttempt {
  const digest = talentDigest(row)
  const previous = failed.get(row.id)
  return previous !== undefined && previous.digest === digest
    ? { kind: 'skip', message: previous.message }
    : { kind: 'apply', digest }
}

/** `agentPresets/list` 名册里的一行；只保留人才库展示需要的字段。 */
export interface BuiltinPresetView {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly isDefault: boolean
  /** 激活失败的诊断；能用时缺省。 */
  readonly broken?: string
}

/** 产品内置角色 preset 的前缀；云端人才的 `talent-*` 不在此列。 */
const BUILTIN_PRESET_PREFIX = 'lcoder'

/** 工作台作用域会话的内部 preset；它不是用户可以选用的人才。 */
const WORKBENCH_PRESET_ID = 'lcoder-workbench'

/**
 * 判断一个 preset id 是否属于产品内置角色。
 * @param presetId - 名册里的 preset id。
 * @returns 内置角色为 true；工作台会话壳与上游系统 preset 为 false。
 */
export function isBuiltinTalentPreset(presetId: string): boolean {
  return (presetId === BUILTIN_PRESET_PREFIX || presetId.startsWith(`${BUILTIN_PRESET_PREFIX}-`))
    && presetId !== WORKBENCH_PRESET_ID
}

/**
 * 解析 `agentPresets/list` 的名册。
 * @param value - Remote 返回值。
 * @returns 每一行；结构不符时返回 undefined。
 */
export function presetRosterOf(value: unknown): readonly BuiltinPresetView[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.presets)) return undefined
  const rows = value.presets.flatMap((entry): BuiltinPresetView[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return []
    return [{
      id: entry.id,
      ...typeof entry.name === 'string' ? { name: entry.name } : {},
      ...typeof entry.description === 'string' ? { description: entry.description } : {},
      isDefault: entry.isDefault === true,
      ...typeof entry.broken === 'string' ? { broken: entry.broken } : {},
    }]
  })
  return rows.length === value.presets.length ? rows : undefined
}

/** preset 组合里的一行插件；`!!js` 条件禁用记为 `conditional`。 */
export interface PresetPluginView {
  readonly id?: string
  readonly name: string
  /** 分组行（`cordis:group`）；成员紧随其后。 */
  readonly group: boolean
  readonly disabled: 'no' | 'yes' | 'conditional'
}

/** `agentPresets/read` 的展示面：只取人设与插件组合。 */
export interface PresetDocumentView {
  readonly presetId: string
  readonly persona?: string
  readonly plugins: readonly PresetPluginView[]
}

/** 读组合 YAML 用的方言：`!!js` 标量按表达式保留，不当作错误标签。 */
const JS_EXPR_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: value => ({ jsExpr: value }),
}

function pluginsOf(value: unknown, rows: PresetPluginView[]): void {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== 'string') continue
    const group = entry.group === true || entry.name === 'cordis:group'
    rows.push({
      ...typeof entry.id === 'string' ? { id: entry.id } : {},
      name: entry.name,
      group,
      disabled: entry.disabled === undefined ? 'no' : entry.disabled === true ? 'yes' : 'conditional',
    })
    if (group) pluginsOf(entry.config, rows)
  }
}

function personaOf(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  for (const entry of value) {
    if (!isRecord(entry)) continue
    if (entry.name === '@deepseek-ai/dsh-persona' && isRecord(entry.config)
      && typeof entry.config.prefix === 'string' && entry.config.prefix.trim() !== '') return entry.config.prefix
    const nested = personaOf(entry.config)
    if (nested !== undefined) return nested
  }
  return undefined
}

/**
 * 解析 `agentPresets/read` 的组合内容。
 * @param value - Remote 返回值。
 * @returns 人设与插件行；结构不符或 YAML 读不了时返回 undefined。
 */
export function presetDocumentOf(value: unknown): PresetDocumentView | undefined {
  if (!isRecord(value) || typeof value.agentPreset !== 'string' || typeof value.content !== 'string') return undefined
  let parsed: unknown
  try {
    parsed = parseYaml(value.content, { customTags: [JS_EXPR_TAG] })
  } catch {
    return undefined
  }
  const rows = parsed ?? []
  if (!Array.isArray(rows)) return undefined
  const plugins: PresetPluginView[] = []
  pluginsOf(rows, plugins)
  const persona = personaOf(rows)
  return { presetId: value.agentPreset, ...persona === undefined ? {} : { persona }, plugins }
}

/**
 * 从模块说明里折出包名；相对路径、伪插件与非包名返回 undefined。
 * @param specifier - 组合行里写的模块说明。
 * @returns 包名；判断是否已安装时用它对齐本机清单。
 */
export function pluginPackageOf(specifier: string): string | undefined {
  if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/')
    || specifier.startsWith('\\') || specifier.startsWith('#') || specifier.includes(':')) return undefined
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}
