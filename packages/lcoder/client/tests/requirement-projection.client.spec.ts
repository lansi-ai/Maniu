/** 需求投影：版本、评审与过审字段透传给客户端，旧 YAML 缺字段不报故障。 */
import { describe, expect, it } from 'vitest'

import { requirementTextToRow } from '../src/spec/rows.ts'

describe('需求投影', () => {
  it('透传版本、评审与过审字段', () => {
    const row = requirementTextToRow('REQ-01.yaml', [
      'id: REQ-01',
      'title: 佣金改造',
      'state: confirmed',
      'opened_at: 2026-11-13T09:00:00+08:00',
      'versions:',
      '  - n: 1',
      '    at: 2026-11-13T09:00:00+08:00',
      '    note: 初稿',
      '  - n: 2',
      '    at: 2026-11-13T11:00:00+08:00',
      'reviews:',
      '  - round: 1',
      '    at: 2026-11-13T10:00:00+08:00',
      '    report: requirements/REQ-01/reviews/R1.md',
      '    sessionId: session-1',
      'approved_at: 2026-11-13T12:00:00+08:00',
      'approved_version: 2',
    ].join('\n'))

    expect(row?.versions).toEqual([
      { n: 1, at: '2026-11-13T09:00:00+08:00', note: '初稿' },
      { n: 2, at: '2026-11-13T11:00:00+08:00' },
    ])
    expect(row?.reviews).toEqual([
      {
        round: 1,
        at: '2026-11-13T10:00:00+08:00',
        report: 'requirements/REQ-01/reviews/R1.md',
        sessionId: 'session-1',
      },
    ])
    expect(row?.approvedAt).toBe('2026-11-13T12:00:00+08:00')
    expect(row?.approvedVersion).toBe(2)
  })

  it('旧 YAML 缺字段时给空数组与未定义，不报故障', () => {
    const row = requirementTextToRow('REQ-02.yaml', 'id: REQ-02\ntitle: 旧需求\nstate: draft')
    expect(row?.versions).toEqual([])
    expect(row?.reviews).toEqual([])
    expect(row?.approvedAt).toBeUndefined()
    expect(row?.approvedVersion).toBeUndefined()
  })

  it('透传评审处置三态、决定时刻、关联版本与备注，非法枚举和版本号丢弃', () => {
    const row = requirementTextToRow('REQ-04.yaml', [
      'id: REQ-04',
      'title: 处置投影',
      'reviews:',
      '  - round: 1',
      '    at: 2026-11-17T09:00:00+08:00',
      '    report: requirements/REQ-04/reviews/R1.md',
      '    decision: pending',
      '  - round: 2',
      '    at: 2026-11-17T10:00:00+08:00',
      '    report: requirements/REQ-04/reviews/R2.md',
      '    decision: accepted',
      '    decided_at: 2026-11-17T11:00:00+08:00',
      '    applied_version: 3',
      '    decision_note: 采纳建议',
      '  - round: 3',
      '    at: 2026-11-17T12:00:00+08:00',
      '    report: requirements/REQ-04/reviews/R3.md',
      '    decision: rejected',
      '  - round: 4',
      '    at: 2026-11-17T13:00:00+08:00',
      '    report: requirements/REQ-04/reviews/R4.md',
      '    decision: unknown',
      '    applied_version: 0',
    ].join('\n'))

    expect(row?.reviews).toEqual([
      {
        round: 1,
        at: '2026-11-17T09:00:00+08:00',
        report: 'requirements/REQ-04/reviews/R1.md',
        decision: 'pending',
      },
      {
        round: 2,
        at: '2026-11-17T10:00:00+08:00',
        report: 'requirements/REQ-04/reviews/R2.md',
        decision: 'accepted',
        decidedAt: '2026-11-17T11:00:00+08:00',
        appliedVersion: 3,
        decisionNote: '采纳建议',
      },
      {
        round: 3,
        at: '2026-11-17T12:00:00+08:00',
        report: 'requirements/REQ-04/reviews/R3.md',
        decision: 'rejected',
      },
      {
        round: 4,
        at: '2026-11-17T13:00:00+08:00',
        report: 'requirements/REQ-04/reviews/R4.md',
      },
    ])
  })

  it('读不懂的版本或评审条目跳过，不影响其余字段', () => {
    const row = requirementTextToRow('REQ-03.yaml', [
      'id: REQ-03',
      'title: 坏条目',
      'versions:',
      '  - n: 0',
      '    at: 2026-11-13T09:00:00+08:00',
      '  - n: 1',
      'reviews:',
      '  - round: 1',
      '    at: 2026-11-13T10:00:00+08:00',
      'approved_version: 0',
    ].join('\n'))

    expect(row?.versions).toEqual([])
    expect(row?.reviews).toEqual([])
    expect(row?.approvedVersion).toBeUndefined()
  })
})
