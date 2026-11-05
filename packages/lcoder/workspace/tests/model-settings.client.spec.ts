// @vitest-environment jsdom
/**
 * 设置页模型数据面的行为：目录 join、状态判定、更新顺序与失败映射。
 *
 * 远程面用记录器替身；这里断言的是发出去的方法与参数、以及页面能读到的
 * 快照，不涉及渲染。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createModelSettingsFace, deriveKeyRef, joinDirectory, loadModelSettings, parseModelIds,
  validBaseURL, validRouteName,
} from '../src/client/shell/model-settings.ts'
import type {
  ModelProviderRow, ModelSettingsRemote, ModelSettingsSchema,
} from '../src/client/shell/model-settings.ts'

const OFFICIAL = {
  provider: 'deepseek-official',
  displayName: 'DeepSeek',
  settingsNs: 'llm-deepseek',
  settingsPath: [],
}
const ANTHROPIC = {
  provider: 'anthropic',
  displayName: 'anthropic',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'anthropic'],
  defaultBaseURL: 'https://api.anthropic.com',
  nativeAuth: { env: ['ANTHROPIC_AUTH_TOKEN'], oauth: false },
}

const SCHEMA: ModelSettingsSchema = { protocols: () => ['anthropic-messages', 'openai-responses'] }

/** 一套能跑通的远程替身；用例按需覆盖单项。 */
function remoteWith(overrides: Partial<ModelSettingsRemote> = {}): ModelSettingsRemote {
  return {
    listProviders: vi.fn().mockResolvedValue({ ok: true, value: [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'anthropic', name: 'anthropic' }] }),
    listConfigurableProviders: vi.fn().mockResolvedValue({ ok: true, value: [OFFICIAL, ANTHROPIC] }),
    describeSettings: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [
          { autoGenerate: false, ns: 'llm-deepseek', schema: {}, value: { apiKeyEnv: 'DEEPSEEK_API_KEY' }, user: {}, base: {}, applies: 'live', secrets: [], revision: 3 },
          { autoGenerate: false, ns: 'llm-pi-ai', schema: {}, value: { providers: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' } } }, user: { providers: { anthropic: {} } }, base: {}, applies: 'live', secrets: [], revision: 7 },
        ],
      },
    }),
    describeCredentials: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        DEEPSEEK_API_KEY: { configured: true, writable: true },
        ANTHROPIC_API_KEY: { configured: false, writable: true },
        ANTHROPIC_AUTH_TOKEN: { configured: false, writable: true },
      },
    }),
    setCredential: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    unsetCredential: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    mutateSettings: vi.fn().mockResolvedValue({
      ok: true,
      value: { autoGenerate: false, ns: 'llm-pi-ai', schema: {}, value: {}, applies: 'live', secrets: [], revision: 8 },
    }),
    discoverModels: vi.fn().mockResolvedValue({ ok: true, value: [{ id: 'claude-sonnet-4-5' }] }),
    modelCatalog: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        default: { provider: 'deepseek-official', model: 'deepseek-chat' },
        routableProviders: ['deepseek-official'],
        groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
        failures: [],
      },
    }),
    selectModel: vi.fn().mockResolvedValue({ ok: true, value: { selected: { provider: 'deepseek-official', model: 'deepseek-chat' } } }),
    ...overrides,
  }
}

/** 一条完整的行，按需覆盖。 */
function row(overrides: Partial<ModelProviderRow> = {}): ModelProviderRow {
  return {
    provider: 'anthropic',
    displayName: 'anthropic',
    group: 'other',
    active: true,
    declared: false,
    account: false,
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'anthropic'],
    revision: 7,
    baseURLEnv: [],
    modelIds: [],
    profilePresent: true,
    removable: false,
    keyRef: 'ANTHROPIC_API_KEY',
    apiKeyConfigured: false,
    apiKeyWritable: true,
    nativeConfigured: false,
    nativeEnv: ['ANTHROPIC_AUTH_TOKEN'],
    models: [],
    accountAvailable: false,
    ...overrides,
  }
}

