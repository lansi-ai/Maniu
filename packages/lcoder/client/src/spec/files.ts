/** `.spec` 布局常量与文件面的窄接口。 */

/** 规格库根；与 kernel 的落盘位置保持一致。 */
export const SPEC_DIR = '.spec'
export const TASKS_DIR = `${SPEC_DIR}/tasks`
export const CONTRACTS_DIR = `${SPEC_DIR}/contracts`
export const PROPOSALS_DIR = `${SPEC_DIR}/proposals`
export const REQUIREMENTS_DIR = `${SPEC_DIR}/requirements`
export const DELIVERABLES_DIR = `${SPEC_DIR}/deliverables`
export const SCHEDULING_DIR = `${SPEC_DIR}/evidence/scheduling`
export const RULES_FILE = `${SPEC_DIR}/spec/rules.yaml`
export const PROJECT_FILE = `${SPEC_DIR}/project.yaml`
export const LOCAL_FILE = `${SPEC_DIR}/local.yaml`
export const AUTOMATION_FILE = `${SPEC_DIR}/automation.yaml`
export const AGENTS_FILE = `${SPEC_DIR}/agents.yaml`
export const ROLES_FILE = `${SPEC_DIR}/roles.yaml`

/** 单页行数；任务与规则都是几十行的量级。 */
export const PAGE_LINES = 500

/** 一次文件读取失败。 */
export interface SpecFailure {
  readonly code: string
  readonly message: string
}

/** 一个目录项。 */
export interface SpecEntry {
  readonly name: string
  readonly type: 'file' | 'directory' | 'other'
}

/** 目录读取结果。 */
export type SpecListing =
  | { readonly ok: true; readonly entries: readonly SpecEntry[] }
  | { readonly ok: false; readonly error: SpecFailure }

/** 文本页读取结果。 */
export type SpecText =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: SpecFailure }

/** 投影只需要的两件事：列目录、读一页文本。 */
export interface SpecFiles {
  list(path: string): Promise<SpecListing>
  readPage(path: string, offset?: number): Promise<SpecText>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failureOf(error: unknown): SpecFailure {
  if (isRecord(error)) {
    return {
      code: typeof error.code === 'string' ? error.code : 'lcoder/spec-read-failed',
      message: typeof error.message === 'string' ? error.message : '读取规格文件失败',
    }
  }
  return { code: 'lcoder/spec-read-failed', message: String(error) }
}

/**
 * 把宿主 `workspaceFiles` 收成投影需要的窄面。
 * @param scopeSessionId - 提供 `.spec` 相对基准的会话。
 * @returns 文件面；所有失败都折成 {@link SpecFailure}。
 */
export function specFilesOf(scopeSessionId: string): SpecFiles {
  return {
    async list(path) {
      const answer = await window.lcoder.call('workspaceFiles', 'list', {
        workspaceFileScopeId: scopeSessionId,
        path,
      })
      if (!answer.ok) return { ok: false, error: failureOf(answer.error) }
      const value = answer.value
      if (!isRecord(value) || !Array.isArray(value.entries)) {
        return { ok: false, error: { code: 'lcoder/spec-invalid', message: '目录列表字段不合法' } }
      }
      const entries: SpecEntry[] = []
      for (const entry of value.entries) {
        if (!isRecord(entry) || typeof entry.name !== 'string') continue
        const type = entry.type === 'file' || entry.type === 'directory' ? entry.type : 'other'
        entries.push({ name: entry.name, type })
      }
      return { ok: true, entries }
    },
    async readPage(path, offset = 1) {
      const answer = await window.lcoder.call('workspaceFiles', 'read', {
        workspaceFileScopeId: scopeSessionId,
        path,
        range: { offset, limit: PAGE_LINES },
      })
      if (!answer.ok) return { ok: false, error: failureOf(answer.error) }
      const value = answer.value
      if (!isRecord(value) || typeof value.text !== 'string') {
        return { ok: false, error: { code: 'lcoder/spec-invalid', message: '文件内容字段不合法' } }
      }
      return { ok: true, text: value.text }
    },
  }
}

/** 远程失败的人话。 */
export function messageOf(failure: { readonly code?: unknown; readonly message?: unknown }): string {
  if (typeof failure.message === 'string' && failure.message !== '') return failure.message
  return typeof failure.code === 'string' ? failure.code : '未知失败'
}

/**
 * 读一段较长文本（默认 2000 行），供证据日志与文档使用。
 * @param scopeSessionId - 提供相对基准的会话。
 * @param path - 仓库相对路径。
 * @param limit - 行数上限。
 * @returns 正文；失败带结构化原因。
 */
export async function readWorkspaceText(
  scopeSessionId: string,
  path: string,
  limit = 2000,
): Promise<SpecText> {
  const answer = await window.lcoder.call('workspaceFiles', 'read', {
    workspaceFileScopeId: scopeSessionId,
    path,
    range: { offset: 1, limit },
  })
  if (!answer.ok) return { ok: false, error: failureOf(answer.error) }
  const value = answer.value
  if (!isRecord(value) || typeof value.text !== 'string') {
    return { ok: false, error: { code: 'lcoder/spec-invalid', message: '文件内容字段不合法' } }
  }
  return { ok: true, text: value.text }
}
