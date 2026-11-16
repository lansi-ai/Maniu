/**
 * 人才库宿主服务：把客户端提交的云端人才注册成可选择的 agent preset。
 *
 * 只认本机事实：插件必须在宿主的已安装清单里解析得到；基础 preset 必须
 * 已注册；人才配置只接受静态 JSON。注册进同一进程的 registry 后，旧会话
 * 继续绑定旧 revision，新会话读最新定义，快照语义由 registry 负责。
 * 动态 preset 一律带 `talent-` 前缀，撤回只注销本服务登记过的定义。
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tools'
import { ensureProjectId, loadProject, projectPath } from '../kernel/project-store.js'
import { composeTalentPlugins } from './compose.ts'
import { TALENT_PRESET_PREFIX, invalidTalent, talentIdOfPreset, validateApplyRequest } from './validate.ts'
import type { ValidatedTalent } from './validate.ts'
import type {
  TalentApplied, TalentApplyRequest, TalentApplyResult, TalentCatalog, TalentCatalogPlugin,
  TalentCatalogPreset, TalentCatalogTool, TalentPresetTools, TalentProjectIdentity, TalentProjectInput,
  TalentRemoved, TalentSessionRef,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTalents: AgentTalents
  }
}

/** 根 Loader 入口的最小读取面由 `@deepseek-ai/cordis-plugin-loader` 声明。 */
const PACKAGE_NAME = /^[a-z0-9@][a-z0-9@._/-]{0,127}$/u

/**
 * 从模块说明里折出包名；相对路径、伪插件与非包名返回 undefined。
 * @param specifier - Loader 行或 preset 行里写的模块说明。
 * @returns 可提交进人才配置的包名。
 */
function packageNameOf(specifier: string): string | undefined {
  if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/')
    || specifier.startsWith('\\') || specifier.startsWith('#') || specifier.includes(':')) return undefined
  const segments = specifier.split('/')
  const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  return name !== undefined && PACKAGE_NAME.test(name) ? name : undefined
}

interface PreparedTalent {
  readonly talentId: string
  readonly presetId: string
  readonly basePreset: string | null
  readonly definition: PresetDefinition
  readonly digest: string
  readonly tools: readonly string[] | undefined
}

interface AppliedTalent extends PreparedTalent {
  readonly dispose: () => Promise<void>
}

function notFound(talentId: string): RemoteError {
  return new RemoteError('agent-talent/not-found', `Unknown talent: ${talentId}`, { talentId })
}

/** 人才库 Remote 服务。 */
export class AgentTalents extends TypertRemoteService {
  private readonly owner: Context
  private readonly entries = new Map<string, AppliedTalent>()

  /**
   * @param ctx - 宿主上下文；调用方须已提供 `agentPresets`、`pluginPackages`、`sessionQuery` 与 `sessions`。
   */
  constructor(ctx: Context) {
    super(ctx, 'agentTalents')
    this.owner = ctx
  }

  /** 插件解析的基准位置：profile 的 Loader 根；未设时退回本包位置。 */
  private get baseUrl(): string {
    return this.owner.baseUrl ?? import.meta.url
  }

  /**
   * 应用或替换一批人才。整批先校验后落盘，任一条失败都回滚本次已做的改动。
   * @param request - 人才列表。
   * @returns 实际注册/替换的人才与因配置未变而跳过的人才。
   */
  @Remote('applyTalents')
  async applyTalents(request: TalentApplyRequest): Promise<TalentApplyResult> {
    const prepared = this.prepare(request)
    const applied: TalentApplied[] = []
    const skipped: string[] = []
    const staged: { previous: AppliedTalent | undefined; entry: AppliedTalent }[] = []
    for (const item of prepared) {
      const previous = this.entries.get(item.talentId)
      if (previous !== undefined && previous.digest === item.digest) {
        skipped.push(item.talentId)
        continue
      }
      if (previous !== undefined) await previous.dispose()
      let entry: AppliedTalent
      try {
        entry = await this.register(item)
      } catch (error: unknown) {
        if (previous !== undefined) await this.restore(previous)
        await this.rollback(staged)
        throw error
      }
      this.entries.set(item.talentId, entry)
      staged.push({ previous, entry })
      applied.push({
        talentId: item.talentId,
        presetId: item.presetId,
        basePreset: item.basePreset,
        replaced: previous !== undefined,
      })
    }
    return { applied, skipped }
  }

