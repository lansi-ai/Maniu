// @vitest-environment jsdom
/**
 * 页签类型的静态面，按注册表看到的样子断言：
 * 它是一个不认领任何地址的页面类型，坐在 `extension` 带里，
 * 给引导页留一个 `order: 20` 的入口，那个入口打开的就是我们的 kind。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { WORKSPACE_ID, WORKSPACE_KIND, workspaceDefinition } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('workspaceDefinition', () => {
  it('按自己的 kind 和 id 注册，且不认领任何地址', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(workspaceDefinition(t))
    expect(registry.get(WORKSPACE_KIND)?.id).toBe(WORKSPACE_ID)
    // 页面类型不该去抢文件地址，否则上游的 viewer 会被一个"工作台"接管。
    expect(registry.candidates('dsh-resource://file/session/s-1/work/app/a.ts')).toEqual([])
  })

  it('给引导页留一个打开本 kind 的入口', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(workspaceDefinition(t))
    const [entry, ...rest] = registry.guide()
    expect(rest).toEqual([])
    expect(entry?.order).toBe(20)
    expect(entry?.kind).toBe(WORKSPACE_KIND)
    expect(entry?.title()).toBe(zh['guide.title'])
    expect(entry?.description?.()).toBe(zh['guide.description'])
  })

  it('用字典自报名称，并坐在 extension 带里', () => {
    const definition = workspaceDefinition(t)
    expect(definition.priority).toBe('extension')
    expect(definition.patterns).toBeUndefined()
    expect(definition.title('')).toBe(zh['type.label'])
  })
})
