/**
 * 浮层输入区的纯判定：当前模型解析、面板三态与状态机、附件校验与拼装。
 *
 * 这些函数不碰 React 与远程面，所以这里直接断言输入输出；渲染与远程调用
 * 由外壳自己的行为覆盖。
 */
import { describe, expect, it } from 'vitest'
import {
  attachmentsReady, buildPromptContent, CHAT_FALLBACK_IMAGE_LIMITS, ChatPromptError, checkImageCandidate,
  chatModelAvailability, chatModelProviders, currentChatModel, formatBytes, INITIAL_MODEL_PANEL, isCurrentModel,
  modelChoiceKey, promptFailureOf, promptIsEmpty, reduceModelPanel, resolveImageLimits, uploadedFile,
} from '../src/client/shell/chat-composer.ts'
import type {
  ChatPendingFile, ChatPendingImage, ChatReceiptId,
} from '../src/client/shell/chat-composer.ts'
import type { ModelProviderRow, ModelSettingsSnapshot } from '../src/client/shell/model-settings.ts'

/** 一行可用的 provider；用例按需覆盖。 */
function row(overrides: Partial<ModelProviderRow> = {}): ModelProviderRow {
  return {
    provider: 'deepseek-official',
    displayName: 'DeepSeek',
    group: 'official',
    active: true,
    declared: false,
    account: false,
    settingsNs: 'llm-deepseek',
    settingsPath: [],
    revision: 1,
    baseURLEnv: [],
    modelIds: [],
    profilePresent: true,
    removable: false,
    apiKeyConfigured: true,
    apiKeyWritable: true,
    nativeConfigured: false,
    nativeEnv: [],
    models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    accountAvailable: true,
    ...overrides,
  }
}

function snapshot(rows: readonly ModelProviderRow[], status: 'ready' | 'error' = 'ready'): ModelSettingsSnapshot {
  return {
    status,
    error: status === 'error' ? 'gateway/timeout: catalog offline' : null,
    credentialError: null,
    writable: true,
    rows,
    protocols: [],
  }
}

const IMAGE: ChatPendingImage = {
  id: 'image-1',
  kind: 'image',
  name: 'shot.png',
  bytes: 3,
  mediaType: 'image/png',
  data: 'AAA',
}

const FILE: ChatPendingFile = {
  id: 'file-1',
  kind: 'file',
  name: 'notes.txt',
  bytes: 5,
  status: 'ready',
  receiptId: 'receipt-1' as ChatReceiptId,
}

describe('current model', () => {
  it('prefers the recorded session selection', () => {
    expect(currentChatModel({ provider: 'p', model: 'm' }, { provider: 'd', model: 'x' })).toEqual({
      provider: 'p', model: 'm', source: 'session',
    })
  })

  it('falls back to the catalog default and marks it as default', () => {
    expect(currentChatModel(null, { provider: 'd', model: 'x' })).toEqual({
      provider: 'd', model: 'x', source: 'default',
    })
    expect(currentChatModel(undefined, { provider: 'd', model: 'x' })?.source).toBe('default')
  })

  it('stays empty when neither the session nor the catalog names a model', () => {
    expect(currentChatModel(null, undefined)).toBeUndefined()
  })

  it('matches a choice by both provider and model', () => {
    expect(isCurrentModel({ provider: 'p', model: 'm' }, 'p', 'm')).toBe(true)
    expect(isCurrentModel({ provider: 'p', model: 'm' }, 'p', 'other')).toBe(false)
    expect(isCurrentModel(undefined, 'p', 'm')).toBe(false)
    expect(modelChoiceKey('p', 'm')).not.toBe(modelChoiceKey('p\u0000m', ''))
  })
})

