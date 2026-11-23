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
 * 每个方法都返回裸业务值：typert 的 wire 信封自己包一层 `{ ok, value }`，
 * 方法再包一层就成了双层，界面只剥一层会拿到 `undefined`。失败一律抛
 * `RemoteError`（见 `errors.ts`），由 typert 折成 `{ ok: false, error }`。
 * URL 校验、摘要折取与路径规则都在 `summary.ts` / `paths.ts` / `store.ts`。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-web'
import { join } from 'node:path'

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { assertRequirementId } from '../kernel/requirement-store.js'
import { toRemoteError } from './errors.js'
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
  PrototypeRestoreSnapshotInput, PrototypeRestoreSnapshotValue, PrototypeScopeInput,
  PrototypeStagedView, PrototypeUploadInput,
} from './types.js'

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
   * @returns 结构化摘要。
   * @throws {RemoteError} `PROTOTYPE/INVALID_URL`、`PROTOTYPE/WEB_UNAVAILABLE`、
   * `PROTOTYPE/UNSUPPORTED_CONTENT`，或抓取本身失败折成的 `PROTOTYPE/FAILED`。
   */
  @Remote
  prefetch(input: PrototypePrefetchInput): Promise<StyleSummary> {
    return this.perform(async () => {
      const url = assertFetchableUrl(input.url)
      const web = this.ctx.get('web')
      if (web === undefined) throw new PrototypeError('宿主没有启用网页抓取服务', 'PROTOTYPE/WEB_UNAVAILABLE')
      const result = await web.fetch({ url: url.href })
      if (!isHtmlBody(result.body)) throw new PrototypeError('这个网页不是 HTML，无法抽取样式', 'PROTOTYPE/UNSUPPORTED_CONTENT')
      return summarizeHtml(url.href, result.body.content)
    })
  }

  /**
   * 把一张参考图写进会话工作区的原型 refs 目录。
   * @param input - 会话号、需求编号、文件名与 base64 字节。
   * @returns 规格根相对路径与字节数。
   * @throws {RemoteError} `PROTOTYPE/NO_WORKSPACE`，或文件名、字节不合法折成的 `PROTOTYPE/FAILED`。
   */
  @Remote
  uploadRef(input: PrototypeUploadInput): Promise<PrototypeRefValue> {
    return this.perform(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return writePrototypeRef(root, id, input.name, input.data)
    })
  }

  /**
   * 清除一条需求的原型字段与目录。
   * @param input - 会话号与需求编号。
   * @returns 成功标记。
   * @throws {RemoteError} `PROTOTYPE/NO_WORKSPACE`，或清除失败折成的 `PROTOTYPE/FAILED`。
   */
  @Remote
  clear(input: PrototypeClearInput): Promise<PrototypeOkValue> {
    return this.perform(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      clearPrototype(root, id)
      return { ok: true }
    })
  }

  /**
   * 采纳一条需求的原型：在登记上写采纳时刻。
   * @param input - 会话号与需求编号。
   * @returns 成功标记。
   * @throws {RemoteError} `PROTOTYPE/NO_WORKSPACE`，或登记写入失败折成的 `PROTOTYPE/FAILED`。
   */
  @Remote
  adopt(input: PrototypeAdoptInput): Promise<PrototypeOkValue> {
    return this.perform(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      adoptPrototype(root, id, new Date().toISOString())
      return { ok: true }
    })
  }

  /**
   * 读一条需求的暂存原型与当前正式版 HTML。
   * @param input - 会话号与需求编号。
   * @returns 暂存视图；没有暂存或没有正式版时对应字段为 null。
   * @throws {RemoteError} `PROTOTYPE/NO_WORKSPACE`，或读取失败折成的 `PROTOTYPE/FAILED`。
   */
  @Remote
  getStaged(input: PrototypeScopeInput): Promise<PrototypeStagedView> {
    return this.perform(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return {
        staged: readStagedPrototype(root, id),
        committedHtml: readPrototypeHtml(root, id) ?? null,
      }
    })
  }

  /**
   * 提交暂存：归档旧版、写回正式版，并按需求状态受控同步正文。
   * @param input - 会话号、需求编号与可选的正文回写开关。
   * @returns 提交时刻、归档编号与正文同步结果。
   * @throws {RemoteError} `PROTOTYPE/NO_STAGED`、`PROTOTYPE/REQUIREMENT_BASELINE_CONFLICT`、
   * `PROTOTYPE/NO_WORKSPACE`，或落盘失败折成的 `PROTOTYPE/FAILED`。
   */
  @Remote
  commitStaged(input: PrototypeCommitStagedInput): Promise<PrototypeCommitResult> {
    return this.perform(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return commitStagedPrototype(root, id, input)
    })
  }

  /**
   * 丢弃一条需求的暂存原型；正式版与需求正文不受影响。
   * @param input - 会话号与需求编号。
   * @returns 成功标记。
   * @throws {RemoteError} `PROTOTYPE/NO_WORKSPACE`，或删除失败折成的 `PROTOTYPE/FAILED`。
   */
  @Remote
  discardStaged(input: PrototypeScopeInput): Promise<PrototypeOkValue> {
    return this.perform(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      discardStagedPrototype(root, id)
      return { ok: true }
    })
  }

  /**
   * 列出一条需求的历史快照，按时间倒序、最多 10 条。
   * @param input - 会话号与需求编号。
   * @returns 快照元数据列表。
   * @throws {RemoteError} `PROTOTYPE/NO_WORKSPACE`，或读取失败折成的 `PROTOTYPE/FAILED`。
   */
  @Remote
  listSnapshots(input: PrototypeScopeInput): Promise<PrototypeListSnapshotsValue> {
    return this.perform(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return { snapshots: listPrototypeSnapshots(root, id) }
    })
  }

  /**
   * 恢复一份历史快照：当前正式版先归档，再把快照写回并刷新 YAML 登记。
   * @param input - 会话号、需求编号与快照编号。
   * @returns 恢复时刻与恢复后的 HTML。
   * @throws {RemoteError} `PROTOTYPE/SNAPSHOT_NOT_FOUND`、`PROTOTYPE/NO_WORKSPACE`，
   * 或编号越界折成的 `PROTOTYPE/FAILED`。
   */
  @Remote
  restoreSnapshot(input: PrototypeRestoreSnapshotInput): Promise<PrototypeRestoreSnapshotValue> {
    return this.perform(() => {
      const root = this.specRootOf(input.sessionId)
      const id = assertRequirementId(input.requirementId.trim())
      return restorePrototypeSnapshot(root, id, input.snapshotId)
    })
  }

  /**
   * 跑一段业务分支并把失败统一折成 RemoteError。
   * @param operation - 同步或异步的业务分支。
   * @returns 业务值本身，不再套结果信封。
   * @throws {RemoteError} 分支里的任意抛出物经 `toRemoteError` 转换后的失败。
   */
  private async perform<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error: unknown) {
      throw toRemoteError(error)
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
