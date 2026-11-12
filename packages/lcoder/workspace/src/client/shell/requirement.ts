/**
 * 需求卡片的判定、时间展示与拆分指令。
 *
 * 需求卡片只给「已确认、等待拆分」的 drafting 任务：它们带 `proposal` 回指，
 * 是从方案里落下的需求本体，不是后续开发任务。其它状态仍走普通任务详情。
 */
import type { ShellTask } from './shell-data.ts'

/**
 * 任务是否是需求卡片要看的那一条。
 * @param task - 看板任务。
 * @returns 状态为 drafting 且带方案回指时为 true。
 */
export function isRequirementTask(task: ShellTask): boolean {
  return task.state === 'drafting' && task.proposal !== undefined
}

/**
 * 任务开立时间的展示值。
 *
 * 只读 `opened_at` 写下的时间；缺失或读不懂时给空串，由界面显示破折号，
 * 不拿文件修改时间冒充。
 * @param value - 任务 YAML 的 `opened_at`。
 * @returns 本地时间字符串；缺失或非法时为空串。
 */
export function formatOpenedAt(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return ''
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString()
}

/**
 * 拆分任务时发给分析师的指令。
 *
 * 只要求把这一条需求拆成 drafting 任务写进 `.spec/tasks`；不改需求、项目与方案，
 * 不开始实现，也不推进状态。
 * @param task - 被拆分的需求任务。
 * @returns 中文指令正文。
 */
export function buildRequirementSplitPrompt(task: ShellTask): string {
  return [
    `需求拆分：请把需求 ${task.id}（${task.title}）拆分成可执行的开发任务，写入 .spec/tasks。`,
    '',
    '要求：',
    '- 每条任务 state 为 drafting；标题用可交付的业务结果，不要用技术步骤堆叠。',
    '- 每条任务写清 description（范围与验收标准）、grade、rules、depends_on 与 scope.allowed_paths；规则只能引用需求里已确认的编号。',
    '- 拆出的任务保持可独立验收；有先后依赖的用 depends_on 表达。',
    '- 不要修改需求本身、.spec/project.yaml、已有方案与规格条目；不要开始实现、不要签契约、不要推进任务状态。',
    '- 完成后列出新建的任务编号、标题与依赖关系。',
  ].join('\n')
}
