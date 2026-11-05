/**
 * 设置页里「模型服务」的数据面：把 provider 目录、settings 命名空间、凭据状态与
 * 模型目录折成一张行表，并把四项写操作包成可直接调用的回调。
 *
 * 这一层不碰 React，也不拿 ctx：远程面与 schema 读取都从参数进来，所以行表、
 * 状态判定与写入顺序可以被单测钉死，`ModelSettings.tsx` 只剩渲染与草稿。
 *
 * 安全约束：密钥只从输入框流到 `credentials.set`；读回只有 configured 位，
 * 本模块不回显、不记录密钥值。
 */

import type {
  CredentialInfo, LlmConfigurableProvider, LlmDiscoveredModel, LlmModelDiscoveryRequest,
  LlmProviderInfo, ModelCatalog, ModelCatalogModel, SettingsDescribeValue, SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 远程调用的最小结果形状；比 RemoteResult 窄，便于单测直接给对象。 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** 本页用到的远程方法；由装配层从 `ctx.remote` 窄化出来。 */
export interface ModelSettingsRemote {
  listProviders(): Promise<Result<readonly LlmProviderInfo[]>>
  listConfigurableProviders(): Promise<Result<readonly LlmConfigurableProvider[]>>
  describeSettings(): Promise<Result<SettingsDescribeValue>>
  describeCredentials(refs: readonly string[]): Promise<Result<Record<string, CredentialInfo>>>
  setCredential(ref: string, value: string): Promise<Result<void>>
  unsetCredential(ref: string): Promise<Result<void>>
  mutateSettings(ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined): Promise<Result<SettingsNamespaceView>>
  discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest): Promise<Result<readonly LlmDiscoveredModel[]>>
  modelCatalog(): Promise<Result<ModelCatalog>>
  selectModel(request: { sessionId: SessionId; provider: string; model: string }): Promise<Result<unknown>>
}

/** 本页读取协议枚举所需的最小 schema 面。 */
export interface ModelSettingsSchema {
  /**
   * 读一个命名空间声明的协议枚举。
   * @param view - 该命名空间的设置视图。
   * @returns 协议标识，按 schema 顺序；读不到时为空。
   */
  protocols(view: SettingsNamespaceView): readonly string[]
}

/** 行在设置页里的分组。 */
export type ProviderGroup = 'official' | 'other' | 'custom'

/** 一行 provider 的展示与写入地址。 */
export interface ModelProviderRow {
  provider: string
  displayName: string
  group: ProviderGroup
  /** 路由当前已注册；false 表示适配器还没有这个路由。 */
  active: boolean
  /** 适配器目录之外的路线（用户手加）。 */
  declared: boolean
  account: boolean
  settingsNs: string
  settingsPath: readonly string[]
  /** 写这个命名空间要带上的修订号。 */
  revision: number
  defaultBaseURL?: string
  baseURLEnv: readonly string[]
  /** profile 里写的地址覆盖；undefined 表示走默认。 */
  baseURL?: string
  /** profile 里写的协议；手加路线才有。 */
  api?: string
  /** profile 里写的模型 id；手加路线才有。 */
  modelIds: readonly string[]
  /** 目录或组合层为这个路线配了 profile。 */
  profilePresent: boolean
  /** 用户层单独带着这个 profile，删除会回到下层。 */
  removable: boolean
  /** 按钮要写的凭据引用；账户路线没有。 */
  keyRef?: string
  /** profile 命名的引用；没有时可由 keyRef 派生。 */
  apiKeyEnv?: string
  apiKeyConfigured: boolean
  apiKeyWritable: boolean
  /** 本机环境里已有该路线的原生认证。 */
  nativeConfigured: boolean
  /** 该路线原生认证读取的环境变量。 */
  nativeEnv: readonly string[]
  /** 模型目录里这个路线当前可用的模型。 */
  models: readonly ModelCatalogModel[]
  defaultModel?: string
  accountAvailable: boolean
  error?: string
}