describe('model provider rows and availability', () => {
  it('keeps only providers with models and marks unusable reasons', () => {
    const rows = [
      row(),
      row({ provider: 'idle', displayName: 'Idle', active: false }),
      row({ provider: 'signed-out', displayName: 'Account', account: true, accountAvailable: false, apiKeyConfigured: false }),
      row({ provider: 'no-key', displayName: 'No key', apiKeyConfigured: false }),
      row({ provider: 'empty', displayName: 'Empty', models: [] }),
    ]
    const providers = chatModelProviders(snapshot(rows))
    expect(providers.map(provider => provider.provider)).toEqual(['deepseek-official', 'idle', 'signed-out', 'no-key'])
    expect(providers.map(provider => provider.reason)).toEqual([undefined, 'inactive', 'account', 'no-key'])
    expect(providers[0]?.usable).toBe(true)
  })

  it('separates query failure, an empty catalog, and missing credentials', () => {
    expect(chatModelAvailability(null)).toEqual({ kind: 'loading' })
    expect(chatModelAvailability(snapshot([], 'error'))).toEqual({
      kind: 'error', detail: 'gateway/timeout: catalog offline',
    })
    expect(chatModelAvailability(snapshot([row({ models: [] })]))).toEqual({ kind: 'empty' })
    expect(chatModelAvailability(snapshot([row({ apiKeyConfigured: false })]))).toEqual({ kind: 'no-credential' })
    expect(chatModelAvailability(snapshot([row()]))).toEqual({ kind: 'ready' })
  })
})

describe('model panel state machine', () => {
  const loaded = snapshot([row()])

  it('opens into loading and closes back to idle', () => {
    const open = reduceModelPanel(INITIAL_MODEL_PANEL, { type: 'toggle' })
    expect(open).toMatchObject({ open: true, loading: true, failure: null })
    const closed = reduceModelPanel(open, { type: 'toggle' })
    expect(closed.open).toBe(false)
    expect(closed.loading).toBe(false)
  })

  it('loads the snapshot without closing the panel', () => {
    const state = reduceModelPanel(
      reduceModelPanel(INITIAL_MODEL_PANEL, { type: 'toggle' }),
      { type: 'load', snapshot: loaded },
    )
    expect(state).toMatchObject({ open: true, loading: false, failure: null })
    expect(state.snapshot).toBe(loaded)
  })

  it('closes with the refreshed snapshot after a successful pick', () => {
    const picking = reduceModelPanel(
      reduceModelPanel(INITIAL_MODEL_PANEL, { type: 'toggle' }),
      { type: 'pick', key: modelChoiceKey('deepseek-official', 'deepseek-chat') },
    )
    expect(picking.busyKey).toBe(modelChoiceKey('deepseek-official', 'deepseek-chat'))
    const picked = reduceModelPanel(picking, { type: 'picked', snapshot: loaded })
    expect(picked).toMatchObject({ open: false, busyKey: null, failure: null, loading: false })
  })

  it('keeps the panel open and reports the original failure when a pick fails', () => {
    const failed = reduceModelPanel(
      { ...INITIAL_MODEL_PANEL, open: true, busyKey: 'k' },
      { type: 'pick-failed', detail: 'session/model-unavailable' },
    )
    expect(failed).toMatchObject({ open: true, busyKey: null, failure: 'session/model-unavailable' })
  })

  it('clears busy and failure on close', () => {
    expect(reduceModelPanel(
      { ...INITIAL_MODEL_PANEL, open: true, busyKey: 'k', failure: 'x' },
      { type: 'close' },
    )).toEqual({ ...INITIAL_MODEL_PANEL })
  })
})

describe('image limits', () => {
  it('uses the projected limits and falls back when the projection is absent', () => {
    expect(resolveImageLimits(undefined)).toBe(CHAT_FALLBACK_IMAGE_LIMITS)
    const projected = { ...CHAT_FALLBACK_IMAGE_LIMITS, maxImageBytes: 2048, mediaTypes: ['image/png'] }
    expect(resolveImageLimits(projected)).toBe(projected)
    expect(resolveImageLimits({ ...projected, mediaTypes: [] })).toBe(CHAT_FALLBACK_IMAGE_LIMITS)
  })

  it('rejects an unsupported media type before reading the bytes', () => {
    expect(checkImageCandidate('image/bmp', 10, [], CHAT_FALLBACK_IMAGE_LIMITS)).toEqual({
      kind: 'unsupported-type',
      mediaTypes: [...CHAT_FALLBACK_IMAGE_LIMITS.mediaTypes],
    })
  })

  it('rejects one image over the per-image byte limit with the effective limit', () => {
    expect(checkImageCandidate('image/png', 2049, [], {
      ...CHAT_FALLBACK_IMAGE_LIMITS, maxImageBytes: 2048,
    })).toEqual({ kind: 'too-large', limit: 2048 })
  })

  it('rejects one image past the count limit', () => {
    expect(checkImageCandidate('image/png', 10, [IMAGE], {
      ...CHAT_FALLBACK_IMAGE_LIMITS, maxImagesPerMessage: 1,
    })).toEqual({ kind: 'too-many', limit: 1 })
  })

  it('rejects the total once the message image bytes would exceed the limit', () => {
    expect(checkImageCandidate('image/png', 10, [{ ...IMAGE, bytes: 95 }], {
      ...CHAT_FALLBACK_IMAGE_LIMITS, maxImageBytes: 100, maxMessageImageBytes: 100,
    })).toEqual({ kind: 'total-too-large', limit: 100 })
  })

  it('accepts an image inside every limit', () => {
    expect(checkImageCandidate('image/png', 10, [IMAGE], CHAT_FALLBACK_IMAGE_LIMITS)).toBeNull()
  })
})

