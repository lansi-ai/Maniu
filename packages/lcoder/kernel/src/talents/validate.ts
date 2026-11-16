/**
 * 人才输入的 wire 边界校验。
 *
 * 客户端提交的是云端读来的 JSON；这里按 LCoder-cloud 的配置契约再做一次
 * 结构校验，并额外拒绝 `__jsExpr` 标记与非 JSON 值，确保进入 preset 组合的
 * 只有静态数据。插件是否已安装由服务层查宿主清单，不在本模块判断。
 */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  TalentApplyRequest, TalentBudgetInput, TalentConfigInput, TalentDeferredField, TalentModelInput, TalentPluginInput,
} from './types.ts'

/** 动态 preset id 前缀；`talent-<云端 id>`。 */
export const TALENT_PRESET_PREFIX = 'talent-'

const TALENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u
const PRESET_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const PLUGIN_NAME = /^[a-z0-9@][a-z0-9@._/-]{0,127}$/u
const TOOL_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:@/-]{0,127}$/u
const MODEL_PROVIDER = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const JSON_DEPTH_MAX = 32
const TALENTS_MAX = 128
const PLUGINS_MAX = 64
const TOOLS_MAX = 128
const PERSONA_MAX = 20_000
const NAME_MAX = 80
const DESCRIPTION_MAX = 2_000

/** 一条通过结构校验的人才。 */
export interface ValidatedTalent {
  /** 云端人才 id。 */
  readonly talentId: string
  /** 注册进 roaster 的 preset id。 */
  readonly presetId: string
  /** 显示名。 */
  readonly name?: string
  /** 描述。 */
  readonly description?: string
  /** 已规范化的版本化配置。 */
  readonly config: TalentConfigInput
}

/** 通过结构校验的整批人才。 */
export interface ValidatedSelection {
  /** 按提交顺序排列的人才。 */
  readonly talents: readonly ValidatedTalent[]
}

/**
 * 拼出稳定 preset id。
 * @param talentId - 云端人才 id。
 * @returns `talent-<id>`。
 */
export function presetIdOf(talentId: string): string {
  return `${TALENT_PRESET_PREFIX}${talentId}`
}

/**
 * 从 preset id 折回云端人才 id。
 * @param presetId - preset id。
 * @returns 云端人才 id；不是动态 preset 时为 undefined。
 */
export function talentIdOfPreset(presetId: string): string | undefined {
  if (!presetId.startsWith(TALENT_PRESET_PREFIX)) return undefined
  const id = presetId.slice(TALENT_PRESET_PREFIX.length)
  return TALENT_ID.test(id) ? id : undefined
}

/**
 * 列出已通过校验、但本阶段没有运行时语义的配置字段。
 * @param config - 人才配置。
 * @returns 出现的字段名，按固定顺序。
 */
export function deferredFields(config: TalentConfigInput): TalentDeferredField[] {
  const fields: TalentDeferredField[] = []
  if (config.tools !== undefined) fields.push('tools')
  if (config.model !== undefined) fields.push('model')
  if (config.budget !== undefined) fields.push('budget')
  return fields
}

function invalid(talentId: string, reason: string): RemoteError {
  return invalidTalent(talentId, reason)
}

/**
 * 构造一条可解释的人才校验失败。
 * @param talentId - 出问题的人才 id；请求级失败用空串。
 * @param reason - 具体原因。
 * @returns `agent-talent/invalid`。
 */
export function invalidTalent(talentId: string, reason: string): RemoteError {
  return new RemoteError('agent-talent/invalid', talentId === '' ? reason : `Talent ${talentId}: ${reason}`,
    { talentId, reason })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function requireRecord(value: unknown, talentId: string, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(talentId, `${path} must be a JSON object`)
  return value
}

function rejectUnknownKeys(value: Record<string, unknown>, talentId: string, path: string, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw invalid(talentId, `${path}.${key} is not supported; talents may only name a locally installed plugin and its static config`)
    }
  }
}

/**
 * 校验值只由 JSON 标量与普通对象/数组组成，并返回脱离原引用的副本。
 * @param value - 待校验值。
 * @param talentId - 诊断用的人才 id。
 * @param path - 诊断路径。
 * @param depth - 当前深度。
 * @returns 静态 JSON 副本。
 * @throws {RemoteError} `agent-talent/invalid`，指出非 JSON 值或 `!!js` 标记的位置。
 */
