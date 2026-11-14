/** 已提交图片的取回：调用形状与失败原话。 */
import { describe, expect, it } from 'vitest'
import { attachmentImageUrl, type UnaryCall } from '../src/chat/attachments.ts'
import type { RemoteResult } from '../src/contract.ts'
import type { ChatImageAttachment } from '../src/store.ts'

const image: ChatImageAttachment = {
  attachmentId: 'att-1',
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
  name: 'pixel.png',
}

describe('attachmentImageUrl', () => {
  it('按会话附件回执取字节并拼成 data URL', async () => {
    let captured: { namespace: string; method: string; args: object } | undefined
    const call: UnaryCall = async (namespace, method, args) => {
      captured = { namespace, method, args }
      return {
        ok: true,
        value: { attachment: { mediaType: 'image/png' }, data: 'AAAA' },
      } satisfies RemoteResult
    }
    await expect(attachmentImageUrl('s-1', image, call)).resolves.toBe('data:image/png;base64,AAAA')
    expect(captured).toEqual({
      namespace: 'session',
      method: 'attachment',
      args: {
        request: {
          sessionId: 's-1',
          attachment: {
            attachmentId: 'att-1',
            mediaType: 'image/png',
            bytes: 3,
            width: 1,
            height: 1,
            name: 'pixel.png',
          },
        },
      },
    })
  })

  it('宿主失败时原样抛出', async () => {
    const call: UnaryCall = async () => ({ ok: false, error: { code: 'session/not-found', message: 'gone' } })
    await expect(attachmentImageUrl('s-1', image, call)).rejects.toThrow('session/not-found: gone')
  })

  it('回执缺少字节时拒绝冒充成功', async () => {
    const call: UnaryCall = async () => ({ ok: true, value: {} })
    await expect(attachmentImageUrl('s-1', image, call)).rejects.toThrow('图片回执缺少字节')
  })
})
