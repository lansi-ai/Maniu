/**
 * 云端 HTTP 面的线上字段：`/v1/me` 的预估解析与 `/v1/me/usage` 的查询编码。
 *
 * fetch 全部用记录器替身；这里不碰网络，也不重复展开令牌生命周期。
 */
import { describe, expect, it, vi } from 'vitest'
import { CloudApi, CloudApiError, parseTokenEstimate } from '../src/cloud/api.ts'

/** 记下请求并回一个 JSON 响应。 */
function stubFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async (_input, _init) => new Response(
    JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json' } },
  ))
}

/** 读一次请求体；体不是 JSON 对象时按空对象。 */
function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  const raw: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
  const body: Record<string, unknown> = {}
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) body[key] = value
  }
  return body
}

describe('云端 token 预估解析', () => {
  it('直读云端字段，不认识的不可用原因折成 null', () => {
    const estimate = parseTokenEstimate({
      available: false,
      unavailableReason: 'something_new',
      model: 'deepseek-flash',
      availableMicroUsd: 0,
      lowerBoundTokens: 0,
      upperBoundTokens: 0,
      inputOutputRatio: '8:2',
      price: null,
    })
    expect(estimate).toMatchObject({ available: false, unavailableReason: null, lowerBoundTokens: 0 })
  })

  it('价格三项缺一就按无价格处理', () => {
    const estimate = parseTokenEstimate({
      available: true,
      unavailableReason: null,
      model: 'deepseek-flash',
      availableMicroUsd: 20_000_000,
      lowerBoundTokens: 64_935_064,
      upperBoundTokens: 187_969_924,
      inputOutputRatio: '8:2',
      price: { inputMicroUsdPerMtok: 260_000, outputMicroUsdPerMtok: 500_000 },
    })
    expect(estimate?.price).toBeNull()
  })

  it('字段不全时整份预估为 null', () => {
    expect(parseTokenEstimate({ available: true, model: 'deepseek-flash' })).toBeNull()
    expect(parseTokenEstimate(null)).toBeNull()
  })
})

describe('云端 HTTP 面', () => {
  it('/v1/me 附带 tokenEstimate', async () => {
    const fetchImpl = stubFetch({
      user: { id: 'u1', displayName: null, phoneMasked: null, status: 'active' },
      quota: { grantedMicroUsd: 20_000_000, reservedMicroUsd: 0, spentMicroUsd: 0, availableMicroUsd: 20_000_000, currency: 'USD' },
      tokenEstimate: {
        available: true,
        unavailableReason: null,
        model: 'deepseek-flash',
        availableMicroUsd: 20_000_000,
        lowerBoundTokens: 64_935_064,
        upperBoundTokens: 187_969_924,
        inputOutputRatio: '8:2',
        price: { inputMicroUsdPerMtok: 260_000, cachedInputMicroUsdPerMtok: 8_000, outputMicroUsdPerMtok: 500_000 },
      },
    })
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1', fetchImpl })
    const me = await api.me('access-1')
    expect(me.estimate?.lowerBoundTokens).toBe(64_935_064)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://cloud.test/v1/me')
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer access-1')
  })

  it('/v1/me/usage 只编码给出的参数并保住游标', async () => {
    const fetchImpl = stubFetch({
      items: [{
        requestId: 'req-1',
        source: 'user',
        model: 'deepseek-flash',
        promptTokens: 10,
        cachedTokens: 2,
        completionTokens: 3,
        costMicroUsd: 42,
        status: 'settled',
        createdAt: '2026-11-07T10:00:00.000Z',
      }],
      nextCursor: 'c2',
    })
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1/', fetchImpl })
    const page = await api.usage('access-1', { limit: 20, cursor: 'c1', modelId: 'deepseek-flash' })
    expect(page.nextCursor).toBe('c2')
    expect(page.items[0]?.requestId).toBe('req-1')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://cloud.test/v1/me/usage?limit=20&cursor=c1&modelId=deepseek-flash',
    )
  })

  it('/v1/me/usage 没有参数时不带问号', async () => {
    const fetchImpl = stubFetch({ items: [], nextCursor: null })
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1', fetchImpl })
    await api.usage('access-1', {})
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://cloud.test/v1/me/usage')
  })

  it('流水字段不完整时按响应错误停下', async () => {
    const fetchImpl = stubFetch({ items: [{ requestId: 'only-id' }], nextCursor: null })
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1', fetchImpl })
    await expect(api.usage('access-1', {})).rejects.toBeInstanceOf(CloudApiError)
  })
})

