/**
 * 状态大盘数据面：汇总计数、状态优先级、事件合并与上限、逐任务读取容错。
 *
 * 读取替身按路径给正文或抛错；缺失文件按宿主的 not-found 处理，不算故障。
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceDirectoryListing, WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  DASHBOARD_EVENT_LIMIT, dashboardStatusOf, loadDashboardEvents, mergeDashboardEvents,
  summarizeDashboard, updatedAtLabel,
} from '../src/client/dashboard.ts'
import type { DashboardSessionRow, DashboardTaskEvents } from '../src/client/dashboard.ts'
import type { ActionLogEntry } from '../src/client/flow-history.ts'
import type { ProjectionFilesRemote } from '../src/client/projection.ts'

const SESSION = 's-1' as SessionId

/** 一条会话行；用例只覆盖需要断言的字段。 */
function sessionOf(
  sessionId: string,
  status: DashboardSessionRow['status'],
  overrides: Partial<DashboardSessionRow> = {},
): DashboardSessionRow {
  return {
    sessionId,
    name: sessionId,
    role: 'dev',
    status,
    queue: 0,
    workspace: 'E:/repo',
    ...overrides,
  }
}

describe('状态大盘汇总', () => {
  it('统计会话四种计数、队列总深与任务五态', () => {
    const summary = summarizeDashboard(
      [
        sessionOf('s-1', 'waiting', { queue: 1 }),
        sessionOf('s-2', 'running', { queue: 2 }),
        sessionOf('s-3', 'idle'),
      ],
      [
        { state: 'drafting' }, { state: 'drafting' }, { state: 'closed' },
      ],
    )
    expect(summary).toEqual({
      total: 3,
      running: 1,
      idle: 1,
      waiting: 1,
      queueTotal: 3,
      tasks: { drafting: 2, contracted: 0, implementing: 0, verifying: 0, closed: 1 },
    })
  })

  it('等待人优先于运行中，运行中优先于空闲', () => {
    expect(dashboardStatusOf({ pendingInteraction: {}, running: true })).toBe('waiting')
    expect(dashboardStatusOf({ running: true })).toBe('running')
    expect(dashboardStatusOf({})).toBe('idle')
    expect(dashboardStatusOf({ running: false })).toBe('idle')
  })

  it('没有宿主更新时间时显示横线，有时按本地时间格式化', () => {
    expect(updatedAtLabel(undefined)).toBe('—')
    expect(updatedAtLabel(0)).toBe('—')
    expect(updatedAtLabel(new Date(2026, 10, 9, 15, 4).getTime())).toBe('2026-11-09 15:04')
  })
})

describe('事件流合并', () => {
  /** 一条只有时刻的日志条目。 */
  function entryAt(at: string | null, taskId = 'T-01'): ActionLogEntry {
    return { taskId, source: 'flow', at, action: 'implement' }
  }

  it('按时刻倒序并截到三十条', () => {
    const entries = Array.from({ length: 35 }, (_, index) => {
      const minute = String(index % 60).padStart(2, '0')
      return entryAt(`2026-11-06T10:${minute}:00Z`)
    })
    const merged = mergeDashboardEvents([{ taskId: 'T-01', entries }])
    expect(merged.entries).toHaveLength(DASHBOARD_EVENT_LIMIT)
    expect(merged.entries[0]?.at).toBe('2026-11-06T10:34:00Z')
    expect(merged.entries.at(-1)?.at).toBe('2026-11-06T10:05:00Z')
    expect(merged.problems).toEqual({})
  })

  it('没有时刻的条目排在最后，问题按任务归位', () => {
    const inputs: DashboardTaskEvents[] = [
      { taskId: 'T-01', entries: [entryAt(null)], problem: 'flow.jsonl 读失败' },
      { taskId: 'T-02', entries: [entryAt('2026-11-06T12:00:00Z', 'T-02')] },
    ]
    const merged = mergeDashboardEvents(inputs)
    expect(merged.entries.map(entry => entry.taskId)).toEqual(['T-02', 'T-01'])
    expect(merged.problems).toEqual({ 'T-01': 'flow.jsonl 读失败' })
  })
})

/** 内存文件面：按路径给正文；`Error` 表示读取本身抛错。 */
function fakeFiles(files: Readonly<Record<string, string | Error>>): ProjectionFilesRemote {
  return {
    list: async (_sessionId, path) => ({
      ok: true,
      value: { path, entries: [], truncated: false } satisfies WorkspaceDirectoryListing,
    }),
    readPage: async (_sessionId, path) => {
      const value = files[path]
      if (value === undefined) {
        return {
          ok: false,
          error: new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path }),
        }
      }
      if (value instanceof Error) throw value
      return {
        ok: true,
        value: {
          absolutePath: `E:/repo/${path}`,
          version: 'v1',
          offset: 1,
          text: value,
          lines: value.split('\n').length,
          eof: true,
        } satisfies WorkspaceFileText,
      }
    },
  }
}

describe('状态大盘事件读取', () => {
  it('合并任务的 flow 与 schedule，单个任务抛错只标注该任务', async () => {
    const files = fakeFiles({
      '.spec/evidence/T-01/flow.jsonl': JSON.stringify({
        at: '2026-11-06T10:00:00Z', action: 'implement', result: 'success', reason: '开工',
      }),
      '.spec/evidence/T-01/schedule.jsonl': JSON.stringify({
        at: '2026-11-06T11:00:00Z', verdict: 'reuse', reasons: ['选中会话 A'],
      }),
      '.spec/evidence/T-02/flow.jsonl': new Error('backend down'),
    })

    const loaded = await loadDashboardEvents(files, SESSION, ['T-01', 'T-02', 'T-03'], new AbortController().signal)
    expect(loaded.entries.map(entry => entry.at)).toEqual(['2026-11-06T11:00:00Z', '2026-11-06T10:00:00Z'])
    expect(loaded.entries[1]).toMatchObject({ taskId: 'T-01', source: 'flow', action: 'implement' })
    expect(Object.keys(loaded.problems)).toEqual(['T-02'])
    expect(loaded.problems['T-02']).toContain('backend down')
    expect(loaded.problems['T-03']).toBeUndefined()
  })

  it('全部日志缺失时返回空事件与空问题', async () => {
    const loaded = await loadDashboardEvents(fakeFiles({}), SESSION, ['T-01', 'T-02'], new AbortController().signal)
    expect(loaded.entries).toEqual([])
    expect(loaded.problems).toEqual({})
  })
})
