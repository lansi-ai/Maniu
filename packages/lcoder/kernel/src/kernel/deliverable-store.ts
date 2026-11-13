/**
 * 交付索引的落盘与读取。
 *
 * 一个任务一份 `.spec/deliverables/<任务编号>.yaml`，工具按任务覆盖写；
 * 收口闸门只读这一份，不猜工程文档内容。
 *
 * 读取刻意分三态：没有索引、索引存在但读不懂、索引可用。把「读不懂」
 * 混进「没有」会让一条坏文件被当成没登记，收口提示就指错了下一步。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { Deliverable } from '../schema/deliverable.js'

/**
 * 一条任务的交付索引路径。
 * @param root - 规格根（`.spec`）。
 * @param taskId - 任务编号。
 * @returns 索引文件的绝对或相对路径（按传入的根）。
 */
export function deliverablePath(root: string, taskId: string): string {
  return join(root, 'deliverables', `${taskId}.yaml`)
}

/** 读取一条任务的交付索引事实。 */
export type DeliverableRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly problem: string }
  | { readonly kind: 'ok'; readonly value: Deliverable }

/**
 * 读一条任务的交付索引。
 * @param root - 规格根（`.spec`）。
 * @param taskId - 任务编号。
 * @returns 缺失、读不懂或可用三态；读盘失败按读不懂处理并带原文。
 */
export function readDeliverable(root: string, taskId: string): DeliverableRead {
  const path = deliverablePath(root, taskId)
  if (!existsSync(path)) return { kind: 'missing' }

  let raw: unknown
  try {
    raw = parseYaml(readFileSync(path, 'utf8'))
  } catch (error) {
    return { kind: 'invalid', problem: `YAML 解析失败：${(error as Error).message.split('\n')[0] ?? '未知错误'}` }
  }

  const parsed = Deliverable.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first === undefined || first.path.length === 0 ? '' : `（${first.path.join('.')}）`
    return { kind: 'invalid', problem: `${first?.message ?? '字段不合法'}${where}` }
  }
  if (parsed.data.task !== taskId) {
    return { kind: 'invalid', problem: `task 写的是 ${parsed.data.task}，与文件名 ${taskId} 不一致` }
  }
  return { kind: 'ok', value: parsed.data }
}

/**
 * 覆盖写一条任务的交付索引。
 * @param root - 规格根（`.spec`）。
 * @param deliverable - 已通过 schema 的索引。
 * @returns 写入的文件路径。
 */
export function saveDeliverable(root: string, deliverable: Deliverable): string {
  const path = deliverablePath(root, deliverable.task)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringifyYaml(Deliverable.parse(deliverable)), 'utf8')
  return path
}