export function toStaticJson(value: unknown, talentId: string, path: string, depth = 0): JsonValue {
  if (depth > JSON_DEPTH_MAX) throw invalid(talentId, `${path} nests deeper than ${String(JSON_DEPTH_MAX)} levels`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(talentId, `${path} must be a finite number`)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toStaticJson(item, talentId, `${path}[${String(index)}]`, depth + 1))
  }
  if (!isRecord(value)) throw invalid(talentId, `${path} must contain only static JSON values`)
  return toStaticJsonObject(value, talentId, path, depth)
}

function toStaticJsonObject(
  value: Record<string, unknown>, talentId: string, path: string, depth = 0,
): Readonly<Record<string, JsonValue>> {
  const result: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '__jsExpr') throw invalid(talentId, `${path} must not contain a !!js expression`)
    result[key] = toStaticJson(item, talentId, `${path}.${key}`, depth + 1)
  }
  return result
}

function validateOptionalString(
  value: Record<string, unknown>, key: string, talentId: string, path: string, max: number,
): string | undefined {
  const raw = value[key]
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') throw invalid(talentId, `${path}.${key} must be a string`)
  if (raw.length > max) throw invalid(talentId, `${path}.${key} must be at most ${String(max)} characters`)
  return raw
}

function validatePlugins(raw: unknown, talentId: string): readonly TalentPluginInput[] {
  if (!Array.isArray(raw)) throw invalid(talentId, 'config.plugins must be an array')
  if (raw.length > PLUGINS_MAX) throw invalid(talentId, `config.plugins must contain at most ${String(PLUGINS_MAX)} entries`)
  const seen = new Set<string>()
  return raw.map((entry, index) => {
    const path = `config.plugins[${String(index)}]`
    const plugin = requireRecord(entry, talentId, path)
    rejectUnknownKeys(plugin, talentId, path, ['name', 'config'])
    const name = plugin.name
    if (typeof name !== 'string' || !PLUGIN_NAME.test(name)) {
      throw invalid(talentId, `${path}.name must be a locally installed plugin name`)
    }
    if (seen.has(name)) throw invalid(talentId, `${path}.name repeats "${name}"`)
    seen.add(name)
    if (plugin.config === undefined) return { name }
    const config = requireRecord(plugin.config, talentId, `${path}.config`)
    return { name, config: toStaticJsonObject(config, talentId, `${path}.config`) }
  })
}

function validateTools(raw: unknown, talentId: string): readonly string[] {
  if (!Array.isArray(raw)) throw invalid(talentId, 'config.tools must be an array')
  if (raw.length > TOOLS_MAX) throw invalid(talentId, `config.tools must contain at most ${String(TOOLS_MAX)} entries`)
  return raw.map((entry, index) => {
    if (typeof entry !== 'string' || !TOOL_NAME.test(entry)) {
      throw invalid(talentId, `config.tools[${String(index)}] must be a tool name`)
    }
    return entry
  })
}

function validateModel(raw: unknown, talentId: string): TalentModelInput {
  const model = requireRecord(raw, talentId, 'config.model')
  rejectUnknownKeys(model, talentId, 'config.model', ['provider', 'modelId'])
  const provider = model.provider
  const modelId = model.modelId
  if (typeof provider !== 'string' || !MODEL_PROVIDER.test(provider)) {
    throw invalid(talentId, 'config.model.provider must be a provider id')
  }
  if (typeof modelId !== 'string' || !MODEL_ID.test(modelId)) {
    throw invalid(talentId, 'config.model.modelId must be a model id')
  }
  return { provider, modelId }
}

function validateBudget(raw: unknown, talentId: string): TalentBudgetInput {
  const budget = requireRecord(raw, talentId, 'config.budget')
  rejectUnknownKeys(budget, talentId, 'config.budget', ['maxCostMicroUsd', 'maxRequestsPerSession'])
  const cost = budget.maxCostMicroUsd
  const requests = budget.maxRequestsPerSession
  if (cost === undefined && requests === undefined) {
    throw invalid(talentId, 'config.budget must declare maxCostMicroUsd or maxRequestsPerSession')
  }
  if (cost !== undefined && (typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost < 0)) {
    throw invalid(talentId, 'config.budget.maxCostMicroUsd must be a non-negative integer')
  }
  if (requests !== undefined && (typeof requests !== 'number' || !Number.isSafeInteger(requests) || requests < 1)) {
    throw invalid(talentId, 'config.budget.maxRequestsPerSession must be a positive integer')
  }
  return {
    ...cost === undefined ? {} : { maxCostMicroUsd: cost },
    ...requests === undefined ? {} : { maxRequestsPerSession: requests },
  }
}

