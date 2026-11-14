/** 设置页的模型数据面：provider 目录、设置命名空间、密钥三态与模型目录。 */

import type { MessageKey } from '../locale.ts'

/** 一次远程调用的结果；业务失败也落在结果里。 */
type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** 一个 provider 的模型。 */
export interface ModelRow {
  readonly id: string
  readonly name: string
}

/** 一个可配置 provider 的展示与写入地址。 */
export interface ProviderRow {
  readonly provider: string
  readonly displayName: string
  readonly group: 'official' | 'other' | 'custom'
  readonly active: boolean
  readonly declared: boolean
  readonly account: boolean
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly revision: number
  readonly keyRef?: string
  readonly apiKeyEnv?: string
  readonly keyConfigured: boolean
  readonly keyWritable: boolean
  readonly nativeConfigured: boolean
  readonly models: readonly ModelRow[]
  readonly defaultModel?: string
  readonly error?: string
}

/** 一次加载的结果。 */
export interface ModelSnapshot {
  readonly status: 'ready' | 'error'
  readonly error: string | null
  readonly credentialError: string | null
  readonly writable: boolean
  readonly rows: readonly ProviderRow[]
  readonly defaultSelection?: { readonly provider: string; readonly model: string }
}

/** 一次默认模型写入的结果。 */
export interface DefaultWrite {
  readonly error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
}

/**
 * 派生一个路线的凭据引用名。
 * @param provider - 路线 id，例如 `minimax-cn`。
 * @returns 引用名，例如 `MINIMAX_CN_API_KEY`。
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** 远端目录条目。 */
interface DirectoryEntry {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly declared: boolean
  readonly nativeEnv: readonly string[]
  readonly error?: string
}

/** 一个设置命名空间的最小视图。 */
interface NamespaceView {
  readonly ns: string
  readonly value: unknown
  readonly revision: number
}

function directoryOf(value: unknown): DirectoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): DirectoryEntry[] => {
    if (!isRecord(entry) || typeof entry.provider !== 'string') return []
    const nativeAuth = isRecord(entry.nativeAuth) ? entry.nativeAuth : undefined
    return [{
      provider: entry.provider,
      displayName: typeof entry.displayName === 'string' ? entry.displayName : entry.provider,
      settingsNs: typeof entry.settingsNs === 'string' ? entry.settingsNs : '',
      settingsPath: stringsOf(entry.settingsPath),
      declared: entry.declared === true,
      nativeEnv: nativeAuth === undefined ? [] : stringsOf(nativeAuth.env),
      ...stringOf(entry.error) === undefined ? {} : { error: entry.error as string },
    }]
  })
}

function providersOf(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => isRecord(entry) && typeof entry.id === 'string'
    ? [{ id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id }]
    : [])
}

function namespacesOf(value: unknown): NamespaceView[] {
  if (!isRecord(value) || !Array.isArray(value.namespaces)) return []
  return value.namespaces.flatMap(entry => isRecord(entry) && typeof entry.ns === 'string'
    ? [{ ns: entry.ns, value: entry.value, revision: typeof entry.revision === 'number' ? entry.revision : 0 }]
    : [])
}

