/**
 * 外壳的展示类型与启动咒语模板。
 *
 * 数据来自会话工作区的 `.spec`：任务/规则走 `projection.ts`，项目信息走
 * `.spec/project.yaml`；本文件只保留类型与纯模板，不再持有演示数据。
 */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { LcoderWorkspaceKey } from '../locales.ts'

/** 五态任务状态。 */
export type ShellTaskState = 'drafting' | 'contracted' | 'implementing' | 'verifying' | 'closed'

/** 看板上的一个任务。 */
export interface ShellTask {
  readonly id: string
  readonly title: string
  readonly state: ShellTaskState
  readonly grade: string
  readonly rules: readonly string[]
  readonly evidence: readonly string[]
  readonly surface: string
  /** 认领这条任务的会话号；缺省表示还没有会话在跑它。 */
  readonly session?: string
}

/** 装配层声明的一个角色（Agent preset）；外壳的新会话按它指名。 */
export interface ShellRole {
  readonly id: string
  readonly name?: string
}

/** 项目类型决定是否展示环境信息。 */
export type ShellProjectKind = 'web' | 'desktop' | 'library'

/** 一个部署环境；敏感值只存引用，`passwordValue` 是本机解析后的值。 */
export interface ShellEnvironment {
  readonly id: string
  readonly label: string
  readonly server?: string
  readonly database?: {
    readonly host: string
    readonly port?: string
    readonly name: string
    readonly user: string
    /** `.spec/project.yaml` 只存这个引用名。 */
    readonly passwordRef: string
    /** 从 `.spec/local.yaml` 或环境变量解析出的本机值；不落库、不进模型。 */
    readonly passwordValue?: string
  }
  readonly note?: string
}

/** 项目信息抽屉的数据，来自 `.spec/project.yaml`。 */
export interface ShellProjectInfo {
  readonly kind: ShellProjectKind
  readonly repoUrl: string
  readonly branch: string
  readonly docs: {
    readonly product: string
    readonly architecture: string
    readonly tests: string
  }
  readonly environments: readonly ShellEnvironment[]
}

/** 看板列，顺序即视觉顺序。 */
export const SHELL_STATES: readonly { readonly id: ShellTaskState; readonly labelKey: LcoderWorkspaceKey }[] = [
  { id: 'drafting', labelKey: 'shell.drafting' },
  { id: 'contracted', labelKey: 'shell.contracted' },
  { id: 'implementing', labelKey: 'shell.implementing' },
  { id: 'verifying', labelKey: 'shell.verifying' },
  { id: 'closed', labelKey: 'shell.closed' },
]

/** 悬浮对话里的一条真实消息。 */
export interface ShellMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/**
 * 一次签署命令的回执。
 * `text` 是宿主给出的那句人话（写了哪个文件、签名覆盖哪一版正文），
 * 外壳原样显示，不改写也不本地化——那句话属于宿主。
 */
export interface ShellSignResult {
  readonly ok: boolean
  readonly text: string
}

/**
 * 从会话事件窗口提取可展示的用户/助手文本。工具结果与图片块忽略。
 * @param entries - 会话事件窗口。
 * @returns 按日志顺序排列的消息。
 */
export function messagesFromEntries(entries: readonly SessionEventLikeEntry[]): ShellMessage[] {
  const out: ShellMessage[] = []
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    if (entry.event.type === 'user/message') {
      const text = textOf(entry.event.data)
      if (text !== '') out.push({ role: 'user', text })
    } else if (entry.event.type === 'assistant/message') {
      const text = textOf(entry.event.data.message)
      if (text !== '') out.push({ role: 'assistant', text })
    }
  }
  return out
}

/** 消息/内容块里的文本；其他形状一律忽略。 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (value === null || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (record.content !== undefined) return textOf(record.content)
  return ''
}

/** 启动咒语需要的项目事实。 */
export interface ShellPromptProject {
  readonly name: string
  readonly path: string
  readonly branch: string
}

/**
 * 生成 dev-flow 启动咒语。任务/项目字段来自当前选择，模板与 task-flow 的入口一致。
 * @param project - 当前项目。
 * @param task - 当前任务。
 * @returns 可直接粘贴到会话的提示词。
 */
export function buildShellPrompt(project: ShellPromptProject, task: ShellTask): string {
  return `@task-flow ${task.id}：${task.title}

第 0 步环境隔离：
- 规格根：${project.path}/.spec
- 项目：${project.name}（${project.path}，${project.branch}）

现状入口（已核对）：
- 任务：${task.id}，状态 ${task.state}，分级 ${task.grade}
- 规则：${task.rules.join(', ') || '（未声明）'}
- 证据要求：${task.evidence.join(', ') || '（未声明）'}
- 工具面：${task.surface}

请按任务驱动入口执行：
1. 调研：读相关代码与契约，确认现状与缺口；
2. 分类分级并登记 docs/tasks.yaml，状态 doing，重跑看板；
3. 拿不准先问我（方案 / 契约 / 范围）；
4. 契约先行、增量编码，遵守 docs/PROJECT-RULES.md 红线；
5. 门禁：typecheck / lint / vitest / test:docs；
6. 收口置 done、重跑看板，bug 写 PITFALLS，不自动 push。`
}

/** 立项咒语需要的交付文档路径；空串表示 `.spec/project.yaml` 没声明。 */
export interface ShellOnboardingDocs {
  readonly product: string
  readonly architecture: string
  readonly tests: string
}

/**
 * 生成零任务仓库的立项分析咒语：把产品文档路径交给模型，让 agent 先调研再逐个建
 * drafting 任务。提示词走会话的 `user/message`，所以模型可见内容可从日志复原。
 * @param project - 当前项目。
 * @param docs - `.spec/project.yaml` 声明的交付文档；缺失时要求先问用户。
 * @returns 可直接发送的提示词。
 */
export function buildOnboardingPrompt(project: ShellPromptProject, docs: ShellOnboardingDocs): string {
  const declared = [
    { label: '产品文档', path: docs.product },
    { label: '架构文档', path: docs.architecture },
    { label: '测试用例', path: docs.tests },
  ].filter(entry => entry.path !== '')

  const sources = declared.length === 0
    ? '- 文档来源：`.spec/project.yaml` 没有声明交付文档；先向用户确认产品文档在哪，不要猜路径。'
    : declared.map(entry => `- ${entry.label}：${entry.path}`).join('\n')

  return `@task-flow 立项分析：${project.name}（${project.path}）

第 0 步 现状：
- 规格根：${project.path}/.spec
- 项目：${project.name}（${project.path}，${project.branch}）
- 任务：一个都读不到，这个仓库还没立项。
${sources}

请按任务驱动入口执行：
1. 调研：先 task_read 确认空看板，再 file_read 逐个读上面的文档，必要时读仓库里的代码；
2. 分类分级：给出任务清单，逐条写清边界、验收口径与 A/B/C 分级的理由；拿不准先问我；
3. 立项：每个任务调一次 task_draft，状态固定 drafting；rules 只填 spec_query 查得到的编号，没有规格条目就留空；
4. 到此为止：不要改业务代码，不要给自己签契约——契约由 contract_draft 起草、由人签署。`
}
