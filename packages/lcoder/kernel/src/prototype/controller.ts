/**
 * 原型宿主 Remote：`prefetch` / `uploadRef` / `clear`。
 *
 * `prefetch` 复用宿主已启用的 `ctx.web.fetch()`（web-fetch-http 提供方），
 * 只回结构化样式摘要；`uploadRef` 与 `clear` 把参考图和清理写进会话工作区的
 * `.spec/prototypes/<编号>/`。三项都是窄口：Web/Node 不在渲染端出现，
 * 不可信网页原文不回传，也不灌进模型。
 *
 * 控制器本身只做依赖解析与结果包装；URL 校验、摘要折取与路径规则都在
 * `summary.ts` / `paths.ts` / `store.ts`，可单独测试。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-web'
import { join } from 'node:path'

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { assertRequirementId } from '../kernel/requirement-store.js'
import { assertFetchableUrl, isHtmlBody, PrototypeError, summarizeHtml } from './summary.js'
import type { StyleSummary } from './summary.js'
import { adoptPrototype, clearPrototype, writePrototypeRef } from './store.js'
import type {
  PrototypeAdoptInput, PrototypeClearInput, PrototypeOkValue,
  PrototypePrefetchInput, PrototypeRefValue, PrototypeResult, PrototypeUploadInput,
} from './types.js'

/**
 * 把宿主 Remote 失败折成界面可直接分支的结果。
 * @param error - 抛出物。
 * @returns 结构化失败。
 */
function failureOf(error: unknown): { readonly ok: false; readonly error: { readonly code: string; readonly message: string } } {
  return {
    ok: false,
    error: {
      code: error instanceof PrototypeError ? error.code : 'PROTOTYPE/FAILED',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

/** 原型宿主 Remote 服务。 */
export class PrototypeController extends TypertRemoteService {
  /**
   * @param ctx - 宿主上下文。
   */
  constructor(ctx: Context) {
    super(ctx, 'prototype', { namespace: 'prototype' })
  }

  /**
   * 抓一个网页 URL，只回样式摘要。非 HTML 正文没有样式可抽取，按失败处理。
   * @param input - 网页 URL。
   * @returns 结构化摘要；URL 非法、取不到 web 服务或抓取失败都走 `ok: false`。
   */
  @Remote
  async prefetch(input: PrototypePrefetchInput): Promise<PrototypeResult<StyleSummary>> {
    try {
      const url = assertFetchableUrl(input.url)
      const web = this.ctx.get('web')
      if (web === undefined) {
        return failureOf(new PrototypeError('宿主没有启用网页抓取服务', 'PROTOTYPE/WEB_UNAVAILABLE'))
      }
      const result = await web.fetch({ url: url.href })
      if (!isHtmlBody(result.body)) {
        return failureOf(new PrototypeError('这个网页不是 HTML，无法抽取样式', 'PROTOTYPE/UNSUPPORTED_CONTENT'))
      }
      return { ok: true, value: summarizeHtml(url.href, result.body.content) }
    } catch (error: unknown) {
      return failureOf(error)
    }
  }

  /**
   * 把一张参考图写进会话工作区的原型 refs 目录。
   * @param input - 会话号、需求编号、文件名与 base64 字节。
   * @returns 规格根相对路径与字节数。
   */
  @Remote
  async uploadRef(input: PrototypeUploadInput): Promise<PrototypeResult<PrototypeRefValue>> {
    try {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return { ok: true, value: writePrototypeRef(root, id, input.name, input.data) }
    } catch (error: unknown) {
      return failureOf(error)
    }
  }

  /**
   * 清除一条需求的原型字段与目录。
   * @param input - 会话号与需求编号。
   * @returns 成功标记。
   */
  @Remote
  async clear(input: PrototypeClearInput): Promise<PrototypeResult<PrototypeOkValue>> {
    try {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      clearPrototype(root, id)
      return { ok: true, value: { ok: true } }
    } catch (error: unknown) {
      return failureOf(error)
    }
  }

  /**
   * 采纳一条需求的原型：在登记上写采纳时刻。
   * @param input - 会话号与需求编号。
   * @returns 成功标记。
   */
  @Remote
  async adopt(input: PrototypeAdoptInput): Promise<PrototypeResult<PrototypeOkValue>> {
    try {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      adoptPrototype(root, id, new Date().toISOString())
      return { ok: true, value: { ok: true } }
    } catch (error: unknown) {
      return failureOf(error)
    }
  }

  /**
   * 从会话号解析规格根；cold 会话或没有工作区时显式失败。
   * @param sessionId - 会话号。
   * @returns 规格根绝对路径。
   */
  private specRootOf(sessionId: SessionId): string {
    const sessions = this.ctx.get('sessions')
    const header = sessions?.get(sessionId)?.header
    if (header === undefined || header.cwd === undefined) {
      throw new PrototypeError('会话不存在或没有工作区', 'PROTOTYPE/NO_WORKSPACE')
    }
    return join(header.cwd, '.spec')
  }
}
