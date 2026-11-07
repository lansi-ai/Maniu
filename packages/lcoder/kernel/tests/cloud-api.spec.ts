/**
 * 云端 HTTP 面的线上字段：`/v1/me` 的预估解析与 `/v1/me/usage` 的查询编码。
 *
 * fetch 全部用记录器替身；这里不碰网络，也不重复展开令牌生命周期。
 */
import { describe, expect, it, vi } from 'vitest'
import { CloudApi, CloudApiError, parseTokenEstimate } from '../src/cloud/api.ts'

/** 记下请求并回一个 JSON 响应。 */
function stubFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(
    JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json' } },
  ))
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
