/**
 * 外壳的演示数据与启动咒语模板。
 *
 * 这一版只服务外壳原型：项目/任务来自静态数据，先把布局与交互跑通；
 * 真实 `.spec` 投影与 session 绑定在下一刀接入，组件的数据入口保持不变。
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

/** 一个项目/工作区。 */
export interface ShellProject {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly branch: string
  readonly rules: number
  readonly summary: string
  readonly tasks: readonly ShellTask[]
}

/** 看板列，顺序即视觉顺序。 */
export const SHELL_STATES: readonly { readonly id: ShellTaskState; readonly labelKey: LcoderWorkspaceKey }[] = [
  { id: 'drafting', labelKey: 'shell.drafting' },
  { id: 'contracted', labelKey: 'shell.contracted' },
  { id: 'implementing', labelKey: 'shell.implementing' },
  { id: 'verifying', labelKey: 'shell.verifying' },
  { id: 'closed', labelKey: 'shell.closed' },
]

/** 原型数据：一个完整项目 + 几个空项目，用来验证切换与空态。 */
export const SHELL_PROJECTS: readonly ShellProject[] = [
  {
    id: 'lcoder',
    name: 'LCoder',
    path: 'E:/Projects/LCoder',
    branch: 'lcoder/main',
    rules: 12,
    summary: '规格驱动开发工作台',
    tasks: [
      { id: 'T-101', title: '佣金支持 0（自营免佣）', state: 'drafting', grade: 'B', rules: ['R-01'], evidence: ['build', 'test'], surface: '读 / 契约' },
      { id: 'T-102', title: '结算公式契约', state: 'contracted', grade: 'B', rules: ['R-01', 'R-02'], evidence: ['build', 'test'], surface: '读 / 契约 / 编辑' },
      { id: 'T-103', title: '订单状态机迁移', state: 'implementing', grade: 'A', rules: ['R-03'], evidence: ['build', 'test', 'e2e'], surface: '全量' },
      { id: 'T-104', title: '证据链回填', state: 'verifying', grade: 'B', rules: ['R-02'], evidence: ['test'], surface: '全量 + 收口' },
      { id: 'T-105', title: '示例规则绑定', state: 'closed', grade: 'C', rules: ['DR-01'], evidence: ['test'], surface: '只读' },
    ],
  },
  {
    id: 'test',
    name: 'test',
    path: 'E:/Projects/test',
    branch: 'main',
    rules: 3,
    summary: '临时验证仓库',
    tasks: [
      { id: 'D-01', title: '只读工具预设验证', state: 'drafting', grade: 'C', rules: ['R-01'], evidence: ['test'], surface: '读' },
    ],
  },
  {
    id: 'desktop',
    name: 'desktop',
    path: 'E:/Projects/desktop',
    branch: 'main',
    rules: 5,
    summary: '桌面端挂载实验',
    tasks: [
      { id: 'M-01', title: '工作台页签挂载', state: 'implementing', grade: 'A', rules: ['R-01'], evidence: ['build'], surface: '全量' },
    ],
  },
  { id: 'sidecar', name: 'sidecar', path: 'E:/Projects/sidecar', branch: 'main', rules: 2, summary: '旁路工具', tasks: [] },
]

/**
 * 生成 dev-flow 启动咒语。任务/项目字段来自当前选择，模板与 task-flow 的入口一致。
 * @param project - 当前项目。
 * @param task - 当前任务。
 * @returns 可直接粘贴到会话的提示词。
 */
export function buildShellPrompt(project: ShellProject, task: ShellTask): string {
  return `@task-flow ${task.id}：${task.title}

第 0 步环境隔离：
- 规格根：${project.path}/.spec
- 项目：${project.name}（${project.path}，${project.branch}）

现状入口（已核对）：
- 任务：${task.id}，状态 ${task.state}，分级 ${task.grade}
- 规则：${task.rules.join(', ')}
- 证据要求：${task.evidence.join(', ')}
- 工具面：${task.surface}

请按任务驱动入口执行：
1. 调研：读相关代码与契约，确认现状与缺口；
2. 分类分级并登记 docs/tasks.yaml，状态 doing，重跑看板；
3. 拿不准先问我（方案 / 契约 / 范围）；
4. 契约先行、增量编码，遵守 docs/PROJECT-RULES.md 红线；
5. 门禁：typecheck / lint / vitest / test:docs；
6. 收口置 done、重跑看板，bug 写 PITFALLS，不自动 push。`
}