function validateConfig(raw: unknown, talentId: string): TalentConfigInput {
  const config = requireRecord(raw, talentId, 'config')
  rejectUnknownKeys(config, talentId, 'config', ['version', 'basePreset', 'persona', 'plugins', 'tools', 'model', 'budget'])
  if (config.version !== 1) throw invalid(talentId, 'config.version must be 1')
  const basePreset = config.basePreset
  if (basePreset !== undefined && (typeof basePreset !== 'string' || !PRESET_ID.test(basePreset))) {
    throw invalid(talentId, 'config.basePreset must be a preset id')
  }
  const persona = validateOptionalString(config, 'persona', talentId, 'config', PERSONA_MAX)
  const validated: TalentConfigInput = {
    version: 1,
    ...basePreset === undefined ? {} : { basePreset },
    ...persona === undefined ? {} : { persona },
    ...config.plugins === undefined ? {} : { plugins: validatePlugins(config.plugins, talentId) },
    ...config.tools === undefined ? {} : { tools: validateTools(config.tools, talentId) },
    ...config.model === undefined ? {} : { model: validateModel(config.model, talentId) },
    ...config.budget === undefined ? {} : { budget: validateBudget(config.budget, talentId) },
  }
  return validated
}

function validateTalent(raw: unknown): ValidatedTalent {
  if (!isRecord(raw)) throw new RemoteError('agent-talent/invalid', 'Each talent must be a JSON object',
    { talentId: '', reason: 'talent entry is not an object' })
  const id = raw.id
  if (typeof id !== 'string' || !TALENT_ID.test(id)) {
    throw new RemoteError('agent-talent/invalid', 'Talent id must be 1-64 characters of letters, digits, dot, dash, or underscore',
      { talentId: typeof id === 'string' ? id : '', reason: 'invalid talent id' })
  }
  rejectUnknownKeys(raw, id, 'talent', ['id', 'name', 'description', 'config'])
  const name = validateOptionalString(raw, 'name', id, 'talent', NAME_MAX)
  const description = validateOptionalString(raw, 'description', id, 'talent', DESCRIPTION_MAX)
  const config = validateConfig(raw.config, id)
  const presetId = presetIdOf(id)
  if (config.basePreset === presetId) throw invalid(id, 'config.basePreset must not name the talent itself')
  return {
    talentId: id,
    presetId,
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    config,
  }
}

/**
 * 校验客户端提交的整批人才。
 * @param request - Remote 收到的请求。
 * @returns 通过校验的人才，保持提交顺序。
 * @throws {RemoteError} `agent-talent/invalid`，消息指明具体字段。
 */
export function validateApplyRequest(request: TalentApplyRequest): ValidatedSelection {
  const raw: unknown = request
  if (!isRecord(raw)) {
    throw new RemoteError('agent-talent/invalid', 'The request must be a JSON object', { talentId: '', reason: 'request is not an object' })
  }
  rejectUnknownKeys(raw, '', 'request', ['talents'])
  if (!Array.isArray(raw.talents)) {
    throw new RemoteError('agent-talent/invalid', 'request.talents must be an array', { talentId: '', reason: 'talents is not an array' })
  }
  if (raw.talents.length > TALENTS_MAX) {
    throw new RemoteError('agent-talent/invalid', `request.talents must contain at most ${String(TALENTS_MAX)} entries`,
      { talentId: '', reason: 'too many talents' })
  }
  const seen = new Set<string>()
  const entries: unknown[] = raw.talents
  const talents = entries.map((entry) => {
    const talent = validateTalent(entry)
    if (seen.has(talent.talentId)) throw invalid(talent.talentId, 'appears more than once in the submission')
    seen.add(talent.talentId)
    return talent
  })
  return { talents }
}
