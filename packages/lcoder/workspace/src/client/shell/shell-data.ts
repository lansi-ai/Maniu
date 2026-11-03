/**
 * 外壳的展示类型与启动咒语模板。
 *
 * 数据来自会话工作区的 `.spec`：任务/规则走 `projection.ts`，项目信息走
 * `.spec/project.yaml`；本文件只保留类型与纯模板，不再持有演示数据。
 */
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