/** 一条线上人才的完整响应体。 */
const TALENT_BODY = {
  id: '0f4c2f3e-1f4a-4d5e-8a1b-2c3d4e5f6a7b',
  scope: 'project',
  projectId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  ownerUserId: 'u1',
  createdBy: 'ai',
  name: '评审人才',
  description: '只看不改',
  config: {
    version: 1,
    basePreset: 'maniu-review',
    persona: '你是评审',
    plugins: [{ name: '@deepseek-ai/dsh-tool-todo' }],
    tools: ['file_read'],
    model: { provider: 'lcoder-cloud', modelId: 'deepseek-flash' },
    budget: { maxCostMicroUsd: 250_000, maxRequestsPerSession: 4 },
  },
  revision: 3,
  canManage: true,
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:05:00.000Z',
}

describe('云端人才 HTTP 面', () => {
  it('按 scope 与 projectId 编码列表查询并解析权限与配置', async () => {
    const fetchImpl = stubFetch({ items: [TALENT_BODY] })
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1', fetchImpl })
    const page = await api.talents('access-1', { scope: 'project', projectId: TALENT_BODY.projectId })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://cloud.test/v1/talents?scope=project&projectId=${TALENT_BODY.projectId}`,
    )
    expect(page.items[0]).toMatchObject({ id: TALENT_BODY.id, canManage: true, revision: 3, createdBy: 'ai' })
    expect(page.items[0]?.config.tools).toEqual(['file_read'])
    expect(page.items[0]?.config.budget).toEqual({ maxCostMicroUsd: 250_000, maxRequestsPerSession: 4 })
  })

  it('全局列表不带 projectId，空查询不带问号', async () => {
    const fetchImpl = stubFetch({ items: [] })
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1', fetchImpl })
    await api.talents('access-1', {})
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://cloud.test/v1/talents')
  })

  it('新建人才用 POST 提交作用域、来源与配置', async () => {
    const fetchImpl = stubFetch(TALENT_BODY, 201)
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1', fetchImpl })
    const created = await api.createTalent('access-1', {
      scope: 'project',
      projectId: TALENT_BODY.projectId,
      createdBy: 'ai',
      name: '评审人才',
      description: '只看不改',
      config: TALENT_BODY.config,
    })
    expect(created.id).toBe(TALENT_BODY.id)
    const init = fetchImpl.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    const body = bodyOf(init)
    expect(body).toMatchObject({ scope: 'project', createdBy: 'ai', name: '评审人才' })
    expect(body).not.toHaveProperty('correlationId')
  })

  it('更新人才用 PATCH 并带上乐观版本', async () => {
    const fetchImpl = stubFetch({ ...TALENT_BODY, revision: 4 })
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1', fetchImpl })
    const updated = await api.updateTalent('access-1', {
      id: TALENT_BODY.id,
      name: '评审人才 v2',
      expectedRevision: 3,
    })
    expect(updated.revision).toBe(4)
    const init = fetchImpl.mock.calls[0]?.[1]
    expect(init?.method).toBe('PATCH')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`https://cloud.test/v1/talents/${TALENT_BODY.id}`)
    expect(bodyOf(init)).toEqual({ name: '评审人才 v2', expectedRevision: 3 })  })

  it('删除人才用 DELETE 并接受 204 空响应', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1', fetchImpl })
    await api.deleteTalent('access-1', TALENT_BODY.id)
    const init = fetchImpl.mock.calls[0]?.[1]
    expect(init?.method).toBe('DELETE')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`https://cloud.test/v1/talents/${TALENT_BODY.id}`)
  })

  it('人才条目缺字段时按响应错误停下', async () => {
    const fetchImpl = stubFetch({ items: [{ id: 'only-id' }] })
    const api = new CloudApi({ baseUrl: 'https://cloud.test/v1', fetchImpl })
    await expect(api.talents('access-1', {})).rejects.toBeInstanceOf(CloudApiError)
  })
})