describe('模型设置的纯规则', () => {
  it('引用名按路线派生', () => {
    expect(deriveKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
    expect(deriveKeyRef('anthropic')).toBe('ANTHROPIC_API_KEY')
  })

  it('手加路线名称只收小写连字符', () => {
    expect(validRouteName('acme-gateway')).toBe(true)
    expect(validRouteName('a1-b2')).toBe(true)
    expect(validRouteName('Acme')).toBe(false)
    expect(validRouteName('1acme')).toBe(false)
    expect(validRouteName('acme--gateway')).toBe(false)
    expect(validRouteName('acme_gateway')).toBe(false)
  })

  it('地址只收 http(s)', () => {
    expect(validBaseURL('https://example.com/v1')).toBe(true)
    expect(validBaseURL('http://127.0.0.1:8080')).toBe(true)
    expect(validBaseURL('ftp://example.com')).toBe(false)
    expect(validBaseURL('not a url')).toBe(false)
  })

  it('模型 id 按行或逗号拆分并去重', () => {
    expect(parseModelIds('a\nb, a\n\nc ')).toEqual(['a', 'b', 'c'])
  })

  it('目录 join 把账户与官方排在前，注册但无目录的追加在后', () => {
    const joined = joinDirectory(
      [{ id: 'zzz', name: 'Z' }, { id: 'deepseek-official', name: 'DeepSeek' }],
      [ANTHROPIC, { ...OFFICIAL, provider: 'deepseek-account', displayName: 'Account' }, OFFICIAL],
    )
    expect(joined.map(entry => entry.provider)).toEqual(['deepseek-account', 'deepseek-official', 'anthropic', 'zzz'])
  })
})

describe('loadModelSettings', () => {
  it('join 目录、凭据状态、默认模型与协议枚举', async () => {
    const snapshot = await loadModelSettings(remoteWith(), SCHEMA)
    expect(snapshot.status).toBe('ready')
    expect(snapshot.protocols).toEqual(['anthropic-messages', 'openai-responses'])
    expect(snapshot.piAiNs).toBe('llm-pi-ai')
    expect(snapshot.defaultSelection).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    const official = snapshot.rows.find(entry => entry.provider === 'deepseek-official')
    expect(official).toMatchObject({
      group: 'official', apiKeyEnv: 'DEEPSEEK_API_KEY', keyRef: 'DEEPSEEK_API_KEY', apiKeyConfigured: true, defaultModel: 'deepseek-chat',
    })
    const anthropic = snapshot.rows.find(entry => entry.provider === 'anthropic')
    expect(anthropic?.baseURL).toBeUndefined()
    expect(anthropic).toMatchObject({
      group: 'other', defaultBaseURL: 'https://api.anthropic.com', profilePresent: true, keyRef: 'ANTHROPIC_API_KEY', apiKeyConfigured: false,
    })
  })

  it('目录读取失败 → 整体报错，不画半张表', async () => {
    const snapshot = await loadModelSettings(remoteWith({
      listConfigurableProviders: vi.fn().mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'boom' } }),
    }), SCHEMA)
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toContain('boom')
    expect(snapshot.rows).toEqual([])
  })

  it('凭据读取失败只降级徽标，行仍然可用', async () => {
    const snapshot = await loadModelSettings(remoteWith({
      describeCredentials: vi.fn().mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'no store' } }),
    }), SCHEMA)
    expect(snapshot.status).toBe('ready')
    expect(snapshot.credentialError).toContain('no store')
    expect(snapshot.rows.length).toBe(2)
  })
})

