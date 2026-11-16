/** 人才库的 Remote 调用面：云端 CRUD 与宿主清单/下发，全部折成可展示的结果。 */

import {
  catalogOf, isBuiltinTalentPreset, presetDocumentOf, presetRosterOf, presetToolsOf, projectViewOf, talentsOf,
  type BuiltinPresetView, type PresetDocumentView, type TalentApplyRow, type TalentCatalogView,
  type TalentConfigView, type TalentPresetToolsView, type TalentProjectView, type TalentRow,
} from './model.ts'

/** 一次调用的结果；失败只带可展示的码与一句话。 */
export type TalentCall<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string }

interface RemoteAnswer {
  readonly ok: true
  readonly value: unknown
}

interface RemoteFailure {
  readonly ok: false
  readonly code: string
  readonly message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorOf(value: unknown): { code: string; message: string } {
  if (!isRecord(value)) return { code: 'lcoder/invalid-failure', message: '宿主返回了无法识别的失败字段' }
  return {
    code: typeof value.code === 'string' ? value.code : 'lcoder/invalid-failure',
    message: typeof value.message === 'string' ? value.message : '宿主返回了无法识别的失败字段',
  }
}

/** 调一次宿主方法，拆开传输信封。 */
async function remote(namespace: string, method: string, args: object): Promise<RemoteAnswer | RemoteFailure> {
  try {
    const answer = await window.lcoder.call(namespace, method, args)
    return answer.ok ? { ok: true, value: answer.value } : { ok: false, ...errorOf(answer.error) }
  } catch (error: unknown) {
    return { ok: false, code: 'link_unavailable', message: error instanceof Error ? error.message : String(error) }
  }
}

/** 调一次云端方法，再拆开 `CloudResult` 信封。 */
async function cloud<T>(
  method: string,
  args: object,
  parse: (value: unknown) => T | undefined,
): Promise<TalentCall<T>> {
  const answer = await remote('lcoderCloud', method, args)
  if (!answer.ok) return answer
  if (!isRecord(answer.value)) {
    return { ok: false, code: 'cloud_invalid_response', message: '云端返回了无法识别的结果' }
  }
  if (answer.value.ok === false) {
    const failure = errorOf(answer.value.error)
    return { ok: false, code: failure.code, message: failure.message }
  }
  const parsed = parse(answer.value.value)
  return parsed === undefined
    ? { ok: false, code: 'cloud_invalid_response', message: '云端返回了不完整的人才数据' }
    : { ok: true, value: parsed }
}

/**
 * 读一侧人才库。
 * @param scope - 全局或项目。
 * @param projectId - 项目作用域必填。
 * @returns 人才列表。
 */
export async function listTalents(
  scope: 'global' | 'project',
  projectId?: string,
): Promise<TalentCall<readonly TalentRow[]>> {
  return cloud(
    'talents',
    { query: { scope, ...projectId === undefined ? {} : { projectId } } },
    value => talentsOf(value),
  )
}

/** 新建人才的入参。 */
export interface CreateTalentInput {
  readonly scope: 'global' | 'project'
  readonly projectId?: string
  readonly name: string
  readonly description: string
  readonly config: TalentConfigView
}

/**
 * 新建人才。
 * @param input - 作用域与配置。
 * @returns 落库后的人才。
 */
export async function createTalent(input: CreateTalentInput): Promise<TalentCall<TalentRow>> {
  return cloud('createTalent', { input }, value => talentsOf({ items: [value] })?.[0])
}

/** 更新人才的入参。 */
export interface UpdateTalentInput {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly config: TalentConfigView
  readonly expectedRevision: number
}

/**
 * 更新人才。
 * @param input - 人才 id、字段与乐观版本。
 * @returns 更新后的人才。
 */
export async function updateTalent(input: UpdateTalentInput): Promise<TalentCall<TalentRow>> {
  return cloud('updateTalent', { input }, value => talentsOf({ items: [value] })?.[0])
}

/**
 * 删除人才。
 * @param id - 人才 id。
 * @returns 成功标记。
 */
export async function deleteTalent(id: string): Promise<TalentCall<true>> {
  return cloud('deleteTalent', { input: { id } }, () => true)
}

/**
 * 读本机只读清单。
 * @returns 插件包与基础 preset。
 */
export async function loadCatalog(): Promise<TalentCall<TalentCatalogView>> {
  const answer = await remote('agentTalents', 'catalog', {})
  if (!answer.ok) return answer
  const catalog = catalogOf(answer.value)
  return catalog === undefined
    ? { ok: false, code: 'invalid_response', message: '宿主返回了无法识别的插件清单' }
    : { ok: true, value: catalog }
}

/**
 * 读产品内置角色 preset 的名册；云端动态人才（`talent-*`）不在其中。
 * @returns 内置角色行。
 */
export async function loadBuiltinPresets(): Promise<TalentCall<readonly BuiltinPresetView[]>> {
  const answer = await remote('agentPresets', 'list', {})
  if (!answer.ok) return answer
  const roster = presetRosterOf(answer.value)
  return roster === undefined
    ? { ok: false, code: 'invalid_response', message: '宿主返回了无法识别的 preset 名册' }
    : { ok: true, value: roster.filter(row => isBuiltinTalentPreset(row.id)) }
}

/**
 * 读一个 preset 声明的人设与插件组合。
 * @param presetId - preset id。
 * @returns 人设与插件行。
 */
export async function loadPresetDocument(presetId: string): Promise<TalentCall<PresetDocumentView>> {
  const answer = await remote('agentPresets', 'read', { agentPreset: presetId })
  if (!answer.ok) return answer
  const document = presetDocumentOf(answer.value)
  return document === undefined
    ? { ok: false, code: 'invalid_response', message: '宿主返回了无法识别的 preset 组合' }
    : { ok: true, value: document }
}

/**
 * 读一个基础 preset 的工具面。
 * @param presetId - 基础 preset id。
 * @returns 工具面或不可用原因。
 */
export async function loadPresetTools(presetId: string): Promise<TalentCall<TalentPresetToolsView>> {
  const answer = await remote('agentTalents', 'presetTools', { presetId })
  if (!answer.ok) return answer
  const tools = presetToolsOf(answer.value)
  return tools === undefined
    ? { ok: false, code: 'invalid_response', message: '宿主返回了无法识别的工具面' }
    : { ok: true, value: tools }
}

/**
 * 读项目身份，只读不写。
 * @param path - 项目根目录。
 * @returns 项目身份。
 */
export async function loadProjectIdentity(path: string): Promise<TalentCall<TalentProjectView>> {
  const answer = await remote('agentTalents', 'projectIdentity', { input: { path } })
  if (!answer.ok) return answer
  const project = projectViewOf(answer.value, path)
  return project === undefined
    ? { ok: false, code: 'invalid_response', message: '宿主返回了无法识别的项目身份' }
    : { ok: true, value: project }
}

/**
 * 为已登记的项目补出 projectId；读到老项目缺字段时自动调用一次。
 * @param path - 项目根目录。
 * @returns 写回后的项目身份。
 */
export async function ensureProjectIdentity(path: string): Promise<TalentCall<TalentProjectView>> {
  const answer = await remote('agentTalents', 'ensureProjectId', { input: { path } })
  if (!answer.ok) return answer
  const project = projectViewOf(answer.value, path)
  return project === undefined
    ? { ok: false, code: 'invalid_response', message: '宿主返回了无法识别的项目身份' }
    : { ok: true, value: project }
}

/**
 * 下发一条人才；单条调用让一条失败不影响其它人才。
 * @param row - 要下发的人才。
 * @returns 成功或可展示的失败。
 */
export async function applyTalent(row: TalentApplyRow): Promise<TalentCall<true>> {
  const answer = await remote('agentTalents', 'applyTalents', { request: { talents: [row] } })
  return answer.ok ? { ok: true, value: true } : answer
}

/**
 * 撤回一条已下发的人才。
 * @param talentId - 云端人才 id。
 * @returns 成功；仍有会话引用时带 `agent-talent/referenced`。
 */
export async function removeTalent(talentId: string): Promise<TalentCall<true>> {
  const answer = await remote('agentTalents', 'removeTalent', { talentId })
  return answer.ok ? { ok: true, value: true } : answer
}

/**
 * 查一条人才的本机会话引用；本进程没登记过该人才时视为没有引用。
 * @param talentId - 云端人才 id。
 * @returns 会话 id 列表。
 */
export async function talentSessionRefs(talentId: string): Promise<TalentCall<readonly string[]>> {
  const answer = await remote('agentTalents', 'sessionRefs', { talentId })
  if (!answer.ok) {
    return answer.code === 'agent-talent/not-found' ? { ok: true, value: [] } : answer
  }
  const sessionIds = isRecord(answer.value) && Array.isArray(answer.value.sessionIds)
    ? answer.value.sessionIds.filter((id): id is string => typeof id === 'string')
    : []
  return { ok: true, value: sessionIds }
}