/** 逐层读一个对象/数组路径。 */
function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) {
    if (Array.isArray(current)) { current = current[Number(key)]; continue }
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

function modelGroupsOf(value: unknown): Map<string, ModelRow[]> {
  const groups = new Map<string, ModelRow[]>()
  if (!isRecord(value) || !Array.isArray(value.groups)) return groups
  for (const group of value.groups) {
    if (!isRecord(group) || typeof group.id !== 'string') continue
    const models = Array.isArray(group.models)
      ? group.models.flatMap((model): ModelRow[] => isRecord(model) && typeof model.id === 'string'
        ? [{ id: model.id, name: typeof model.name === 'string' ? model.name : model.id }]
        : [])
      : []
    groups.set(group.id, models)
  }
  return groups
}

function defaultOf(value: unknown): { provider: string; model: string } | undefined {
  if (!isRecord(value) || !isRecord(value.default)) return undefined
  const provider = stringOf(value.default.provider)
  const model = stringOf(value.default.model)
  return provider === undefined || model === undefined ? undefined : { provider, model }
}

async function call<T>(namespace: string, method: string, args: object): Promise<Result<T>> {
  try {
    const answer = await window.lcoder.call(namespace, method, args)
    return answer.ok ? { ok: true, value: answer.value as T } : { ok: false, error: answer.error }
  } catch (error: unknown) {
    return {
      ok: false,
      error: { code: 'lcoder/call-failed', message: error instanceof Error ? error.message : String(error) },
    }
  }
}

function groupOf(entry: DirectoryEntry): ProviderRow['group'] {
  if (entry.provider === 'deepseek-account' || entry.provider === 'deepseek-official'
    || entry.provider.startsWith('lcoder-cloud')) return 'official'
  return entry.declared ? 'custom' : 'other'
}

function isAccountProvider(provider: string): boolean {
  return provider === 'deepseek-account' || provider.startsWith('lcoder-cloud')
}

/**
 * 读一次完整模型快照。
 * @returns 行表、默认模型与失败信息。
 */
export async function loadModelSettings(): Promise<ModelSnapshot> {
  const [described, directory, registered, catalog] = await Promise.all([
    call<unknown>('settings', 'describe', {}),
    call<unknown>('llm', 'listConfigurableProviders', {}),
    call<unknown>('llm', 'listProviders', {}),
    call<unknown>('session', 'modelCatalog', {}),
  ])
  if (!described.ok) {
    return { status: 'error', error: `${described.error.code}: ${described.error.message}`, credentialError: null, writable: false, rows: [] }
  }
  if (!directory.ok) {
    return { status: 'error', error: `${directory.error.code}: ${directory.error.message}`, credentialError: null, writable: false, rows: [] }
  }
  if (!registered.ok) {
    return { status: 'error', error: `${registered.error.code}: ${registered.error.message}`, credentialError: null, writable: false, rows: [] }
  }
  const namespaces = new Map(namespacesOf(described.value).map(view => [view.ns, view]))
  const entries = directoryOf(directory.value)
  const declared = new Set(entries.map(entry => entry.provider))
  for (const provider of providersOf(registered.value)) {
    if (declared.has(provider.id)) continue
    entries.push({
      provider: provider.id,
      displayName: provider.name,
      settingsNs: '',
      settingsPath: [],
      declared: false,
      nativeEnv: [],
    })
  }
  const active = new Set(providersOf(registered.value).map(provider => provider.id))
  const models = catalog.ok ? modelGroupsOf(catalog.value) : new Map<string, ModelRow[]>()
  const defaultSelection = catalog.ok ? defaultOf(catalog.value) : undefined
  const writable = isRecord(described.value) && described.value.writable === true

  const draft = entries
    // 云路由保留在列表里供选择默认模型，但由登录令牌托管，不配置密钥。
    .map((entry): ProviderRow => {
      const namespace = namespaces.get(entry.settingsNs)
      const account = isAccountProvider(entry.provider)
      const apiKeyEnv = account ? undefined : stringOf(readPath(namespace?.value, [...entry.settingsPath, 'apiKeyEnv']))
      const keyRef = account || entry.settingsNs === '' ? undefined : apiKeyEnv ?? deriveKeyRef(entry.provider)
      const defaultModel = defaultSelection?.provider === entry.provider ? defaultSelection.model : undefined
      return {
        provider: entry.provider,
        displayName: entry.displayName,
        group: groupOf(entry),
        active: active.has(entry.provider),
        declared: entry.declared,
        account,
        settingsNs: entry.settingsNs,
        settingsPath: entry.settingsPath,
        revision: namespace?.revision ?? 0,
        ...keyRef === undefined ? {} : { keyRef },
        ...apiKeyEnv === undefined ? {} : { apiKeyEnv },
        keyConfigured: false,
        keyWritable: false,
        nativeConfigured: false,
        models: models.get(entry.provider) ?? [],
        ...defaultModel === undefined ? {} : { defaultModel },
        ...entry.error === undefined ? {} : { error: entry.error },
      }
    })

  const refs = [...new Set(draft.flatMap((row) => {
    if (row.account) return []
    const named = row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv]
    return [...named, row.keyRef ?? deriveKeyRef(row.provider), ...nativeRefs(row.provider, entries)]
  }))]
  const credentials = new Map<string, { configured: boolean; writable: boolean }>()
  let credentialError: string | null = null
  // 一次最多 64 个引用；目录很大时必须分批，整批拒绝会让三态全部读不到。
  for (let index = 0; index < refs.length; index += 64) {
    const answer = await call<unknown>('credentials', 'describe', { refs: refs.slice(index, index + 64) })
    if (answer.ok && isRecord(answer.value)) {
      for (const [ref, info] of Object.entries(answer.value)) {
        if (isRecord(info)) credentials.set(ref, { configured: info.configured === true, writable: info.writable === true })
      }
    } else if (!answer.ok) {
      credentialError = `${answer.error.code}: ${answer.error.message}`
      break
    }
  }

  const rows = draft.map((row): ProviderRow => {
    if (row.account) return row
    const key = credentials.get(row.keyRef ?? deriveKeyRef(row.provider))
    return {
      ...row,
      keyConfigured: key?.configured === true,
      keyWritable: key?.writable === true,
      nativeConfigured: nativeRefs(row.provider, entries).some(ref => credentials.get(ref)?.configured === true),
    }
  })

  return {
    status: 'ready',
    error: null,
    credentialError,
    writable,
    rows,
    ...defaultSelection === undefined ? {} : { defaultSelection },
  }
}