  /**
   * 撤回一条人才。仍有本机会话引用时拒绝；内置与其它来源的 preset 一律不碰。
   * @param talentId - 云端人才 id。
   * @returns 已注销的 preset id。
   */
  @Remote('removeTalent')
  async removeTalent(talentId: string): Promise<TalentRemoved> {
    const entry = this.entries.get(talentId)
    if (entry === undefined) throw notFound(talentId)
    const sessions = await this.sessionsUsing(entry.presetId)
    if (sessions.length > 0) {
      throw new RemoteError('agent-talent/referenced',
        `Talent ${talentId} is still used by ${String(sessions.length)} session(s): ${sessions.join(', ')}`,
        { talentId, sessions })
    }
    await entry.dispose()
    this.entries.delete(talentId)
    return { talentId, presetId: entry.presetId }
  }

  /**
   * 列出仍在用某条人才的本机会话。
   * @param talentId - 云端人才 id。
   * @returns 人才、preset 与使用它的会话 id。
   */
  @Remote('sessionRefs')
  async sessionRefs(talentId: string): Promise<TalentSessionRef> {
    const entry = this.entries.get(talentId)
    if (entry === undefined) throw notFound(talentId)
    return { talentId, presetId: entry.presetId, sessionIds: await this.sessionsUsing(entry.presetId) }
  }

  /**
   * 读表单需要的本机只读清单：可解析的已安装插件包与非人才的基础 preset。
   *
   * 只读 root Loader 与 preset 组合，不挂载、不写配置；插件按提交时同样的
   * `packageOf` 规则过滤，列出就能提交。
   * @returns 插件包与基础 preset。
   */
  @Remote('catalog')
  async catalog(): Promise<TalentCatalog> {
    const names = new Set<string>()
    const loader = this.owner.get('loader')
    for (const entry of loader?.entries() ?? []) {
      if (entry.options.group || entry.disabled) continue
      const name = packageNameOf(entry.options.name)
      if (name !== undefined) names.add(name)
    }
    const compositions = await this.owner.agentPresets.compositionInventory()
    const presets: TalentCatalogPreset[] = []
    for (const composition of compositions) {
      for (const row of composition.rows) {
        if (row.enabled === false) continue
        const name = packageNameOf(row.moduleName)
        if (name !== undefined) names.add(name)
      }
      if (composition.id.startsWith(TALENT_PRESET_PREFIX)) continue
      presets.push({
        id: composition.id,
        ...composition.name === undefined ? {} : { name: composition.name },
        isDefault: composition.isDefault,
        ...composition.broken === undefined ? {} : { broken: composition.broken },
      })
    }
    const plugins: TalentCatalogPlugin[] = []
    for (const name of names) {
      const pkg = this.owner.pluginPackages.packageOf(name, this.baseUrl)
      if (pkg === undefined) continue
      plugins.push({ name, ...pkg.version === undefined ? {} : { version: pkg.version } })
    }
    plugins.sort((left, right) => left.name.localeCompare(right.name))
    presets.sort((left, right) => left.id.localeCompare(right.id))
    return { plugins, presets }
  }

