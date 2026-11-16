/** LCODER_DEBUG=1 时把模型链的关键事件追加到 `lcoder/logs/model-debug.log`。 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { StreamFrame } from './contract.ts'
import { REPO_ROOT } from './profile.ts'

/** 只记模型链的边界事件；正文与思考增量不落盘。 */
const WATCHED_EVENTS: ReadonlySet<string> = new Set([
  'llm/retry',
  'llm/retry-started',
  'turn/start',
  'turn/end',
])

const DETAIL_LIMIT = 300

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitize(text: string): string {
  const masked = text
    .replace(/sk-[A-Za-z0-9_-]{6,}/gu, '<redacted>')
    .replace(/Bearer\s+[\w.-]+/giu, 'Bearer <redacted>')
    .replace(/\s+/gu, ' ')
    .trim()
  return masked.length > DETAIL_LIMIT ? `${masked.slice(0, DETAIL_LIMIT)}…` : masked
}

function field(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value : '-'
}

function failureFacts(data: unknown): { requestId: string; status: string; detail: string } {
  const reason = isRecord(data) && isRecord(data.reason) ? data.reason : undefined
  const error = isRecord(reason) && isRecord(reason.error)
    ? reason.error
    : isRecord(data) && isRecord(data.failure) ? data.failure : undefined
  const message = isRecord(error) && typeof error.message === 'string' ? error.message : ''
  const kind = isRecord(reason) && typeof reason.kind === 'string' ? reason.kind : ''
  // 云端 502 的请求号常被适配器拼进 message，只有状态码没有结构化字段。
  const embeddedId = /"request_?id"\s*:\s*"([^"]+)"/iu.exec(message)?.[1]
  const embeddedStatus = /(?:^|\s)(\d{3})\s*:/u.exec(message)?.[1]
  return {
    requestId: field(isRecord(error) && typeof error.requestId === 'string' ? error.requestId : embeddedId),
    status: isRecord(error) && typeof error.status === 'number'
      ? String(error.status)
      : field(embeddedStatus),
    detail: sanitize([kind, message].filter(part => part !== '').join(' ')),
  }
}

/**
 * 把一帧流数据转成一行调试日志；不关注的事件返回 null。
 * @param streamId - 宿主流标识。
 * @param frame - 一条逻辑流的帧。
 * @param now - 当前时间，测试注入。
 * @returns 单行文本；该帧没有可记录内容时为 null。
 */
export function modelDebugLine(streamId: string, frame: StreamFrame, now: Date = new Date()): string | null {
  const time = now.toISOString()
  if (frame.kind === 'error') {
    return `${time} stream=${streamId} event=stream-error code=${field(frame.error.code)} detail=${sanitize(frame.error.message)}`
  }
  if (frame.kind !== 'item' || !isRecord(frame.value) || typeof frame.value.type !== 'string') return null

  if (frame.value.type === 'snapshot') {
    const records = Array.isArray(frame.value.records) ? frame.value.records.length : 0
    const cursor = typeof frame.value.cursor === 'number' ? String(frame.value.cursor) : '-'
    return `${time} stream=${streamId} event=snapshot records=${String(records)} cursor=${cursor}`
  }

  if (frame.value.type !== 'event' || !isRecord(frame.value.event)) return null
  const event = frame.value.event
  if (typeof event.type !== 'string' || !WATCHED_EVENTS.has(event.type)) return null

  const facts = failureFacts(event.data)
  const retry = isRecord(event.data) && typeof event.data.retry === 'number' ? event.data.retry : undefined
  const max = isRecord(event.data) && typeof event.data.maxRetries === 'number' ? event.data.maxRetries : undefined
  // retry-started 不带上限；只有 llm/retry 的 normal 策略才给 maxRetries。
  const attempt = retry === undefined ? '-' : `${String(retry)}/${max === undefined ? '-' : String(max)}`
  return `${time} stream=${streamId} event=${event.type} attempt=${attempt} requestId=${facts.requestId} status=${facts.status} detail=${facts.detail}`
}

/** 模型调试日志；只在显式开启时存在。 */
export interface ModelDebugLog {
  /** 记录一帧；不关心或写入失败时什么也不做。 */
  record(streamId: string, frame: StreamFrame): void
}

/**
 * 按 `LCODER_DEBUG=1` 决定是否落盘。
 * @param enabled - 显式开关值。
 * @param file - 日志路径；默认仓库内 `lcoder/logs/model-debug.log`。
 * @returns 调试日志，或未开启时的 null。
 */
export function createModelDebugLog(enabled: boolean, file?: string): ModelDebugLog | null {
  if (!enabled) return null
  const target = file ?? join(REPO_ROOT, 'lcoder', 'logs', 'model-debug.log')
  try {
    mkdirSync(dirname(target), { recursive: true })
  } catch (error: unknown) {
    console.warn('lcoder desktop: 模型调试日志目录创建失败', error)
    return null
  }

  let failed = false
  return {
    record(streamId, frame) {
      if (failed) return
      const line = modelDebugLine(streamId, frame)
      if (line === null) return
      try {
        appendFileSync(target, `${line}\n`)
      } catch (error: unknown) {
        failed = true
        console.warn('lcoder desktop: 模型调试日志写入失败；本条与本轮后续记录已停用', error)
      }
    },
  }
}