describe('file uploads', () => {
  it('turns a successful upload into a ready file with its receipt', () => {
    expect(uploadedFile('f', 'notes.txt', 5, {
      ok: true, receiptId: 'receipt-9' as ChatReceiptId,
    })).toEqual({
      id: 'f', kind: 'file', name: 'notes.txt', bytes: 5, status: 'ready', receiptId: 'receipt-9',
    })
  })

  it('keeps the Host message and code on a failed upload', () => {
    expect(uploadedFile('f', 'notes.txt', 5, {
      ok: false, code: 'gateway/internal', message: 'disk is full',
    })).toEqual({
      id: 'f', kind: 'file', name: 'notes.txt', bytes: 5, status: 'failed',
      errorCode: 'gateway/internal', error: 'disk is full',
    })
  })

  it('blocks sending until every file is ready', () => {
    expect(attachmentsReady([IMAGE, FILE])).toBe(true)
    expect(attachmentsReady([{ id: 'f', kind: 'file', name: 'x', bytes: 1, status: 'uploading' }])).toBe(false)
    expect(attachmentsReady([{ ...FILE, status: 'failed' }])).toBe(false)
  })
})

describe('prompt assembly', () => {
  it('puts text first, then images, then files, keeping their fields', () => {
    const parts = buildPromptContent('  hello  ', [FILE, IMAGE])
    expect(parts).toEqual([
      { type: 'text', text: '  hello  ' },
      { type: 'image', mediaType: 'image/png', data: 'AAA', name: 'shot.png' },
      { type: 'file', receiptId: 'receipt-1' },
    ])
  })

  it('sends attachments without any text', () => {
    expect(buildPromptContent('', [IMAGE])).toHaveLength(1)
    expect(buildPromptContent('', [FILE])).toEqual([{ type: 'file', receiptId: 'receipt-1' }])
  })

  it('refuses to assemble a file that has not finished uploading', () => {
    const uploading: ChatPendingFile = { id: 'f2', kind: 'file', name: 'x', bytes: 1, status: 'uploading' }
    expect(() => buildPromptContent('', [uploading])).toThrow('is not uploaded yet')
  })

  it('treats blank text without attachments as empty', () => {
    expect(promptIsEmpty('   ', [])).toBe(true)
    expect(promptIsEmpty('', [IMAGE])).toBe(false)
    expect(promptIsEmpty('x', [])).toBe(false)
  })
})

describe('send failures', () => {
  it('preserves the Host code, reason, and message', () => {
    expect(promptFailureOf(new ChatPromptError(
      'session/attachment-invalid',
      'Model "x" does not support image input.',
      'MODEL_DOES_NOT_SUPPORT_IMAGES',
    ))).toEqual({
      code: 'session/attachment-invalid',
      reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES',
      message: 'Model "x" does not support image input.',
    })
  })

  it('folds a plain error into an unknown failure', () => {
    expect(promptFailureOf(new Error('boom'))).toEqual({ code: 'unknown', reason: '', message: 'boom' })
    expect(promptFailureOf('boom')).toEqual({ code: 'unknown', reason: '', message: 'boom' })
  })
})

describe('byte labels', () => {
  it('uses MB, KB, and bytes at their boundaries', () => {
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(2048)).toBe('2KB')
    expect(formatBytes(1024 * 1024)).toBe('1MB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5MB')
  })
})
