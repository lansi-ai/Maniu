/**
 * 需求九态推导的行为测：钉住每一种状态与它们的优先级。
 *
 * 这些用例是界面标签的唯一依据——判定错了，看板会把「开发中」的需求画成「待上线」。
 */
import { describe, expect, it } from 'vitest'

import { requirementProgress } from '../src/schema/requirement-progress.js'
import type { TaskState } from '../src/schema/spec.js'

function progress(state: 'draft' | 'confirmed' | 'released' | 'closed', hasDocument: boolean, tasks: TaskState[]) {
  return requirementProgress({ state, hasDocument, tasks })
}

describe('需求进度', () => {
  it('closed 一律是已取消，哪怕正文缺失或有任务在开发', () => {
    expect(progress('closed', true, [])).toBe('cancelled')
    expect(progress('closed', false, ['implementing'])).toBe('cancelled')
  })

  it('released 一律是已上线，优先级高于正文缺失', () => {
    expect(progress('released', true, ['closed'])).toBe('released')
    expect(progress('released', false, [])).toBe('released')
  })

  it('正文缺失是待补全，优先于待确认与后续任务进展', () => {
    expect(progress('draft', false, [])).toBe('incomplete')
    expect(progress('confirmed', false, ['closed'])).toBe('incomplete')
  })

  it('起草态是待确认', () => {
    expect(progress('draft', true, [])).toBe('pending')
    expect(progress('draft', true, ['drafting'])).toBe('pending')
  })

  it('已确认且没有任务就是已确认', () => {
    expect(progress('confirmed', true, [])).toBe('confirmed')
  })

  it('任一任务在开发中就是开发中，验收中不抢优先级', () => {
    expect(progress('confirmed', true, ['implementing'])).toBe('developing')
    expect(progress('confirmed', true, ['verifying', 'implementing', 'closed'])).toBe('developing')
  })

  it('没有开发中但任一在验收中就是测试中', () => {
    expect(progress('confirmed', true, ['verifying'])).toBe('testing')
    expect(progress('confirmed', true, ['drafting', 'verifying', 'closed'])).toBe('testing')
  })

  it('全部任务关闭才是待上线', () => {
    expect(progress('confirmed', true, ['closed'])).toBe('ready-release')
    expect(progress('confirmed', true, ['closed', 'closed'])).toBe('ready-release')
    expect(progress('confirmed', true, ['closed', 'contracted'])).toBe('split')
  })

  it('还有任务没开工或没关闭就是已拆分', () => {
    expect(progress('confirmed', true, ['drafting'])).toBe('split')
    expect(progress('confirmed', true, ['drafting', 'contracted'])).toBe('split')
  })
})
