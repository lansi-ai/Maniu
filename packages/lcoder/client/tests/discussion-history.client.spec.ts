/** 讨论历史：从宿主列表线形认出 lcoder-pm 会话。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { summaryOf, type SessionSummary } from '../src/store.ts'
import { readDiscussionHistory } from '../src/discussion/history.ts'

const PROJECT = 'E:/repo'
const RECORDS = [
  {
    type: 'event',
    event: {
      type: 'user/message',
      seq: 1,
      time: 1,
      data: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'REQ-99 先讨论一个最小切片。' }],
      },
    },
  },
  {
    type: 'event',
    event: {
      type: 'assistant/message',
      seq: 2,
      time: 2,
      data: { message: { content: [{ type: 'text', text: '建议先做最小可验收切片。' }] } },
    },
  },
]

function stubHostRecords(): void {
  vi.stubGlobal('window', {
    lcoder: {
      call: async () => ({ ok: true, value: { records: RECORDS } }),
    },
  })
}

function summaryOfRow(extra: Record<string, unknown>): SessionSummary {
  const summary = summaryOf({
    sessionId: 'session-pm',
    updatedAt: 1,
    running: false,
    blank: false,
    cwd: PROJECT,
    ...extra,
  })
  if (summary === undefined) throw new Error('summaryOf 返回空')
  return summary
}

const PM_GROUP = [{
  roleId: 'pm',
  roleName: '项目经理',
  statements: ['建议先做最小可验收切片。'],
}]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readDiscussionHistory', () => {
  it('宿主投影线形识别 lcoder-pm 会话', async () => {
    stubHostRecords()
    const sessions = [summaryOfRow({
      projections: { kind: 'sequenced', asOfSeq: 3, values: { agentPreset: 'lcoder-pm' } },
    })]
    const history = await readDiscussionHistory(PROJECT, sessions, 'REQ-99')
    expect(history.status).toBe('ready')
    expect(history.groups).toEqual(PM_GROUP)
  })

  it('旧顶层线形同样识别 lcoder-pm 会话', async () => {
    stubHostRecords()
    const history = await readDiscussionHistory(PROJECT, [summaryOfRow({ agentPreset: 'lcoder-pm' })], 'REQ-99')
    expect(history.groups).toEqual(PM_GROUP)
  })

  it('没有 preset 的会话不进入候选', async () => {
    const history = await readDiscussionHistory(PROJECT, [summaryOfRow({})], 'REQ-99')
    expect(history).toEqual({
      status: 'ready',
      groups: [],
      message: '没有找到带参会身份的讨论会话。',
    })
  })
})
