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
  sessions: { create: (input: { workspaceId: unknown }) => unknown } = { create: vi.fn() },
  commands: { execute: ReturnType<typeof vi.fn> } = { execute: vi.fn() },
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
  ctx.provide('remote', { workspaceFiles: {}, commands } as never)
  ctx.provide('remote.workspaceFiles', {} as never)
  ctx.provide('remote.commands', commands as never)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('layout', { selectPanel, toggleSidebar } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return { ctx, tabs, registered, dictionaries, fiber, slots, locale, selectPanel, toggleSidebar, injections, commands }
}

describe('@lcoder/workspace apply', () => {
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

  it('卸载后三处注册都不留痕，所以重载是安全的', async () => {
    const h = await boot({ shell: false })
    await h.fiber.dispose()
    expect(h.tabs.get(WORKSPACE_KIND)).toBeUndefined()
    expect(h.registered).toEqual([])
    expect(h.dictionaries.size).toBe(0)
  })
})
