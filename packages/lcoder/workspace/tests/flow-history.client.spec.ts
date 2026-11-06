/**
 * 动作流水读取：flow.jsonl 与 schedule.jsonl 合并倒序，缺文件不算故障。
 *
 * 文件面用内存替身，按页返回；超过一页的日志要读到最后，不能只拿最早的 500 行。
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceDirectoryListing, WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { loadActionLog } from '../src/client/flow-history.ts'
import type { ProjectionFilesRemote } from '../src/client/projection.ts'

const SESSION = 's-1' as SessionId
const LIMIT = 500

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function notFound(path: string): RemoteFailure {
  return new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
}

/** 内存文件面：按行分页，和宿主 `workspaceFiles.read` 一样从 1 起。 */
function fakeFiles(files: Record<string, string>): ProjectionFilesRemote {
  return {
    list: async (_sessionId, path) => ok({
      path,
      entries: [],
      truncated: false,
    } satisfies WorkspaceDirectoryListing),
    readPage: async (_sessionId, path, _signal, offset = 1) => {
      const text = files[path]
      if (text === undefined) return { ok: false, error: notFound(path) }
      const all = text.split('\n')
      const start = offset - 1
      const page = all.slice(start, start + LIMIT)
      return ok({
        absolutePath: `/w/${path}`,
        version: 'v1',
        offset,
        text: page.join('\n'),
        lines: page.length,
        eof: start + page.length >= all.length,
      } satisfies WorkspaceFileText)
    },
  }
}

describe('动作流水', () => {
  it('合并两个文件并按时刻倒序', async () => {
    const files = fakeFiles({
      '.spec/evidence/T-01/flow.jsonl': [
        JSON.stringify({ at: '2026-11-06T10:00:00Z', action: 'implement', result: 'success', reason: '开工' }),
        JSON.stringify({ at: '2026-11-06T12:00:00Z', action: 'sign', mode: 'auto', result: 'held' }),
      ].join('\n'),
      '.spec/evidence/T-01/schedule.jsonl': [
        JSON.stringify({ at: '2026-11-06T11:00:00Z', verdict: 'reuse', reasons: ['选中会话 A'] }),
      ].join('\n'),
    })

    const loaded = await loadActionLog(files, SESSION, ['T-01'], new AbortController().signal)
    expect(loaded.problems).toEqual([])
    expect(loaded.entries.map(entry => entry.at)).toEqual([
      '2026-11-06T12:00:00Z',
      '2026-11-06T11:00:00Z',
      '2026-11-06T10:00:00Z',
    ])
    expect(loaded.entries[0]).toMatchObject({ source: 'flow', action: 'sign', mode: 'auto', result: 'held' })
    expect(loaded.entries[1]).toMatchObject({ source: 'schedule', verdict: 'reuse', detail: '选中会话 A' })
  })

  it('flow.jsonl 还没有时只读 schedule.jsonl', async () => {
    const files = fakeFiles({
      '.spec/evidence/T-02/schedule.jsonl': JSON.stringify({ at: '2026-11-06T09:00:00Z', verdict: 'new' }),
    })
    const loaded = await loadActionLog(files, SESSION, ['T-02'], new AbortController().signal)
    expect(loaded.entries).toHaveLength(1)
    expect(loaded.entries[0]?.source).toBe('schedule')
    expect(loaded.problems).toEqual([])
  })

  it('超过一页时读到文件末尾，保留最新一条', async () => {
    const lines = Array.from({ length: LIMIT + 20 }, (_, index) =>
      JSON.stringify({ at: `2026-11-06T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00Z`, action: 'implement' }))
    lines.push(JSON.stringify({ at: '2026-11-07T00:00:00Z', action: 'close', result: 'success' }))
    const files = fakeFiles({ '.spec/evidence/T-03/flow.jsonl': lines.join('\n') })

    const loaded = await loadActionLog(files, SESSION, ['T-03'], new AbortController().signal)
    expect(loaded.entries[0]).toMatchObject({ taskId: 'T-03', action: 'close', at: '2026-11-07T00:00:00Z' })
  })

  it('读不懂的行跳过，真实读取失败记进 problems', async () => {
    const failing: ProjectionFilesRemote = {
      list: async (_sessionId, path) => ok({ path, entries: [], truncated: false } satisfies WorkspaceDirectoryListing),
      readPage: async () => {
        throw new Error('backend down')
      },
    }
    await expect(loadActionLog(failing, SESSION, ['T-01'], new AbortController().signal)).rejects.toThrow('backend down')

    const files = fakeFiles({ '.spec/evidence/T-01/flow.jsonl': 'not json\n' })
    const loaded = await loadActionLog(files, SESSION, ['T-01'], new AbortController().signal)
    expect(loaded.entries).toEqual([])
  })
})