/** 一次加载的结果。 */
export interface ModelSettingsSnapshot {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  credentialError: string | null
  writable: boolean
  rows: readonly ModelProviderRow[]
  protocols: readonly string[]
  /** 手加路线写入的命名空间；目录里没有 pi-ai 路线时为空。 */
  piAiNs?: string
  defaultSelection?: { provider: string; model: string }
}

/** 手加 provider 的草稿字段。 */
export interface CustomProviderInput {
  name: string
  protocol: string
  modelIds: readonly string[]
  baseURL: string
  apiKey: string
}

/** 行内高级字段的补丁；`null` 表示清回默认。 */
export interface ProfilePatch {
  baseURL?: string | null
  api?: string
  modelIds?: readonly string[]
}

/** 一次发现模型请求；字段与上游 discoverModels 的请求一致。 */
export interface ModelDiscoveryRequest {
  settingsNs: string
  provider?: string
  baseURL?: string
  api?: string
  apiKey?: string
}

/** 发现模型的结果。 */
export type ModelDiscoveryOutcome =
  | { readonly kind: 'found'; readonly models: readonly LlmDiscoveredModel[] }
  | { readonly kind: 'refused'; readonly message: string }

/** 设置页调用的完整写入面。 */
export interface ModelSettingsFace {
  load(): Promise<ModelSettingsSnapshot>
  saveKey(row: ModelProviderRow, value: string): Promise<string | undefined>
  removeKey(row: ModelProviderRow): Promise<string | undefined>
  saveProfile(row: ModelProviderRow, patch: ProfilePatch): Promise<string | undefined>
  createProvider(input: CustomProviderInput): Promise<string | undefined>
  removeProvider(row: ModelProviderRow): Promise<string | undefined>
  setDefault(sessionId: SessionId, provider: string, model: string): Promise<string | undefined>
  discover(request: ModelDiscoveryRequest): Promise<ModelDiscoveryOutcome>
}

/** 官方路线；排序固定在目录之前。 */
const OFFICIAL = ['deepseek-account', 'deepseek-official'] as const


/** 写设置时把冲突翻成一句人话。 */
const CONFLICT = 'settings/conflict'

/**
 * 派生一个路线的凭据引用名。
 * @param provider - 路线 id，例如 `minimax-cn`。
 * @returns 引用名，例如 `MINIMAX_CN_API_KEY`。
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * 手加路线的名称规则：小写字母开头，只含小写字母、数字与连字符，且连字符
 * 不在首尾、不连续。与上游自定义路线的规则一致，保证它同时能当 settings 键
 * 与凭据引用的词干。
 * @param name - 用户输入的名称。
 * @returns 是否可用。
 */
export function validRouteName(name: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)
}

/**
 * 校验一个 http(s) 地址。
 * @param value - 待校验文本。
 * @returns 是否是可用的端点。
 */
export function validBaseURL(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** 把模型 id 文本折成去重后的非空列表。 */
export function parseModelIds(text: string): string[] {
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n|,/)) {
    const id = line.trim()
    if (id.length > 0) seen.add(id)
  }
  return [...seen]
}

