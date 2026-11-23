/**
 * 原型宿主 Remote：`prefetch` / `uploadRef` / `clear` / `adopt`，以及暂存与快照的
 * `getStaged` / `commitStaged` / `discardStaged` / `listSnapshots` / `restoreSnapshot`。
 *
 * `prefetch` 复用宿主已启用的 `ctx.web.fetch()`（web-fetch-http 提供方），
 * 只回结构化样式摘要；其余方法把原型产物写进会话工作区的
 * `.spec/prototypes/<编号>/`。全部是窄口：Web/Node 不在渲染端出现，
 * 不可信网页原文不回传，也不灌进模型；暂存与快照只经模型工具写暂存，
 * 正式版与需求正文的落盘由宿主按评审状态受控执行。
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
import {
  adoptPrototype, clearPrototype, commitStagedPrototype, discardStagedPrototype,
  listSnapshots as listPrototypeSnapshots, readPrototypeHtml, readStagedPrototype,
  restoreSnapshot as restorePrototypeSnapshot, writePrototypeRef,
} from './store.js'
import type {
  PrototypeAdoptInput, PrototypeClearInput, PrototypeCommitStagedInput, PrototypeCommitResult,
  PrototypeListSnapshotsValue, PrototypeOkValue, PrototypePrefetchInput, PrototypeRefValue,
  PrototypeRestoreSnapshotInput, PrototypeRestoreSnapshotValue, PrototypeResult,
  PrototypeScopeInput, PrototypeStagedView, PrototypeUploadInput,
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

/**
 * 把同步的宿主调用折成 Promise，并统一包装失败；Remote 方法因此只做依赖解析。
 * @param run - 同步业务分支。
 * @returns 结构化结果。
 */
function resultOf<T>(run: () => PrototypeResult<T>): Promise<PrototypeResult<T>> {
  try {
    return Promise.resolve(run())
  } catch (error: unknown) {
    return Promise.resolve(failureOf(error))
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
  uploadRef(input: PrototypeUploadInput): Promise<PrototypeResult<PrototypeRefValue>> {
    return resultOf(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return { ok: true, value: writePrototypeRef(root, id, input.name, input.data) }
    })
  }

  /**
   * 清除一条需求的原型字段与目录。
   * @param input - 会话号与需求编号。
   * @returns 成功标记。
   */
  @Remote
  clear(input: PrototypeClearInput): Promise<PrototypeResult<PrototypeOkValue>> {
    return resultOf(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      clearPrototype(root, id)
      return { ok: true, value: { ok: true } }
    })
  }

  /**
   * 采纳一条需求的原型：在登记上写采纳时刻。
   * @param input - 会话号与需求编号。
   * @returns 成功标记。
   */
  @Remote
  adopt(input: PrototypeAdoptInput): Promise<PrototypeResult<PrototypeOkValue>> {
    return resultOf(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      adoptPrototype(root, id, new Date().toISOString())
      return { ok: true, value: { ok: true } }
    })
  }

  /**
   * 读一条需求的暂存原型与当前正式版 HTML。
   * @param input - 会话号与需求编号。
   * @returns 暂存视图；没有暂存或没有正式版时对应字段为 null。
   */
  @Remote
  getStaged(input: PrototypeScopeInput): Promise<PrototypeResult<PrototypeStagedView>> {
    return resultOf(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return {
        ok: true,
        value: {
          staged: readStagedPrototype(root, id),
          committedHtml: readPrototypeHtml(root, id) ?? null,
        },
      }
    })
  }

  /**
   * 提交暂存：归档旧版、写回正式版，并按需求状态受控同步正文。
   * @param input - 会话号、需求编号与可选的正文回写开关。
   * @returns 提交时刻、归档编号与正文同步结果。
   */
  @Remote
  commitStaged(input: PrototypeCommitStagedInput): Promise<PrototypeResult<PrototypeCommitResult>> {
    return resultOf(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return { ok: true, value: commitStagedPrototype(root, id, input) }
    })
  }

  /**
   * 丢弃一条需求的暂存原型；正式版与需求正文不受影响。
   * @param input - 会话号与需求编号。
   * @returns 成功标记。
   */
  @Remote
  discardStaged(input: PrototypeScopeInput): Promise<PrototypeResult<PrototypeOkValue>> {
    return resultOf(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      discardStagedPrototype(root, id)
      return { ok: true, value: { ok: true } }
    })
  }

  /**
   * 列出一条需求的历史快照，按时间倒序、最多 10 条。
   * @param input - 会话号与需求编号。
   * @returns 快照元数据列表。
   */
  @Remote
  listSnapshots(input: PrototypeScopeInput): Promise<PrototypeResult<PrototypeListSnapshotsValue>> {
    return resultOf(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return { ok: true, value: { snapshots: listPrototypeSnapshots(root, id) } }
    })
  }

  /**
   * 恢复一份历史快照：当前正式版先归档，再把快照写回并刷新 YAML 登记。
   * @param input - 会话号、需求编号与快照编号。
   * @returns 恢复时刻与恢复后的 HTML。
   */
  @Remote
  restoreSnapshot(input: PrototypeRestoreSnapshotInput): Promise<PrototypeResult<PrototypeRestoreSnapshotValue>> {
    return resultOf(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return { ok: true, value: restorePrototypeSnapshot(root, id, input.snapshotId) }
    })
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
