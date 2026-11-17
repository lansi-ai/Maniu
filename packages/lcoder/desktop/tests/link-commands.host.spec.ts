/** 主进程命令白名单：flow_save 可透传，未列出的命令在转发前被拒。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostLink } from '../src/link.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function linked(): { readonly link: HostLink; readonly fetched: string[] } {
  const link = new HostLink()
  Object.defineProperty(link, 'base', { value: 'http://127.0.0.1:9' })
  Object.defineProperty(link, 'cookie', { value: 'lcoder=test' })
  const fetched: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetched.push(url)
    return new Response(JSON.stringify({
      type: 'server-response',
      result: { ok: true, value: { result: { kind: 'success', text: 'ok' } } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return { link, fetched }
}

describe('commands/execute 白名单', () => {
  it('flow_save 的 JSON 与 preset 两种输入都透传给宿主', async () => {
    const { link, fetched } = linked()
    const json = await link.call('commands', 'execute', { agentId: 's-1', line: '/flow_save {"nodes":[]}', submittedAttachments: [] })
    expect(json.ok).toBe(true)
    const preset = await link.call('commands', 'execute', { agentId: 's-1', line: '/flow_save preset', submittedAttachments: [] })
    expect(preset.ok).toBe(true)
    expect(fetched).toEqual([
      'http://127.0.0.1:9/api/commands/execute',
      'http://127.0.0.1:9/api/commands/execute',
    ])
  })

  it('方案批准与驳回都透传给宿主', async () => {
    const { link, fetched } = linked()
    const approve = await link.call('commands', 'execute', { agentId: 's-1', line: '/proposal_approve P-01', submittedAttachments: [] })
    expect(approve.ok).toBe(true)
    const reject = await link.call('commands', 'execute', { agentId: 's-1', line: '/proposal_reject P-01', submittedAttachments: [] })
    expect(reject.ok).toBe(true)
    expect(fetched).toEqual([
      'http://127.0.0.1:9/api/commands/execute',
      'http://127.0.0.1:9/api/commands/execute',
    ])
  })

  it('未列出的命令在转发前被拒，不碰宿主', async () => {
    const { link, fetched } = linked()
    const answer = await link.call('commands', 'execute', { agentId: 's-1', line: '/deploy T-01', submittedAttachments: [] })
    expect(answer).toEqual({ ok: false, error: { code: 'lcoder/not-allowed', message: '未开放命令 /deploy' } })
    expect(fetched).toEqual([])
  })
})
