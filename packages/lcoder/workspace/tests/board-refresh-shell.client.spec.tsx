// @vitest-environment jsdom
/**
 * 看板自动重读接线：定时器与窗口重新获得焦点都走外壳既有的 `setReload` 路径，
 * 真的再读一次 `.spec` 投影与项目信息；没有工作区时什么都不读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Shell } from '../src/client/shell/Shell.tsx'
import type { ShellProps } from '../src/client/shell/Shell.tsx'
import type { CloudFace } from '../src/client/cloud/face.ts'
import { PROJECT_FILE, TASKS_DIR } from '../src/client/projection.ts'
import type { ProjectionFilesRemote } from '../src/client/projection.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (document as { hidden?: boolean }).hidden
})

const t = makeTranslate(zh)
const REPO = 'E:/Projects/board-demo'
const TASK_YAML = 'id: T-01\ntitle: 看板里的任务\nstate: implementing\ngrade: B\n'

/** 投影读取计数：`project` 数的是 `.spec/project.yaml` 的读取次数。 */
interface ReadCounts {
  project: number
}

/** `.spec` 盘面只有一份任务；项目信息缺失，读取次数用来判断重读。 */
function countedFiles(counts: ReadCounts): ProjectionFilesRemote {
  const missing = (path: string) => ({
    ok: false as const,
    error: new RemoteError('workspace-file/not-found', `ENOENT: ${path}`, { path }),
  })
  return {
    list: async (_sessionId, path) => path === TASKS_DIR
      ? { ok: true, value: { path, entries: [{ name: 'T-01.yaml', type: 'file' as const }], truncated: false } }
      : missing(path),
    readPage: async (_sessionId, path) => {
      if (path === PROJECT_FILE) counts.project += 1
      return path === `${TASKS_DIR}/T-01.yaml`
        ? {
          ok: true,
          value: {
            absolutePath: `${REPO}/${path}`, version: 'v1', offset: 1,
            text: TASK_YAML, lines: TASK_YAML.split('\n').length, eof: true,
          },
        }
        : missing(path)
    },
  }
}

/** 已登录云端替身：整壳只在登录后渲染。 */
function signedInCloud(): CloudFace {
  return {
    available: true,
    state: async () => ({
      ok: true,
      value: {
        signedIn: true, needsLogin: false, user: null, quota: null, estimate: null, guest: null, guestExpired: false, lastError: null,
      },
    }),
    sendSms: vi.fn(),
    register: vi.fn(),
    loginSms: vi.fn(),
    loginPassword: vi.fn(),
    refresh: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
    usage: vi.fn(),
    selectRoute: vi.fn(),
  }
}

/** 装一个最小外壳；`withWorkspace` 为 false 时没有任何项目，看板空态。 */
function renderShell(counts: ReadCounts, withWorkspace: boolean): ReturnType<typeof render> {
  const summary: SessionSummary = {
    id: SessionId('s-1'),
    title: '施工会话',
    displayTitle: '施工会话',
    cwd: REPO,
    running: true,
    retainedBy: {},
    blank: false,
    updatedAt: new Date(2026, 10, 9, 15, 30).getTime(),
  }
  const sessionList: SessionListState = {
    ids: withWorkspace ? [summary.id] : [],
    byId: withWorkspace ? { [summary.id]: summary } : {},
    phase: 'ready',
    projectionsBySession: {},
  }
  const status: SessionStatusSnapshot = new Map([[
    summary.id,
    { running: true, pendingInteraction: undefined, completionUnread: false },
  ]])
  const workspaces: WorkspaceSnapshot = {
    items: withWorkspace
      ? [{
        workspaceId: WorkspaceId('w-1'),
        path: REPO,
        title: 'demo',
        sessionIds: [summary.id],
        createdAt: '2026-11-06T00:00:00.000Z',
        updatedAt: '2026-11-06T00:00:00.000Z',
      }]
      : [],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  const props: ShellProps = {
    t,
    cloud: signedInCloud(),
    files: countedFiles(counts),
    usePanelInfo: <S,>(selector: (state: PanelInfo) => S): S => selector({ activePanelId: null }),
    useWorkspaces: <S,>(selector: (state: WorkspaceSnapshot) => S): S => selector(workspaces),
    useWorkspaceAccess: () => true,
    useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessionList),
    useSessionStatus: <S,>(selector: (state: SessionStatusSnapshot) => S): S => selector(status),
    useRemoteAccess: vi.fn(),
    useSessionRetainInfo: vi.fn(),
    useSessionAccess: vi.fn(),
    useContextMenu: vi.fn(),
    useResource: vi.fn(),
  }
  return render(<Shell {...props} />)
}

describe('看板自动重读接线', () => {
  it('窗口重新获得焦点立即重读投影与项目信息', async () => {
    const counts: ReadCounts = { project: 0 }
    renderShell(counts, true)
    expect(await screen.findByText('看板里的任务')).toBeTruthy()
    const initial = counts.project
    expect(initial).toBeGreaterThan(0)

    fireEvent.focus(window)

    await waitFor(() => { expect(counts.project).toBe(initial + 1) })
    expect(counts.project).toBe(initial + 1)
  })

  it('十秒定时器到点重读一次', async () => {
    // 只假定时器：首轮读取与 `waitFor` 仍走真实微任务与短计时。
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const counts: ReadCounts = { project: 0 }
    renderShell(counts, true)
    expect(await screen.findByText('看板里的任务')).toBeTruthy()
    const initial = counts.project

    act(() => { vi.advanceTimersByTime(9_999) })
    expect(counts.project).toBe(initial)
    act(() => { vi.advanceTimersByTime(1) })

    await waitFor(() => { expect(counts.project).toBe(initial + 1) })
  })

  it('没有工作区时焦点与定时器都不读盘', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const counts: ReadCounts = { project: 0 }
    renderShell(counts, false)
    expect(await screen.findByText(zh['shell.noWorkspace'])).toBeTruthy()

    fireEvent.focus(window)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(counts.project).toBe(0)
  })
})
