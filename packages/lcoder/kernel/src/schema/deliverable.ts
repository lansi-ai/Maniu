/**
 * 交付索引：`.spec/deliverables/<任务编号>.yaml` 的形状与「必须交付」判定。
 *
 * 一条边界：schema 只校形态（字段存在、类型正确、docs 是仓库相对路径），
 * 文档是否真实存在、任务编号是否存在，由写盘工具按仓库根与任务目录复核。
 *
 * 索引不是工程文档本身：README、docs 仍由实施线用 `file_edit` 写进仓库；
 * 这里只登记「哪条任务的产物落在哪些文档、怎么验收」。
 */
import { z } from 'zod'

/** 任务编号形态与 `Task.id` 一致：T-014 / DEMO-01。 */
const TaskId = z.string().regex(/^[A-Z]+-\d{2,}$/, '形如 T-014 的任务编号')

const IsoDateTime = z
  .string()
  .refine(s => !Number.isNaN(Date.parse(s)), '需要可解析的 ISO 8601 时间')

/**
 * 交付文档路径：相对仓库根，例如 `README.md`、`docs/architecture.md`。
 *
 * 绝对路径与 `..` 上跳会被拒；写盘侧再按仓库根复核一次，并确认文件真实存在。
 * 这里不要求文件已经存在——校验存在性要有仓库根，不属于 schema。
 */
const DeliverableDoc = z.string().superRefine((value, ctx) => {
  const path = value.trim()
  if (path === '') {
    ctx.addIssue({ code: 'custom', message: '交付文档路径不能为空' })
    return
  }
  if (/^(?:[A-Za-z]:|[\\/])/.test(path)) {
    ctx.addIssue({ code: 'custom', message: `交付文档必须是仓库相对路径，不能是绝对路径：${value}` })
    return
  }
  if (path.split(/[\\/]/).includes('..')) {
    ctx.addIssue({ code: 'custom', message: `交付文档路径不能包含 ..，不能跳出仓库根：${value}` })
  }
})

/**
 * 一条任务的交付索引。
 *
 * `docs` 至少一条：只说「做完了」而不指向任何文档的索引，与没有索引一样无法验收。
 * `commands` 可以留空——有的交付物只靠阅读验收，不靠命令。
 */
export const Deliverable = z
  .object({
    task: TaskId,
    /** 一句话摘要：这条任务交付了什么。 */
    summary: z.string().trim().min(1, 'summary 不能为空'),
    /** 工程文档的仓库相对路径；至少一条。 */
    docs: z.array(DeliverableDoc).min(1, 'docs 至少登记一条工程文档'),
    /** 验收命令；可以为空。 */
    commands: z.array(z.string().trim().min(1, '命令不能是空字符串')).default([]),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
  })
  .strict()
export type Deliverable = z.infer<typeof Deliverable>

/**
 * 必须交付的标题与描述关键词。
 *
 * 基础与架构类任务没有工程文档就无法交接：后来的人只能重新读代码。
 * 判定只看标题与描述，不猜代码内容。
 */
export const DELIVERY_KEYWORDS: readonly string[] = ['基础框架', '脚手架', '架构', '技术选型']

/** 判定必须交付所需的任务字段；`Task` 与外壳任务都结构上满足。 */
export interface DeliverableSubject {
  readonly grade: string
  readonly track?: string | undefined
  readonly title: string
  readonly description: string
}

/**
 * 这条任务是否必须交付工程文档。
 *
 * 三条独立的触发条件：A 级（契约/架构/规则变更）、通用轨（跨交付面的底座）、
 * 或标题与描述命中基础框架/脚手架/架构/技术选型。普通 B/C 级功能任务不触发。
 * @param task - 任务的分级、轨与标题描述。
 * @returns 必须交付时为 true。
 */
export function mustDeliver(task: DeliverableSubject): boolean {
  if (task.grade === 'A') return true
  if (task.track === 'general') return true
  const text = `${task.title}\n${task.description}`
  return DELIVERY_KEYWORDS.some(keyword => text.includes(keyword))
}