function nativeRefs(provider: string, entries: readonly DirectoryEntry[]): readonly string[] {
  return entries.find(entry => entry.provider === provider)?.nativeEnv ?? []
}

/**
 * 行状态：词典键与强调类。
 * @param row - 一行 provider。
 * @returns 词典键与样式类。
 */
export function rowStatus(row: ProviderRow): { key: MessageKey; className: string } {
  if (row.account) return { key: 'settings.account', className: 'model-tag-ok' }
  if (row.error !== undefined) return { key: 'settings.broken', className: 'model-tag-danger' }
  if (row.settingsNs === '') return { key: 'settings.activeOnly', className: 'model-tag' }
  if (!row.active) return { key: 'settings.inactive', className: 'model-tag-warn' }
  if (row.keyConfigured) return { key: 'settings.configured', className: 'model-tag-ok' }
  if (row.apiKeyEnv === undefined && row.nativeConfigured) return { key: 'settings.nativeAuth', className: 'model-tag-ok' }
  return { key: 'settings.notConfigured', className: 'model-tag' }
}

/**
 * 写一行的密钥；已有 `apiKeyEnv` 时不改设置，只写凭据。
 * @param row - 目标行。
 * @param value - 密钥原文；只流到 `credentials.set`。
 * @returns 失败文案；成功为 undefined。
 */
export async function saveKey(row: ProviderRow, value: string): Promise<string | undefined> {
  if (row.keyRef === undefined) return undefined
  const typed = value.trim()
  if (typed === '') return undefined
  if (row.apiKeyEnv === undefined && row.settingsPath.length > 0 && row.settingsNs !== '') {
    const written = await call('settings', 'mutate', {
      ns: row.settingsNs,
      ops: [{ op: 'set', path: [...row.settingsPath, 'apiKeyEnv'], value: row.keyRef }],
      expectedRevision: row.revision,
    })
    if (!written.ok) return written.error.code === 'settings/conflict' ? 'conflict' : written.error.message
  }
  const stored = await call('credentials', 'set', { ref: row.keyRef, value: typed })
  return stored.ok ? undefined : stored.error.message
}

/**
 * 删除一行的密钥。
 * @param row - 目标行。
 * @returns 失败文案；成功为 undefined。
 */
export async function removeKey(row: ProviderRow): Promise<string | undefined> {
  if (row.keyRef === undefined) return undefined
  const removed = await call('credentials', 'unset', { ref: row.keyRef })
  return removed.ok ? undefined : removed.error.message
}

/**
 * 把一条模型设为默认：没有会话时先建一个空白会话。
 * @param sessionId - 当前会话；null 表示还没有。
 * @param provider - 路线 id。
 * @param model - 模型 id。
 * @returns 失败文案；成功为 undefined。
 */
export async function setDefaultModel(
  sessionId: string | null,
  provider: string,
  model: string,
): Promise<string | undefined> {
  let target = sessionId
  if (target === null) {
    const created = await call<unknown>('session', 'create', { request: {} })
    if (!created.ok) return created.error.message
    const value = created.value
    target = isRecord(value) && typeof value.sessionId === 'string' ? value.sessionId : null
    if (target === null) return 'session.create 返回了无法识别的会话'
  }
  const selected = await call('session', 'selectModel', { request: { sessionId: target, provider, model } })
  return selected.ok ? undefined : selected.error.message
}

/**
 * 把设置写入错误翻成词典键。
 * @param code - 宿主或本地错误码。
 * @returns 词典键；未知码返回 undefined。
 */
export function writeErrorKey(code: string): MessageKey | undefined {
  if (code === 'conflict') return 'settings.modelConflict'
  if (code === 'bad-base-url') return 'settings.modelBadBaseURL'
  return undefined
}