/** 逐层读一个普通对象/数组路径。 */
function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) {
    if (Array.isArray(current)) { current = current[Number(key)]; continue }
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** 逐层判断键是否存在（值可以是 undefined）。 */
function pathExists(value: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return value !== undefined
  const parent = readPath(value, path.slice(0, -1))
  const key = path[path.length - 1] as string
  if (Array.isArray(parent)) return Number(key) < parent.length
  if (typeof parent !== 'object' || parent === null) return false
  return key in parent
}

/** 字符串字段，空串按缺失处理。 */
function stringAt(value: unknown, path: readonly string[]): string | undefined {
  const found = readPath(value, path)
  return typeof found === 'string' && found.length > 0 ? found : undefined
}

/** 读 profile 里的模型 id 列表。 */
function modelIdsAt(value: unknown, path: readonly string[]): string[] {
  const list = readPath(value, path)
  if (!Array.isArray(list)) return []
  return list.flatMap((entry) => {
    const id = typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined
    return typeof id === 'string' && id.length > 0 ? [id] : []
  })
}

/** 目录顺序：账户、官方、其余保持原序。 */
function orderOf(provider: string): number {
  const index = (OFFICIAL as readonly string[]).indexOf(provider)
  return index === -1 ? OFFICIAL.length : index
}

/**
 * 把注册表与可配置目录 join 成行；目录条目在前，只有注册没有目录的路由追加在后。
 * @param registered - 当前已注册的路线。
 * @param directory - 适配器声明的可配置路线。
 * @returns 排序后的路线，账户与官方在前，手加路线在最后。
 */
export function joinDirectory(
  registered: readonly LlmProviderInfo[],
  directory: readonly LlmConfigurableProvider[],
): LlmConfigurableProvider[] {
  const declared = new Set(directory.map(entry => entry.provider))
  const rows = [...directory]
  for (const entry of registered) {
    if (declared.has(entry.id)) continue
    rows.push({
      provider: entry.id,
      displayName: entry.name,
      settingsNs: '',
      settingsPath: [],
    })
  }
  return rows.toSorted((left, right) => orderOf(left.provider) - orderOf(right.provider))
}

/** 一个条目的分组。 */
function groupOf(entry: LlmConfigurableProvider): ProviderGroup {
  if (entry.provider === 'deepseek-account' || entry.provider === 'deepseek-official') return 'official'
  return entry.declared === true ? 'custom' : 'other'
}

/** 一条路由能不能按当前状态服务请求。 */
export function rowUsable(row: ModelProviderRow): boolean {
  if (!row.active) return false
  if (row.account) return row.accountAvailable
  if (row.apiKeyEnv === undefined && (row.nativeConfigured || row.apiKeyConfigured)) return true
  return row.apiKeyConfigured
}

/**
 * 读一次完整快照。
 * @param remote - 本页的远程面。
 * @param schema - 协议枚举读取面。
 * @returns 行表、默认模型与失败信息。
 * @throws 远程调用本身的意外拒绝；业务拒绝写进 error 字段。
 */
export async function loadModelSettings(
  remote: ModelSettingsRemote,
  schema: ModelSettingsSchema,
): Promise<ModelSettingsSnapshot> {
  const [providers, directory, described, catalog] = await Promise.all([
    remote.listProviders(),
    remote.listConfigurableProviders(),
    remote.describeSettings(),
    remote.modelCatalog(),
  ])
  if (!providers.ok) {
    return { status: 'error', error: `${providers.error.code}: ${providers.error.message}`, credentialError: null, writable: false, rows: [], protocols: [] }
  }
  if (!directory.ok) {
    return { status: 'error', error: `${directory.error.code}: ${directory.error.message}`, credentialError: null, writable: false, rows: [], protocols: [] }
  }
  if (!described.ok) {
    return { status: 'error', error: `${described.error.code}: ${described.error.message}`, credentialError: null, writable: false, rows: [], protocols: [] }
  }
  const namespaces = new Map(described.value.namespaces.map(view => [view.ns, view]))
  const catalogGroups = catalog.ok ? catalog.value.groups : []
  const defaultSelection = catalog.ok ? catalog.value.default : undefined
  const accountAvailable = catalogGroups.some(group => group.id === 'deepseek-account' && group.models.length > 0)
  const modelsByProvider = new Map(catalogGroups.map(group => [group.id, group.models]))
  const entries = joinDirectory(providers.value, directory.value)
  const active = new Set(providers.value.map(item => item.id))
  const piAiEntry = entries.find(entry => entry.settingsPath.length > 0 && entry.settingsNs !== '')
  const piAiNs = piAiEntry?.settingsNs
  const protocols = piAiEntry === undefined
    ? []
    : (() => {
      const view = namespaces.get(piAiEntry.settingsNs)
      return view === undefined ? [] : [...schema.protocols(view)]
    })()
  const rows: ModelProviderRow[] = entries.map((entry) => {
    const namespace = namespaces.get(entry.settingsNs)
    const account = entry.provider === 'deepseek-account'
    const profilePresent = namespace !== undefined
      && (entry.settingsPath.length === 0 || readPath(namespace.value, entry.settingsPath) !== undefined)
    const removable = namespace !== undefined
      && entry.settingsPath.length > 0
      && pathExists(namespace.user, entry.settingsPath)
      && !pathExists(namespace.base, entry.settingsPath)
    const apiKeyEnv = account ? undefined : stringAt(namespace?.value, [...entry.settingsPath, 'apiKeyEnv'])
    const keyRef = account || entry.settingsNs === '' ? undefined : apiKeyEnv ?? deriveKeyRef(entry.provider)
    const defaultModel = defaultSelection !== undefined && defaultSelection.provider === entry.provider
      ? defaultSelection.model
      : undefined
    const baseURL = stringAt(namespace?.value, [...entry.settingsPath, 'baseURL'])
    const api = stringAt(namespace?.value, [...entry.settingsPath, 'api'])
    return {
      provider: entry.provider,
      displayName: entry.displayName,
      group: groupOf(entry),
      active: active.has(entry.provider),
      declared: entry.declared === true,
      account,
      settingsNs: entry.settingsNs,
      settingsPath: [...entry.settingsPath],
      revision: namespace?.revision ?? 0,
      ...entry.defaultBaseURL === undefined ? {} : { defaultBaseURL: entry.defaultBaseURL },
      baseURLEnv: [...entry.baseURLEnv ?? []],
      ...baseURL === undefined ? {} : { baseURL },
      ...api === undefined ? {} : { api },
      modelIds: modelIdsAt(namespace?.value, [...entry.settingsPath, 'models']),
      profilePresent,
      removable,
      ...keyRef === undefined ? {} : { keyRef },
      ...apiKeyEnv === undefined ? {} : { apiKeyEnv },
      apiKeyConfigured: false,
      apiKeyWritable: false,
      nativeConfigured: false,
      nativeEnv: [...entry.nativeAuth?.env ?? []],
      models: modelsByProvider.get(entry.provider) ?? [],
      ...defaultModel === undefined ? {} : { defaultModel },
      accountAvailable,
      ...entry.error === undefined ? {} : { error: entry.error },
    }
  })
  const refs = [...new Set(rows.flatMap((row) => {
    if (row.account) return []
    const named = row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv]
    return [...named, ...row.nativeEnv, row.keyRef ?? deriveKeyRef(row.provider)]
  }))]
  const credentials: Record<string, CredentialInfo> = {}
  let credentialError: string | null = null
  for (let index = 0; index < refs.length; index += 64) {
    const response = await remote.describeCredentials(refs.slice(index, index + 64))
    if (!response.ok) { credentialError = `${response.error.code}: ${response.error.message}`; break }
    Object.assign(credentials, response.value)
  }
  for (const row of rows) {
    if (row.account) continue
    const info = credentials[row.keyRef ?? deriveKeyRef(row.provider)]
    row.apiKeyConfigured = info?.configured === true
    row.apiKeyWritable = info?.writable === true
    row.nativeConfigured = row.nativeEnv.some(ref => credentials[ref]?.configured === true)
  }
  return {
    status: 'ready',
    error: null,
    credentialError,
    writable: described.value.writable,
    rows,
    protocols,
    ...piAiNs === undefined ? {} : { piAiNs },
    ...defaultSelection === undefined ? {} : { defaultSelection: { provider: defaultSelection.provider, model: defaultSelection.model } },
  }
}

