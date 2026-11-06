/**
 * `.spec/agents.yaml` 的读取：缺文件是常态，读不懂要说明，两个会话号可各自缺省。
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceDirectoryListing, WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import { AGENTS_FILE, loadAgentsRegistry } from '../src/client/projection.ts'
import type { ProjectionFilesRemote } from '../src/client/projection.ts'

const SESSION = 's-1' as SessionId

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function notFound(path: string): RemoteFailure {
  return new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
}

function fakeFiles(text: string | undefined): ProjectionFilesRemote {
  return {
    list: async (_sessionId, path) => ok({ path, entries: [], truncated: false } satisfies WorkspaceDirectoryListing),
    readPage: async (_sessionId, path) => text === undefined
      ? { ok: false, error: notFound(path) }
      : ok({
        absolutePath: `/w/${path}`, version: 'v1', offset: 1, text, lines: text.split('\n').length, eof: true,
      } satisfies WorkspaceFileText),
  }
}

describe('常驻会话登记', () => {
  it('缺文件 → agents 为 null，不算问题', async () => {
    expect(await loadAgentsRegistry(fakeFiles(undefined), SESSION, new AbortController().signal))
      .toEqual({ agents: null, problems: [] })
  })

  it('读出两个会话号；只写一个时另一个缺省', async () => {
    const loaded = await loadAgentsRegistry(
      fakeFiles('schedulerSession: scheduler-1\nflowSession: flow-1\n'),
      SESSION,
      new AbortController().signal,
    )
    expect(loaded.agents).toEqual({ schedulerSession: 'scheduler-1', flowSession: 'flow-1' })
    expect(loaded.problems).toEqual([])

    const partial = await loadAgentsRegistry(fakeFiles('flowSession: flow-1\n'), SESSION, new AbortController().signal)
    expect(partial.agents).toEqual({ flowSession: 'flow-1' })
  })

  it('读不懂的 YAML 记进 problems，不编造会话号', async () => {
    const loaded = await loadAgentsRegistry(fakeFiles('schedulerSession: [\n'), SESSION, new AbortController().signal)
    expect(loaded.agents).toBeNull()
    expect(loaded.problems[0]).toContain(AGENTS_FILE)
  })
})