  /**
   * 读一个基础 preset 当前工具面上的工具名与说明。
   *
   * 白名单只接受这里的名字；preset 不可用时返回空工具面与原因，不抛给界面。
   * @param presetId - 基础 preset id。
   * @returns 工具面或不可用原因。
   */
  @Remote('presetTools')
  async presetTools(presetId: string): Promise<TalentPresetTools> {
    const preset = (await this.owner.agentPresets.list()).find(row => row.id === presetId)
    if (preset === undefined) return { presetId, tools: [], broken: `unknown agent preset: ${presetId}` }
    if (preset.broken !== undefined) return { presetId, tools: [], broken: preset.broken }
    const scope = this.owner.agentPresets.definitionScope(presetId)
    if (scope === undefined) return { presetId, tools: [], broken: 'the preset exposes no tool scope' }
    const tools = this.owner.tools.definitions(scope)
      .map((definition): TalentCatalogTool => ({ name: definition.name, description: definition.description }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return { presetId, tools }
  }

  /**
   * 读当前项目的稳定身份；只读 `.spec/project.yaml`，不生成、不改写。
   * @param input - 项目路径或作用域会话。
   * @returns 已登记 id、未登记、缺文件或文件无效。
   */
  @Remote('projectIdentity')
  async projectIdentity(input: TalentProjectInput): Promise<TalentProjectIdentity> {
    const root = await this.projectRoot(input)
    if (root === undefined) return { projectId: null, state: 'missing-context' }
    try {
      const info = loadProject(root)
      if (info === null) return { projectId: null, state: 'missing-project', detail: projectPath(root) }
      return info.projectId === undefined
        ? { projectId: null, state: 'unbound' }
        : { projectId: info.projectId, state: 'ready' }
    } catch (error: unknown) {
      return { projectId: null, state: 'invalid', detail: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 为已登记的项目补出并写回 `projectId`；客户端读到老项目缺字段时会自动调用一次。
   * @param input - 项目路径或作用域会话。
   * @returns 写回后的身份；没有 `project.yaml` 时返回缺文件。
   */
  @Remote('ensureProjectId')
  async ensureProjectId(input: TalentProjectInput): Promise<TalentProjectIdentity> {
    const root = await this.projectRoot(input)
    if (root === undefined) return { projectId: null, state: 'missing-context' }
    try {
      return { projectId: ensureProjectId(root), state: 'ready' }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      let state: TalentProjectIdentity['state'] = 'invalid'
      try {
        state = loadProject(root) === null ? 'missing-project' : 'invalid'
      } catch {
        // 文件本身不合 schema，仍按 invalid 报。
      }
      return { projectId: null, state, detail }
    }
  }

  /** 项目的规格根：优先项目路径，其次作用域会话的 cwd。 */
  private async projectRoot(input: TalentProjectInput): Promise<string | undefined> {
    if (input.path !== undefined && input.path !== '') return join(input.path, '.spec')
    if (input.sessionId !== undefined && input.sessionId !== '') {
      const records = await this.owner.sessionQuery.listSessions()
      const cwd = records.find(record => record.header.id === input.sessionId)?.header.cwd
      if (typeof cwd === 'string' && cwd !== '') return join(cwd, '.spec')
    }
    return undefined
  }

  /**
   * 读一个在跑会话当前绑定的人才 id；非人才会话返回 undefined。
   * @param sessionId - 模型请求携带的会话 id。
   * @returns 仍在本进程登记的人才 id，或 undefined。
   */
  talentIdForSession(sessionId: SessionId): string | undefined {
    const session = this.owner.sessions.get(sessionId)
    if (session === undefined) return undefined
    const presetId = this.owner.agentPresets.presetForSession(session) ?? session.header.agentPreset
    if (presetId === undefined) return undefined
    const talentId = talentIdOfPreset(presetId)
    return talentId !== undefined && this.entries.has(talentId) ? talentId : undefined
  }

  /** 注销本服务注册的全部动态 preset；插件卸载时调用。 */
  async disposeTalents(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    for (const entry of entries) {
      try {
        await entry.dispose()
      } catch (error: unknown) {
        this.owner.logger.warn(`agent talent ${entry.talentId}: unregistering on unload failed (${String(error)})`)
      }
    }
  }

  private prepare(request: TalentApplyRequest): PreparedTalent[] {
    const selection = validateApplyRequest(request)
    const composed = new Map<string, PresetDefinition['plugins']>()
    const prepared: PreparedTalent[] = []
    for (const talent of selection.talents) prepared.push(this.prepareOne(talent, composed))
    return prepared
  }

  private prepareOne(talent: ValidatedTalent, composed: Map<string, PresetDefinition['plugins']>): PreparedTalent {
    const owned = this.entries.get(talent.talentId)
    if (owned === undefined && this.owner.agentPresets.definitionPlugins(talent.presetId) !== undefined) {
      throw new RemoteError('agent-talent/reserved',
        `Agent preset ${talent.presetId} is already declared by a non-talent source`,
        { talentId: talent.talentId, presetId: talent.presetId })
    }
    let base: PresetDefinition['plugins'] = []
    const basePreset = talent.config.basePreset
    if (basePreset !== undefined) {
      const declared = composed.get(basePreset) ?? this.owner.agentPresets.definitionPlugins(basePreset)
      if (declared === undefined) {
        throw invalidTalent(talent.talentId, `config.basePreset "${basePreset}" is not a registered agent preset`)
      }
      base = declared
    }
    for (const plugin of talent.config.plugins ?? []) {
      if (this.owner.pluginPackages.packageOf(plugin.name, this.baseUrl) === undefined) {
        throw new RemoteError('agent-talent/unknown-plugin',
          `Talent ${talent.talentId} names plugin "${plugin.name}", which is not installed on this host`,
          { talentId: talent.talentId, plugin: plugin.name })
      }
    }
    const plugins = composeTalentPlugins(base, talent)
    composed.set(talent.presetId, plugins)
    const definition: PresetDefinition = {
      id: talent.presetId,
      ...talent.name === undefined ? {} : { name: talent.name },
      ...talent.description === undefined ? {} : { description: talent.description },
      plugins,
    }
    return {
      talentId: talent.talentId,
      presetId: talent.presetId,
      basePreset: basePreset ?? null,
      definition,
      digest: JSON.stringify(definition),
      tools: talent.config.tools !== undefined && talent.config.tools.length > 0 ? talent.config.tools : undefined,
    }
  }

  private async register(item: PreparedTalent): Promise<AppliedTalent> {
    const dispose = await this.owner.agentPresets.register(item.definition)
    try {
      const resolved = await this.owner.agentPresets.resolve(item.presetId)
      if (resolved.broken !== undefined) {
        throw invalidTalent(item.talentId, `preset activation failed: ${resolved.broken}`)
      }
      this.assertKnownTools(item)
      return { ...item, dispose }
    } catch (error: unknown) {
      await dispose()
      throw error
    }
  }

  /** 挂载后按 preset 作用域的工具面拒绝白名单里不存在的工具。 */
  private assertKnownTools(item: PreparedTalent): void {
    if (item.tools === undefined) return
    const scope = this.owner.agentPresets.definitionScope(item.presetId)
    if (scope === undefined) {
      throw invalidTalent(item.talentId, 'the activated preset exposes no scope to inspect its tools')
    }
    const known = new Set(this.owner.tools.definitions(scope).map(definition => definition.name))
    const unknown = item.tools.filter(name => !known.has(name))
    if (unknown.length > 0) {
      throw new RemoteError('agent-talent/unknown-tool',
        `Talent ${item.talentId} names tool(s) this preset does not expose: ${unknown.join(', ')}`,
        { talentId: item.talentId, tools: unknown })
    }
  }

  private async restore(entry: AppliedTalent): Promise<void> {
    try {
      const dispose = await this.owner.agentPresets.register(entry.definition)
      this.entries.set(entry.talentId, { ...entry, dispose })
    } catch (error: unknown) {
      this.owner.logger.warn(`agent talent ${entry.talentId}: restoring the previous preset failed (${String(error)})`)
    }
  }

  private async rollback(staged: readonly { previous: AppliedTalent | undefined; entry: AppliedTalent }[]): Promise<void> {
    for (const step of [...staged].reverse()) {
      const current = this.entries.get(step.entry.talentId)
      if (current !== undefined) {
        await current.dispose()
        this.entries.delete(step.entry.talentId)
      }
      if (step.previous !== undefined) await this.restore(step.previous)
    }
  }

  private async sessionsUsing(presetId: string): Promise<string[]> {
    const records = await this.owner.sessionQuery.listSessions()
    return records.filter(record => this.presetOf(record) === presetId).map(record => record.header.id)
  }

  private presetOf(record: SessionRecord): string | undefined {
    const live = this.owner.sessions.get(record.header.id)
    if (live !== undefined) {
      return this.owner.agentPresets.presetForSession(live) ?? record.header.agentPreset ?? undefined
    }
    return record.header.agentPreset ?? undefined
  }
}
