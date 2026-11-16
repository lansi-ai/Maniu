/** 云端人才 Remote：CRUD 的入参透传、`CloudResult` 折返与业务失败码。 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CloudApiError } from '../src/cloud/api.ts'
import { CloudController } from '../src/cloud/controller.ts'

/** 一条最小人才响应。 */
const TALENT = {
  id: '0f4c2f3e-1f4a-4d5e-8a1b-2c3d4e5f6a7b',
  scope: 'global',
  projectId: null,
  ownerUserId: 'u1',
  createdBy: 'user',
  name: '评审',
  description: '',
  config: { version: 1 },
  revision: 1,
  canManage: true,
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
}

function controller(
  api: Record<string, unknown>,
  authenticate: <T>(operation: (token: string) => Promise<T>) => Promise<T> = operation => operation('access'),
): CloudController {
  return new CloudController(new Context(), {
    api: api as never,
    tokens: { authenticated: authenticate } as never,
    guest: {} as never,
    fingerprint: () => 'fingerprint',
  })
}

describe('云端人才 Remote', () => {
  it('列表把查询参数原样交给 HTTP 面', async () => {
    const talents = vi.fn(async () => ({ items: [TALENT] }))
    const answer = await controller({ talents }).talents({ scope: 'project', projectId: 'p1' })
    expect(talents).toHaveBeenCalledWith('access', { scope: 'project', projectId: 'p1' })
    expect(answer).toMatchObject({ ok: true, value: { items: [{ id: TALENT.id, canManage: true }] } })
  })

  it('新建、更新与删除都走已登录请求', async () => {
    const created = vi.fn(async (_token: string, input: Record<string, unknown>) => ({ ...TALENT, ...input, name: '新建' }))
    const updated = vi.fn(async (_token: string, input: Record<string, unknown>) => ({ ...TALENT, ...input, name: '改名' }))
    const deleted = vi.fn(async () => undefined)
    const input = { scope: 'global' as const, name: '新建', config: { version: 1 } }
    expect(await controller({ createTalent: created }).createTalent(input)).toMatchObject({ ok: true })
    expect(created.mock.calls[0]?.[1]).toEqual(input)
    expect(await controller({ updateTalent: updated }).updateTalent({
      id: TALENT.id, name: '改名', expectedRevision: 1,
    })).toMatchObject({ ok: true })
    expect(await controller({ deleteTalent: deleted }).deleteTalent({ id: TALENT.id })).toEqual({
      ok: true, value: { ok: true },
    })
  })

  it('业务失败与未登录都折成 ok:false，不抛到界面', async () => {
    const conflict = await controller({
      updateTalent: async () => { throw new CloudApiError({ code: 'conflict', message: '版本不一致', status: 409 }) },
    }).updateTalent({ id: TALENT.id, name: 'x', expectedRevision: 1 })
    expect(conflict).toEqual({ ok: false, error: { code: 'conflict', message: '版本不一致', status: 409 } })

    const offline = await controller({}, async () => {
      throw new CloudApiError({ code: 'needs_login', message: '登录状态已失效，请重新登录。' })
    }).talents({})
    expect(offline).toMatchObject({ ok: false, error: { code: 'needs_login' } })
  })
})
