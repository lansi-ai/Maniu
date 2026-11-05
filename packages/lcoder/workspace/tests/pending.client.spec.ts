/**
 * 审批/提问卡只负责把人的选择折成上游 answer() 接受的回答；
 * 这里钉住问答规则（单选替换、多选增删、逐题必答）。
 */
import { describe, expect, it } from 'vitest'
import { answerBatch, emptyDrafts, selectOption } from '../src/client/shell/pending.ts'
import type { ShellQuestion } from '../src/client/shell/pending.ts'

const SINGLE: ShellQuestion = {
  id: 'q1',
  question: '走哪条路线？',
  options: [{ label: '复用上游' }, { label: '自造渲染' }],
}

const MULTI: ShellQuestion = {
  id: 'q2',
  question: '要哪些能力？',
  multiSelect: true,
  options: [{ label: 'markdown' }, { label: '折叠' }],
}

describe('待处理提问', () => {
  it('空草稿覆盖每一题，且都不可提交', () => {
    const drafts = emptyDrafts([SINGLE, MULTI])

    expect(drafts).toEqual({
      q1: { selected: [], custom: '' },
      q2: { selected: [], custom: '' },
    })
    expect(answerBatch([SINGLE, MULTI], drafts)).toBeNull()
  })

  it('单选点新项替换、点已选项清空', () => {
    const draft = { selected: ['复用上游'], custom: '' }

    expect(selectOption(SINGLE, draft, '自造渲染')).toEqual({ selected: ['自造渲染'], custom: '' })
    expect(selectOption(SINGLE, draft, '复用上游')).toEqual({ selected: [], custom: '' })
  })

  it('多选勾选与取消并存，自定义回答原样保留', () => {
    const first = selectOption(MULTI, { selected: [], custom: '备注' }, 'markdown')
    const second = selectOption(MULTI, first, '折叠')
    const third = selectOption(MULTI, second, 'markdown')

    expect(first.selected).toEqual(['markdown'])
    expect(second.selected).toEqual(['markdown', '折叠'])
    expect(third.selected).toEqual(['折叠'])
    expect(third.custom).toBe('备注')
  })

  it('每道题有选项或非空自定义回答才给出整批回答', () => {
    const partial = emptyDrafts([SINGLE, MULTI])
    expect(answerBatch([SINGLE, MULTI], partial)).toBeNull()

    const answered = {
      q1: { selected: ['自造渲染'], custom: '  ' },
      q2: { selected: [], custom: '  都要  ' },
    }
    expect(answerBatch([SINGLE, MULTI], answered)).toEqual({
      answers: [
        { id: 'q1', selected: ['自造渲染'] },
        { id: 'q2', selected: [], custom: '都要' },
      ],
    })
  })

  it('空问题列表不产生可提交的回答', () => {
    expect(answerBatch([], {})).toBeNull()
  })
})
