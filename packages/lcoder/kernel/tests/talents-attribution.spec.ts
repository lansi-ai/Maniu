/** 网关归属头：会话头常带，人才头只在会话绑定已登记人才时带上。 */
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm-pi-ai'
import { describe, expect, it } from 'vitest'
import { TALENT_ID_HEADER, TALENT_SESSION_HEADER } from '../src/talents/headers.ts'
import { apply } from '../src/talents/plugin.ts'
import type { AgentTalents } from '../src/talents/service.ts'

interface Session {
  readonly id: string
  readonly header: { readonly agentPreset?: string }
}

function harness(): {
  ctx: Context
  service: AgentTalents
  headers: (provider: string, sessionId?: string) => Headers
  sessions: Map<string, Session>
} {
  const sessions = new Map<string, Session>()
  const ctx = new Context()
  ctx.provide('agentPresets', {
    presetForSession: (session: Session) => session.header.agentPreset ?? null,
    definitionPlugins: () => undefined,
    definitionScope: () => undefined,
    register: async () => async () => {},
    resolve: async () => ({ id: 'x' }),
  } as never)
  ctx.provide('pluginPackages', { packageOf: () => undefined } as never)
  ctx.provide('sessions', { get: (id: string) => sessions.get(id) } as never)
  ctx.provide('sessionQuery', { listSessions: async () => [] } as never)
  ctx.provide('tools', { definitions: () => [] } as never)
  apply(ctx)
  return {
    ctx,
    service: ctx.agentTalents,
    sessions,
    headers: (provider, sessionId) => {
      const initial = new Headers()
      return ctx.waterfall('llm-pi-ai/request-headers', {
        provider, model: 'deepseek-flash', baseURL: 'http://127.0.0.1:5081/v1',
        ...sessionId === undefined ? {} : { sessionId: SessionId(sessionId) },
      }, initial, () => initial)
    },
  }
}

describe('gateway attribution headers', () => {
  it('adds the session header on the user route without a talent session', () => {
    const h = harness()
    h.sessions.set('session-1', { id: 'session-1', header: { agentPreset: 'standard' } })
    const headers = h.headers('lcoder-cloud', 'session-1')
    expect(headers.get(TALENT_SESSION_HEADER)).toBe('session-1')
    expect(headers.get(TALENT_ID_HEADER)).toBeNull()
  })

  it('adds the talent header for a session running a registered talent', async () => {
    const h = harness()
    h.sessions.set('session-1', { id: 'session-1', header: { agentPreset: 'talent-a1' } })
    await h.service.applyTalents({ talents: [{ id: 'a1', config: { version: 1 } }] })
    const headers = h.headers('lcoder-cloud', 'session-1')
    expect(headers.get(TALENT_SESSION_HEADER)).toBe('session-1')
    expect(headers.get(TALENT_ID_HEADER)).toBe('a1')
  })

  it('leaves other routes and sessionless calls untouched', () => {
    const h = harness()
    h.sessions.set('session-1', { id: 'session-1', header: { agentPreset: 'talent-a1' } })
    expect(h.headers('lcoder-cloud-guest', 'session-1').get(TALENT_SESSION_HEADER)).toBeNull()
    expect(h.headers('lcoder-cloud').get(TALENT_SESSION_HEADER)).toBeNull()
  })
})