/** 设置写失败时给出可直接显示的文本。 */
function writeFailure(error: { code: string; message: string }): string {
  return error.code === CONFLICT ? CONFLICT : error.message
}

/**
 * 把装配层的 ctx.remote 收成本页的写面。
 * @param remote - 远程面。
 * @param schema - 协议枚举读取面。
 * @returns 设置页可调用的回调。
 */
export function createModelSettingsFace(remote: ModelSettingsRemote, schema: ModelSettingsSchema): ModelSettingsFace {
  const load = (): Promise<ModelSettingsSnapshot> => loadModelSettings(remote, schema)
  return {
    load,
    async saveKey(row, value) {
      if (row.keyRef === undefined) return undefined
      const typed = value.trim()
      if (typed.length === 0) return undefined
      if (row.apiKeyEnv === undefined && row.settingsPath.length > 0 && row.settingsNs !== '') {
        const written = await remote.mutateSettings(
          row.settingsNs,
          [{ op: 'set', path: [...row.settingsPath, 'apiKeyEnv'], value: row.keyRef }],
          row.revision,
        )
        if (!written.ok) return writeFailure(written.error)
      }
      const stored = await remote.setCredential(row.keyRef, typed)
      return stored.ok ? undefined : stored.error.message
    },
    async removeKey(row) {
      if (row.keyRef === undefined) return undefined
      const removed = await remote.unsetCredential(row.keyRef)
      return removed.ok ? undefined : removed.error.message
    },
    async saveProfile(row, patch) {
      if (row.settingsNs === '') return undefined
      const ops: SettingsPathOpView[] = []
      if (patch.baseURL !== undefined) {
        const path = [...row.settingsPath, 'baseURL']
        const value = patch.baseURL === null ? '' : patch.baseURL.trim()
        ops.push(value.length === 0 ? { op: 'unset', path } : { op: 'set', path, value })
      }
      if (patch.api !== undefined) {
        ops.push({ op: 'set', path: [...row.settingsPath, 'api'], value: patch.api })
      }
      if (patch.modelIds !== undefined) {
        ops.push({ op: 'set', path: [...row.settingsPath, 'models'], value: patch.modelIds.map(id => ({ id })) })
      }
      if (ops.length === 0) return undefined
      const written = await remote.mutateSettings(row.settingsNs, ops, row.revision)
      return written.ok ? undefined : writeFailure(written.error)
    },
    async createProvider(input) {
      const name = input.name.trim()
      if (!validRouteName(name)) return 'invalid-name'
      if (input.modelIds.length === 0) return 'no-models'
      const baseURL = input.baseURL.trim()
      if (!validBaseURL(baseURL)) return 'bad-base-url'
      const described = await remote.describeSettings()
      if (!described.ok) return described.error.message
      const directory = await remote.listConfigurableProviders()
      if (!directory.ok) return directory.error.message
      const entry = directory.value.find(item => item.settingsPath.length > 0)
      const namespace = entry === undefined ? undefined : described.value.namespaces.find(view => view.ns === entry.settingsNs)
      if (entry === undefined || namespace === undefined) return 'no-namespace'
      if (directory.value.some(item => item.provider === name)) return 'name-taken'
      const keyRef = deriveKeyRef(name)
      const profile = {
        ...input.apiKey.trim().length === 0 ? {} : { apiKeyEnv: keyRef },
        api: input.protocol,
        baseURL,
        models: input.modelIds.map(id => ({ id })),
      }
      const written = await remote.mutateSettings(
        entry.settingsNs,
        [{ op: 'set', path: ['providers', name], value: profile }],
        namespace.revision,
      )
      if (!written.ok) return writeFailure(written.error)
      if (input.apiKey.trim().length === 0) return undefined
      const stored = await remote.setCredential(keyRef, input.apiKey.trim())
      return stored.ok ? undefined : stored.error.message
    },
    async removeProvider(row) {
      if (row.settingsNs === '' || row.settingsPath.length === 0) return undefined
      if (row.keyRef !== undefined && row.apiKeyConfigured) {
        const removed = await remote.unsetCredential(row.keyRef)
        if (!removed.ok) return removed.error.message
      }
      const written = await remote.mutateSettings(
        row.settingsNs,
        [{ op: 'unset', path: [...row.settingsPath] }],
        row.revision,
      )
      return written.ok ? undefined : writeFailure(written.error)
    },
    async setDefault(sessionId, provider, model) {
      const selected = await remote.selectModel({ sessionId, provider, model })
      return selected.ok ? undefined : selected.error.message
    },
    async discover(request) {
      const response = await remote.discoverModels(request.settingsNs, {
        ...request.provider === undefined ? {} : { provider: request.provider },
        ...request.baseURL === undefined || request.baseURL.length === 0 ? {} : { baseURL: request.baseURL },
        ...request.api === undefined ? {} : { api: request.api },
        ...request.apiKey === undefined || request.apiKey.length === 0 ? {} : { apiKey: request.apiKey },
      })
      return response.ok ? { kind: 'found', models: response.value } : { kind: 'refused', message: response.error.message }
    },
  }
}
