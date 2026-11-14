/** 输入区的纯判定：模型 chip、无模型门禁、上下文用量与附件上限。 */
import { describe, expect, it } from 'vitest'
import {
  CHAT_FALLBACK_IMAGE_LIMITS, attachmentsReady, buildPromptContent, checkImageCandidate, contextUsageOf,
  currentChatModel, formatTokens, imageLimitsOf, modelAvailabilityOf, modelCatalogOf, recordedModelOf,
  uploadedFile,
} from '../src/chat/composer.ts'

describe('模型目录', () => {
  const catalog = {
    default: { provider: 'p', model: 'm1' },
    routableProviders: ['p'],
    groups: [{ id: 'p', name: 'Provider', models: [{ id: 'm1', name: 'Model 1' }, { id: 'm2', name: 'Model 2' }] }],
    failures: [],
  }

  it('折出选项与默认选择', () => {
    const view = modelCatalogOf(catalog)
    expect(view.defaultChoice).toEqual({ provider: 'p', model: 'm1' })
    expect(view.options).toEqual([
      { provider: 'p', model: 'm1', providerName: 'Provider', modelName: 'Model 1' },
      { provider: 'p', model: 'm2', providerName: 'Provider', modelName: 'Model 2' },
    ])
    expect(modelAvailabilityOf(catalog)).toEqual({ kind: 'ready' })
  })

  it('没有可路由模型也没有分组时是明确的空', () => {
    expect(modelAvailabilityOf({ groups: [], routableProviders: [], failures: [{ id: 'p', name: 'P', message: 'no key' }] }))
      .toEqual({ kind: 'empty', detail: 'P: no key' })
    expect(modelAvailabilityOf(undefined)).toEqual({ kind: 'empty', detail: '' })
  })

  it('会话记录优先于目录默认', () => {
    expect(currentChatModel({ provider: 'p', model: 'm2' }, { provider: 'p', model: 'm1' }))
      .toEqual({ provider: 'p', model: 'm2', source: 'session' })
    expect(currentChatModel(null, { provider: 'p', model: 'm1' }))
      .toEqual({ provider: 'p', model: 'm1', source: 'default' })
    expect(currentChatModel(null, undefined)).toBeUndefined()
    expect(recordedModelOf({ next: { provider: 'p', model: 'm2' } })).toEqual({ provider: 'p', model: 'm2' })
    expect(recordedModelOf({ next: null })).toBeNull()
  })
})

describe('上下文用量', () => {
  it('读投影里的已用与容量，缺字段时不编造', () => {
    expect(contextUsageOf({ projectedTokens: 1200, contextWindow: 131072 })).toEqual({ used: 1200, window: 131072 })
    expect(contextUsageOf({ pressureTokens: 900 })).toEqual({ used: 900 })
    expect(contextUsageOf({ contextWindow: 131072 })).toEqual({ window: 131072 })
    expect(contextUsageOf(null)).toEqual({})
  })

  it('token 数格式化', () => {
    expect(formatTokens(980)).toBe('980')
    expect(formatTokens(12_345)).toBe('12.3k')
    expect(formatTokens(1_050_000)).toBe('1.05M')
  })
})

describe('图片上限与附件', () => {
  it('投影缺字段时退回保守上限', () => {
    expect(imageLimitsOf(undefined)).toEqual(CHAT_FALLBACK_IMAGE_LIMITS)
    expect(imageLimitsOf({ mediaTypes: [] })).toEqual(CHAT_FALLBACK_IMAGE_LIMITS)
    expect(imageLimitsOf({
      maxImageBytes: 1,
      maxImagesPerMessage: 2,
      maxMessageImageBytes: 3,
      mediaTypes: ['image/png'],
    }).maxImageBytes).toBe(1)
  })

  it('按类型、单张、张数与合计拒绝图片', () => {
    const limits = CHAT_FALLBACK_IMAGE_LIMITS
    const image = { id: 'i', kind: 'image' as const, name: 'a', bytes: 10, mediaType: 'image/png' as const, data: 'x' }
    expect(checkImageCandidate('image/bmp', 10, [], limits)).toMatchObject({ kind: 'unsupported-type' })
    expect(checkImageCandidate('image/png', limits.maxImageBytes + 1, [], limits)).toMatchObject({ kind: 'too-large' })
    expect(checkImageCandidate('image/png', 10, Array.from({ length: limits.maxImagesPerMessage }, () => image), limits))
      .toMatchObject({ kind: 'too-many' })
    const narrowTotal = { ...limits, maxImageBytes: 100, maxMessageImageBytes: 15 }
    expect(checkImageCandidate('image/png', 10, [image], narrowTotal)).toMatchObject({ kind: 'total-too-large' })
    expect(checkImageCandidate('image/png', 10, [image], limits)).toBeNull()
  })

  it('文件没传完不能发，拼装内容时拒绝对未就绪附件静默跳过', () => {
    const uploading = { id: 'f1', kind: 'file' as const, name: 'a.md', bytes: 3, status: 'uploading' as const }
    expect(attachmentsReady([uploading])).toBe(false)
    expect(() => buildPromptContent('hi', [uploading])).toThrow(/not uploaded/u)
    const uploaded = uploadedFile('f1', 'a.md', 3, { ok: true, receiptId: 'r1' })
    expect(attachmentsReady([uploaded])).toBe(true)
    expect(buildPromptContent('hi', [{
      id: 'i1', kind: 'image', name: 'a.png', bytes: 4, mediaType: 'image/png', data: 'AAAA',
    }, uploaded])).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'a.png' },
      { type: 'file', receiptId: 'r1' },
    ])
  })

  it('上传失败保留宿主原话', () => {
    expect(uploadedFile('f1', 'a.md', 3, { ok: false, code: 'c', message: 'm' }))
      .toMatchObject({ status: 'failed', error: 'c: m' })
  })
})
