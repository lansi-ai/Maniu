/**
 * 模型可用性与会话失败的纯判定。
 *
 * 这两条判据决定了外壳会不会静默：缺凭据时消息照常被接受，失败只落在会话快照的
 * `lastAgentError` 上，事件流里什么都没有。所以判定要能单独钉死。
 */
import { describe, expect, it } from 'vitest'

import {
  catalogHasModel, noticeFromSnapshot, statusFromCatalog, statusOfFailure,
} from '../src/client/model-status.ts'
import type { ModelCatalogLike } from '../src/client/model-status.ts'

const EMPTY_CATALOG: ModelCatalogLike = { routableProviders: [], groups: [] }

describe('模型可用性', () => {
  it('没有可路由 provider、也没有任何模型 → empty', () => {
    expect(catalogHasModel(EMPTY_CATALOG)).toBe(false)
    expect(statusFromCatalog(EMPTY_CATALOG)).toEqual({ state: 'empty', detail: '' })
  })

  it('provider 可路由即算可用，哪怕目录分组还没填', () => {
    expect(statusFromCatalog({ ...EMPTY_CATALOG, routableProviders: ['deepseek'] })).toEqual({ state: 'ready' })
  })

  it('任一分组有模型也算可用', () => {
    const catalog: ModelCatalogLike = { routableProviders: [], groups: [{ id: 'deepseek-account', models: [{ id: 'm' }] }] }
    expect(catalogHasModel(catalog)).toBe(true)
  })

  it('provider 查模型失败时把原因带出来，供外壳原样显示', () => {
    const catalog: ModelCatalogLike = {
      ...EMPTY_CATALOG,
      failures: [{ id: 'deepseek', name: 'DeepSeek', message: 'no api key configured' }],
    }
    expect(statusFromCatalog(catalog)).toEqual({ state: 'empty', detail: 'DeepSeek: no api key configured' })
  })

  it('目录查询本身失败 → unknown，不冒充「没有凭据」', () => {
    expect(statusOfFailure('gateway/internal', 'boom')).toEqual({ state: 'unknown', detail: 'gateway/internal: boom' })
  })
})

describe('会话快照的失败', () => {
  it('准入被拒优先，并带上宿主的 code 与 message', () => {
    const notice = noticeFromSnapshot({
      promptError: { op: 'send', error: { code: 'session/model-unavailable', message: 'Select an available model.' } },
      lastAgentError: '别的旧错',
    })
    expect(notice).toEqual({
      key: 'shell.sendRefused',
      detail: 'session/model-unavailable: Select an available model.',
    })
  })

  it('准入之外没有可显示的：外壳没有停止按钮，stop 类失败冒出来只会误导', () => {
    expect(noticeFromSnapshot({ promptError: { op: 'stop', error: { code: 'gateway/cancelled', message: 'x' } } })).toBeNull()
  })

  it('回合失败读 lastAgentError', () => {
    expect(noticeFromSnapshot({ promptError: null, lastAgentError: 'no credentials' })).toEqual({
      key: 'shell.turnFailed', detail: 'no credentials',
    })
  })

  it('空白与缺失都不编造提示', () => {
    expect(noticeFromSnapshot({})).toBeNull()
    expect(noticeFromSnapshot({ promptError: null, lastAgentError: '' })).toBeNull()
  })

  it('准入被拒但没有 code 时仍给出一条可读的说明', () => {
    expect(noticeFromSnapshot({ promptError: { op: 'send' } })?.detail).toContain('gateway/internal')
  })
})
