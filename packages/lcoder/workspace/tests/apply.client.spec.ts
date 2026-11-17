// @vitest-environment jsdom
/**
 * 插件的三处注册，以及卸载后是否真的都收了回去。
 *
 * 注册表用真的（"注册成功"本来就该由它说了算），槽位与词典用记录器——
 * 这里要确认的是交出去的东西对不对，而不是槽位运行时怎么渲染。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { apply, inject } from '../src/client/index.ts'
import { WORKSPACE_ID, WORKSPACE_KIND } from '../src/client/definition.ts'
import { Shell } from '../src/client/shell/Shell.tsx'
import { WorkspaceBody } from '../src/client/WorkspaceBody.tsx'
import { en, zh } from '../src/client/locales.ts'

/** 一次槽位注册被记下来的样子。 */
interface Recorded {
  name: string
  key: string
  locale: string
  component: unknown
}

async function boot(
  config: { shell?: boolean; openTimeoutMs?: number } = { shell: false },
  workspaces: { create: (input: { path: string }) => unknown } = { create: vi.fn() },
  sessions: {
    create: (input: { workspaceId: unknown }) => unknown
    binding?: (id: string) => unknown
    using?: (id: string, options: unknown, operation: (reference: unknown) => unknown) => unknown
    retain?: (id: string, options: unknown) => unknown
  } = { create: vi.fn() },
  commands: { execute: ReturnType<typeof vi.fn> } = { execute: vi.fn() },
  session: { modelCatalog: ReturnType<typeof vi.fn> } = { modelCatalog: vi.fn() },
  agentPresets: { list: ReturnType<typeof vi.fn> } = { list: vi.fn() },
) {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const selectPanel = vi.fn()
  const toggleSidebar = vi.fn()
  const registered: Recorded[] = []
  const injections: Record<string, unknown>[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'> & { inject?: () => Record<string, unknown> }, component: unknown) => {
      const entry: Recorded = { ...options, component }
      if (typeof options.inject === 'function') injections.push(options.inject())
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  // 正文注册时会把 workspaceFiles 窄化成投影面；这里只看注册形状，远程面给空壳即可。
  const listeners = new Map<string, Set<() => void>>()
  const $on = vi.fn((event: string, listener: () => void): (() => void) => {
    const set = listeners.get(event) ?? new Set<() => void>()
    set.add(listener)
    listeners.set(event, set)
    return () => { set.delete(listener) }
  })
  const llm = {
    listProviders: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    listConfigurableProviders: vi.fn(),
    discoverModels: vi.fn(),
  }
  const settings = { describe: vi.fn(), mutate: vi.fn() }
  const credentials = { describe: vi.fn(), set: vi.fn(), unset: vi.fn() }
  const fileUploads = { upload: vi.fn() }
  ctx.provide('remote', {
    workspaceFiles: {}, commands, session, agentPresets, llm, settings, credentials, fileUploads, $on,
  } as never)
  ctx.provide('remote.workspaceFiles', {} as never)
  ctx.provide('remote.commands', commands as never)
  ctx.provide('remote.session', session as never)
  ctx.provide('remote.agentPresets', agentPresets as never)
  ctx.provide('remote.llm', llm as never)
  ctx.provide('remote.settings', settings as never)
  ctx.provide('remote.credentials', credentials as never)
  ctx.provide('remote.fileUploads', fileUploads as never)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('layout', { selectPanel, toggleSidebar } as never)
  /** 触发某个远程事件的本地监听。 */
  const emit = (event: string): void => {
    for (const listener of listeners.get(event) ?? []) listener()
  }
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return {
    ctx, tabs, registered, dictionaries, fiber, slots, locale, selectPanel, toggleSidebar,
    injections, commands, session, agentPresets, $on, emit,
  }
}

describe('@maniu/workspace apply', () => {
  it('shell: false 时把页签类型、两本词典、正文都挂上去', async () => {
    const h = await boot({ shell: false })
    try {
      expect(h.tabs.get(WORKSPACE_KIND)?.id).toBe(WORKSPACE_ID)
      expect(h.dictionaries.get('lcoderWorkspace')).toEqual({ zh, en })
      expect(h.registered).toHaveLength(1)
      expect(h.registered[0]).toMatchObject({
        name: 'sidebar.right.pane.tab',
        key: WORKSPACE_ID,
        locale: 'lcoderWorkspace',
        component: WorkspaceBody,
      })
      expect(h.locale.bind).toHaveBeenCalledWith('lcoderWorkspace')
    } finally { await h.fiber.dispose() }
  })

  it('默认注册整壳主面板并选中 lcoder-home', async () => {
    const h = await boot({ shell: true })
    try {
      expect(h.dictionaries.get('lcoderWorkspace')).toEqual({ zh, en })
      expect(h.registered).toHaveLength(1)
      expect(h.registered[0]).toMatchObject({
        name: 'main',
        key: 'lcoder-home',
        locale: 'lcoderWorkspace',
        component: Shell,
      })
      expect(h.selectPanel).toHaveBeenCalledWith('lcoder-home')
      expect(h.toggleSidebar).toHaveBeenCalled()
      expect(h.tabs.get(WORKSPACE_KIND)).toBeUndefined()
    } finally { await h.fiber.dispose() }
  })

  it('打开仓库在等待上限后报超时，而不是无限转圈', async () => {
    const h = await boot({ shell: true, openTimeoutMs: 20 }, { create: () => new Promise(() => {}) })
    try {
      const openRepository = h.injections[0]?.openRepository as (path: string) => Promise<unknown>
      await expect(openRepository('E:/Projects/LCoder-target-demo')).rejects.toThrow(/workspace\/create/)
    } finally { await h.fiber.dispose() }
  })

  it('打开仓库把远程拒绝原样交出，不伪装成超时', async () => {
    const h = await boot(
      { shell: true, openTimeoutMs: 5000 },
      { create: () => Promise.reject(new Error('路径不存在')) },
    )
    try {
      const openRepository = h.injections[0]?.openRepository as (path: string) => Promise<unknown>
      await expect(openRepository('E:/nope')).rejects.toThrow('路径不存在')
    } finally { await h.fiber.dispose() }
  })

  it('会话创建那一步同样受等待上限约束', async () => {
    const h = await boot(
      { shell: true, openTimeoutMs: 20 },
      { create: async () => ({ workspaceId: 'w-1' }) },
      { create: () => new Promise(() => {}) },
    )
    try {
      const openRepository = h.injections[0]?.openRepository as (path: string) => Promise<unknown>
      await expect(openRepository('E:/Projects/x')).rejects.toThrow(/session\/create/)
    } finally { await h.fiber.dispose() }
  })

  it('签署把人机命令交给宿主，并把宿主那句人话原样带回来', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      value: { commandId: 'c1', result: { kind: 'success', text: 'T-01 的契约已由人签署于 10:00' } },
    })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute })
    try {
      const face = h.injections[0] as { signContract: (id: string, taskId: string) => Promise<{ ok: boolean; text: string }> }
      const r = await face.signContract('session-1', 'T-01')
      expect(execute.mock.calls[0]?.[1]).toBe('/contract_sign T-01')
      expect(r).toEqual({ ok: true, text: 'T-01 的契约已由人签署于 10:00' })
    } finally { await h.fiber.dispose() }
  })

  it('发消息先持有会话引用并等首次打开落定', async () => {
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    const using = vi.fn(async (_id: string, _options: unknown, operation: (reference: unknown) => unknown) =>
      operation({ ready: Promise.resolve(), binding: { session: { prompt } } }))
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn(), using })
    try {
      const face = h.injections[0] as { sendPrompt: (id: string, text: string) => Promise<void> }
      await face.sendPrompt('s-1', '你好')
      expect(using).toHaveBeenCalledWith('s-1', { source: 'lcoderShell' }, expect.any(Function))
      expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '你好' }], 'queue')
    } finally { await h.fiber.dispose() }
  })

  it('浮层打开时持有会话引用，关闭时只释放一次', async () => {
    const release = vi.fn()
    const retain = vi.fn(() => ({ release }))
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn(), retain })
    try {
      const face = h.injections[0] as { holdSession: (id: string) => () => void }
      const dispose = face.holdSession('s-1')
      expect(retain).toHaveBeenCalledWith('s-1', { source: 'lcoderShell' })
      dispose()
      dispose()
      expect(release).toHaveBeenCalledTimes(1)
    } finally { await h.fiber.dispose() }
  })

  it('推进到已签约同样走人机命令，回执原样带回', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      value: { commandId: 'c9', result: { kind: 'success', text: 'T-01 已进入「已签约」' } },
    })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute })
    try {
      const face = h.injections[0] as { advanceContract: (id: string, taskId: string) => Promise<{ ok: boolean; text: string }> }
      expect(await face.advanceContract('s-1', 'T-01')).toEqual({ ok: true, text: 'T-01 已进入「已签约」' })
      expect(execute.mock.calls[0]?.[1]).toBe('/task_contract T-01')
    } finally { await h.fiber.dispose() }
  })

  it('这个装配没有命令面 → 报无法签署，不假装签好了', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute })
    try {
      const face = h.injections[0] as { signContract: (id: string, taskId: string) => Promise<{ ok: boolean; text: string }> }
      expect(await face.signContract('session-1', 'T-01')).toEqual({ ok: false, text: 'shell.commandUnavailable' })
    } finally { await h.fiber.dispose() }
  })

  it('宿主拒绝签署 → 失败回执连同原因一起交出', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      value: { commandId: 'c2', result: { kind: 'error', text: '找不到 T-01 的契约' } },
    })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute })
    try {
      const face = h.injections[0] as { signContract: (id: string, taskId: string) => Promise<{ ok: boolean; text: string }> }
      expect(await face.signContract('session-1', 'T-01')).toEqual({ ok: false, text: '找不到 T-01 的契约' })
    } finally { await h.fiber.dispose() }
  })

  it('远程调用本身失败 → 交出 code 与 message', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: false, error: { code: 'session-not-found', message: '会话没在' } })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute })
    try {
      const face = h.injections[0] as { signContract: (id: string, taskId: string) => Promise<{ ok: boolean; text: string }> }
      expect(await face.signContract('session-1', 'T-01')).toEqual({ ok: false, text: 'session-not-found: 会话没在' })
    } finally { await h.fiber.dispose() }
  })

  it('空模型目录读成 empty，并把 provider 的失败细节带出来', async () => {
    const modelCatalog = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        routableProviders: [], groups: [], default: null,
        failures: [{ id: 'deepseek', name: 'DeepSeek', message: 'no api key' }],
      },
    })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute: vi.fn() }, { modelCatalog })
    try {
      const face = h.injections[0] as { checkModels: () => Promise<{ state: string; detail?: string }> }
      expect(await face.checkModels()).toEqual({ state: 'empty', detail: 'DeepSeek: no api key' })
    } finally { await h.fiber.dispose() }
  })

  it('目录查询本身失败 → unknown，不冒充「没有凭据」', async () => {
    const modelCatalog = vi.fn().mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'boom' } })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute: vi.fn() }, { modelCatalog })
    try {
      const face = h.injections[0] as { checkModels: () => Promise<{ state: string; detail?: string }> }
      expect(await face.checkModels()).toEqual({ state: 'unknown', detail: 'gateway/internal: boom' })
    } finally { await h.fiber.dispose() }
  })

  it('模型与凭据的变化面被交出来，卸载时一并收回', async () => {
    const modelCatalog = vi.fn().mockResolvedValue({ ok: true, value: { routableProviders: ['deepseek'], groups: [], default: null } })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute: vi.fn() }, { modelCatalog })
    try {
      const face = h.injections[0] as { subscribeModels: (listener: () => void) => () => void }
      const disposeOne = vi.fn()
      h.$on.mockReturnValue(disposeOne)
      face.subscribeModels(() => {})()
      expect(h.$on.mock.calls.map(call => call[0])).toEqual([
        'llm/models-updated', 'llm/adapters-updated', 'credentials/reference-updated',
        'credentials/record-updated', 'settings/document-updated',
      ])
      expect(disposeOne).toHaveBeenCalledTimes(5)
    } finally { await h.fiber.dispose() }
  })

  it('存密钥发出的 reference-updated 也会触发重查', async () => {
    const modelCatalog = vi.fn().mockResolvedValue({ ok: true, value: { routableProviders: [], groups: [], default: null } })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute: vi.fn() }, { modelCatalog })
    try {
      const face = h.injections[0] as { subscribeModels: (listener: () => void) => () => void }
      const listener = vi.fn()
      face.subscribeModels(listener)
      h.emit('credentials/reference-updated')
      expect(listener).toHaveBeenCalledTimes(1)
      h.emit('settings/document-updated')
      expect(listener).toHaveBeenCalledTimes(2)
    } finally { await h.fiber.dispose() }
  })

  it('会话快照里的失败读得出来——事件流里没有这些', async () => {
    const sessions = {
      create: vi.fn(),
      binding: vi.fn(() => ({ session: { getSnapshot: () => ({ promptError: null, lastAgentError: 'no credentials' }) } })),
    }
    const h = await boot({ shell: true }, { create: vi.fn() }, sessions, { execute: vi.fn() })
    try {
      const face = h.injections[0] as { readSessionNotice: (id: string) => { key: string; detail: string } | null }
      expect(face.readSessionNotice('s-1')).toEqual({ key: 'shell.turnFailed', detail: 'no credentials' })
    } finally { await h.fiber.dispose() }
  })

  it('认领把 /task_bind 交给人机命令，宿主那句人话原样带回', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      value: { commandId: 'c3', result: { kind: 'success', text: '会话 s-1 已认上 T-01' } },
    })
    const h = await boot({ shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute })
    try {
      const face = h.injections[0] as { bindTask: (id: string, taskId: string) => Promise<{ ok: boolean; text: string }> }
      const r = await face.bindTask('s-1', 'T-01')
      expect(execute.mock.calls[0]?.[1]).toBe('/task_bind T-01')
      expect(r).toEqual({ ok: true, text: '会话 s-1 已认上 T-01' })
    } finally { await h.fiber.dispose() }
  })

  it('新会话复用同一仓库的工作区，并把角色指名给创建这一步', async () => {
    const workspaces = { create: vi.fn().mockResolvedValue({ workspaceId: 'w-1' }) }
    const sessions = { create: vi.fn().mockResolvedValue('s-9') }
    const h = await boot({ shell: true }, workspaces, sessions)
    try {
      const face = h.injections[0] as { createSession: (path: string, preset?: string) => Promise<string> }
      expect(await face.createSession('E:/repo/target', 'maniu-review')).toBe('s-9')
      expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'w-1', agentPreset: 'maniu-review' })
      await face.createSession('E:/repo/target')
      expect(sessions.create.mock.calls[1]?.[0]).toEqual({ workspaceId: 'w-1' })
    } finally { await h.fiber.dispose() }
  })

  it('角色名册只交产品角色，远程拒绝就交空表而不是编造角色', async () => {
    const roster = {
      presets: [
        { id: 'standard', isDefault: false },
        { id: 'maniu', isDefault: true },
        { id: 'maniu-review', name: '评审', isDefault: false },
      ],
    }
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: roster })
      .mockResolvedValueOnce({ ok: false, error: { code: 'unavailable', message: 'no roster' } })
    const h = await boot(
      { shell: true }, { create: vi.fn() }, { create: vi.fn() }, { execute: vi.fn() },
      { modelCatalog: vi.fn() }, { list },
    )
    try {
      const face = h.injections[0] as { listRoles: () => Promise<Array<{ id: string; name?: string }>> }
      // `standard` 不挂本包工具，读不到 .spec，外壳不把它当角色给。
      expect(await face.listRoles()).toEqual([{ id: 'maniu' }, { id: 'maniu-review', name: '评审' }])
      expect(await face.listRoles()).toEqual([])
    } finally { await h.fiber.dispose() }
  })

  it('卡片的两个状态位：物化过的会话读得到，没物化的返回 null', async () => {
    const bound = {
      session: {
        getSnapshot: () => ({
          awaitingFirstTurn: true,
          promptError: { op: 'send', error: { code: 'gateway/internal', message: 'boom' } },
          lastAgentError: null,
        }),
      },
    }
    const h = await boot(
      { shell: true },
      { create: vi.fn() },
      { create: vi.fn(), binding: vi.fn((id: string) => (id === 's-1' ? bound : undefined)) },
      { execute: vi.fn() },
    )
    try {
      const face = h.injections[0] as {
        readSessionFlags: (id: string) => { awaitingFirstTurn: boolean; failed: boolean } | null
      }
      expect(face.readSessionFlags('s-1')).toEqual({ awaitingFirstTurn: true, failed: true })
      expect(face.readSessionFlags('s-2')).toBeNull()
    } finally { await h.fiber.dispose() }
  })

  it('订阅同时挂事件窗口与会话快照，收回时两个都解', async () => {
    const disposeEvents = vi.fn()
    const disposeState = vi.fn()
    const binding = {
      eventSource: { subscribe: () => disposeEvents, getSnapshot: () => ({ entries: [] }) },
      session: { subscribe: () => disposeState },
    }
    const h = await boot(
      { shell: true },
      { create: vi.fn() },
      { create: vi.fn(), binding: vi.fn(() => binding) },
      { execute: vi.fn() },
    )
    try {
      const face = h.injections[0] as { subscribeSession: (id: string, listener: () => void) => () => void }
      face.subscribeSession('s-1', () => {})()
      expect(disposeEvents).toHaveBeenCalledTimes(1)
      expect(disposeState).toHaveBeenCalledTimes(1)
    } finally { await h.fiber.dispose() }
  })

  it('卸载后三处注册都不留痕，所以重载是安全的', async () => {
    const h = await boot({ shell: false })
    await h.fiber.dispose()
    expect(h.tabs.get(WORKSPACE_KIND)).toBeUndefined()
    expect(h.registered).toEqual([])
    expect(h.dictionaries.size).toBe(0)
  })
})
