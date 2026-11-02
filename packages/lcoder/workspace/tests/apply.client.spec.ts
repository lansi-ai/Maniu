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
import { WorkspaceBody } from '../src/client/WorkspaceBody.tsx'
import { en, zh } from '../src/client/locales.ts'

/** 一次槽位注册被记下来的样子。 */
interface Recorded {
  name: string
  key: string
  locale: string
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
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
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, tabs, registered, dictionaries, fiber, slots, locale }
}

describe('@lcoder/workspace apply', () => {
  it('把页签类型、两本词典、正文都挂上去', async () => {
    const h = await boot()
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

  it('卸载后三处注册都不留痕，所以重载是安全的', async () => {
    const h = await boot()
    await h.fiber.dispose()
    expect(h.tabs.get(WORKSPACE_KIND)).toBeUndefined()
    expect(h.registered).toEqual([])
    expect(h.dictionaries.size).toBe(0)
  })
})
