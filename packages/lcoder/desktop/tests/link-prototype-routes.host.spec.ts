/** 主进程一元白名单：阶段 1 新增的 5 个原型 Remote 必须能透传给宿主。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostLink } from '../src/link.ts'

afterEach(() => { vi.unstubAllGlobals() })

function linked(): { readonly link: HostLink; readonly fetched: string[] } {
  const link = new HostLink()
  Object.defineProperty(link, 'base', { value: 'http://127.0.0.1:9' })
  Object.defineProperty(link, 'cookie', { value: 'lcoder=test' })
  const fetched: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetched.push(url)
    return new Response(JSON.stringify({ type: 'server-response', result: { ok: true, value: null } }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return { link, fetched }
}

describe('原型工作台 Remote 白名单', () => {
  it('5 个新路由都透传，未列出的路由仍被拒', async () => {
    const { link, fetched } = linked()
    const routes = ['getStaged', 'commitStaged', 'discardStaged', 'listSnapshots', 'restoreSnapshot']
    for (const method of routes) {
      const result = await link.call('prototype', method, {})
      expect(result.ok).toBe(true)
    }
    expect(fetched).toEqual(routes.map(method => `http://127.0.0.1:9/api/prototype/${method}`))
    const denied = await link.call('prototype', 'unknownRoute', {})
    expect(denied).toEqual({
      ok: false,
      error: { code: 'lcoder/not-allowed', message: '未开放 prototype/unknownRoute' },
    })
  })
})