describe('createModelSettingsFace', () => {
  it('保存 key 先补 apiKeyEnv，再写凭据', async () => {
    const calls: string[] = []
    const mutateSettings = vi.fn().mockImplementation(async () => { calls.push('settings'); return { ok: true, value: {} } })
    const setCredential = vi.fn().mockImplementation(async () => { calls.push('credential'); return { ok: true, value: undefined } })
    const face = createModelSettingsFace(remoteWith({ mutateSettings, setCredential }), SCHEMA)
    const outcome = await face.saveKey(row(), '  sk-test  ')
    expect(outcome).toBeUndefined()
    expect(calls).toEqual(['settings', 'credential'])
    expect(mutateSettings).toHaveBeenCalledWith(
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY' }],
      7,
    )
    expect(setCredential).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'sk-test')
  })

  it('profile 已有引用时只写凭据', async () => {
    const mutateSettings = vi.fn()
    const setCredential = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const face = createModelSettingsFace(remoteWith({ mutateSettings, setCredential }), SCHEMA)
    expect(await face.saveKey(row({ apiKeyEnv: 'ANTHROPIC_API_KEY' }), 'sk-test')).toBeUndefined()
    expect(mutateSettings).not.toHaveBeenCalled()
    expect(setCredential).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'sk-test')
  })

  it('删除密钥走 unset，失败原样交回', async () => {
    const unsetCredential = vi.fn().mockResolvedValue({ ok: false, error: { code: 'credentials/locked', message: 'locked' } })
    const face = createModelSettingsFace(remoteWith({ unsetCredential }), SCHEMA)
    expect(await face.removeKey(row())).toBe('locked')
    expect(unsetCredential).toHaveBeenCalledWith('ANTHROPIC_API_KEY')
  })

  it('base URL 写入与清空分别发 set 与 unset', async () => {
    const mutateSettings = vi.fn().mockResolvedValue({ ok: true, value: {} })
    const face = createModelSettingsFace(remoteWith({ mutateSettings }), SCHEMA)
    expect(await face.saveProfile(row(), { baseURL: 'https://proxy.example.com' })).toBeUndefined()
    expect(mutateSettings).toHaveBeenLastCalledWith(
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', 'anthropic', 'baseURL'], value: 'https://proxy.example.com' }],
      7,
    )
    await face.saveProfile(row({ settingsNs: 'llm-deepseek', settingsPath: [] }), { baseURL: null })
    expect(mutateSettings).toHaveBeenLastCalledWith(
      'llm-deepseek',
      [{ op: 'unset', path: ['baseURL'] }],
      7,
    )
  })

  it('settings 冲突翻成稳定代号，页面再翻译', async () => {
    const remote = remoteWith({ mutateSettings: vi.fn().mockResolvedValue({ ok: false, error: { code: 'settings/conflict', message: 'stale' } }) })
    const face = createModelSettingsFace(remote, SCHEMA)
    expect(await face.saveProfile(row(), { baseURL: 'https://proxy.example.com' })).toBe('settings/conflict')
  })

  it('创建自定义 provider：先写 profile 再存 key', async () => {
    const calls: string[] = []
    const mutateSettings = vi.fn().mockImplementation(async () => { calls.push('settings'); return { ok: true, value: {} } })
    const setCredential = vi.fn().mockImplementation(async () => { calls.push('credential'); return { ok: true, value: undefined } })
    const face = createModelSettingsFace(remoteWith({ mutateSettings, setCredential }), SCHEMA)
    expect(await face.createProvider({
      name: 'acme-gateway', protocol: 'openai-responses', modelIds: ['m1'], baseURL: 'https://gw.example.com', apiKey: 'sk-x',
    })).toBeUndefined()
    expect(calls).toEqual(['settings', 'credential'])
    expect(mutateSettings).toHaveBeenCalledWith(
      'llm-pi-ai',
      [{
        op: 'set',
        path: ['providers', 'acme-gateway'],
        value: { apiKeyEnv: 'ACME_GATEWAY_API_KEY', api: 'openai-responses', baseURL: 'https://gw.example.com', models: [{ id: 'm1' }] },
      }],
      7,
    )
    expect(setCredential).toHaveBeenCalledWith('ACME_GATEWAY_API_KEY', 'sk-x')
  })

  it('自定义 provider 的三条门禁各自返回可翻译代号', async () => {
    const face = createModelSettingsFace(remoteWith(), SCHEMA)
    expect(await face.createProvider({ name: 'Acme', protocol: 'x', modelIds: ['m'], baseURL: 'https://x.example', apiKey: '' })).toBe('invalid-name')
    expect(await face.createProvider({ name: 'acme', protocol: 'x', modelIds: [], baseURL: 'https://x.example', apiKey: '' })).toBe('no-models')
    expect(await face.createProvider({ name: 'acme', protocol: 'x', modelIds: ['m'], baseURL: 'ftp://x', apiKey: '' })).toBe('bad-base-url')
    expect(await face.createProvider({ name: 'anthropic', protocol: 'x', modelIds: ['m'], baseURL: 'https://x.example', apiKey: '' })).toBe('name-taken')
  })

  it('删除 provider 先清密钥再删 profile', async () => {
    const calls: string[] = []
    const unsetCredential = vi.fn().mockImplementation(async () => { calls.push('credential'); return { ok: true, value: undefined } })
    const mutateSettings = vi.fn().mockImplementation(async () => { calls.push('settings'); return { ok: true, value: {} } })
    const face = createModelSettingsFace(remoteWith({ unsetCredential, mutateSettings }), SCHEMA)
    expect(await face.removeProvider(row({ apiKeyConfigured: true, removable: true }))).toBeUndefined()
    expect(calls).toEqual(['credential', 'settings'])
    expect(unsetCredential).toHaveBeenCalledWith('ANTHROPIC_API_KEY')
  })

  it('设为默认把宿主 message 原样交回', async () => {
    const remote = remoteWith({ selectModel: vi.fn().mockResolvedValue({ ok: false, error: { code: 'session/model-unavailable', message: '没有这个模型' } }) })
    const face = createModelSettingsFace(remote, SCHEMA)
    expect(await face.setDefault('session-1' as never, 'anthropic', 'nope')).toBe('没有这个模型')
  })

  it('发现模型只读展示结果，拒绝时原样交回', async () => {
    const ok = createModelSettingsFace(remoteWith(), SCHEMA)
    expect(await ok.discover({ settingsNs: 'llm-pi-ai', provider: 'anthropic' })).toEqual({ kind: 'found', models: [{ id: 'claude-sonnet-4-5' }] })
    const refused = createModelSettingsFace(remoteWith({
      discoverModels: vi.fn().mockResolvedValue({ ok: false, error: { code: 'llm/model-discovery-rejected', message: '401 unauthorized' } }),
    }), SCHEMA)
    expect(await refused.discover({ settingsNs: 'llm-pi-ai', provider: 'anthropic', apiKey: 'sk-x' })).toEqual({ kind: 'refused', message: '401 unauthorized' })
  })
})
