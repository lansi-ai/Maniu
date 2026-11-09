// @vitest-environment jsdom
/**
 * 状态大盘整页与顶栏入口：汇总条、会话表三种状态、未认领、事件空态与问题行、
 * 手动刷新、15 秒自动刷新在卸载后停止，以及从看板打开再返回。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
import { AgentDashboardPage } from '../src/client/shell/AgentDashboardPage.tsx'
import type { AgentDashboardPageProps } from '../src/client/shell/AgentDashboardPage.tsx'
import {
  DASHBOARD_REFRESH_MS, summarizeDashboard,
} from '../src/client/dashboard.ts'
import type { DashboardSessionRow } from '../src/client/dashboard.ts'
import type { ActionLogEntry } from '../src/client/flow-history.ts'
import { zh } from '../src/client/locales.ts'
import { TASKS_DIR } from '../src/client/projection.ts'
import type { ProjectionFilesRemote } from '../src/client/projection.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = makeTranslate(zh)

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
    workspace: 'E:/Projects/demo',
    ...overrides,
  }
}

const SESSIONS: readonly DashboardSessionRow[] = [
  sessionOf('s-1', 'waiting', {
    name: '评审会话',
    role: '评审',
    taskId: 'T-01',
    taskTitle: '登录限流',
    queue: 2,
    updatedAt: new Date(2026, 10, 9, 15, 4).getTime(),
  }),
  sessionOf('s-2', 'running', { name: '实施会话', queue: 1 }),
  sessionOf('s-3', 'idle', { name: '空闲会话', taskId: 'T-02', taskTitle: '整理佣金规则' }),
]

const TASKS = [
  { state: 'drafting' }, { state: 'drafting' }, { state: 'implementing' }, { state: 'closed' },
] as const
const SUMMARY = summarizeDashboard(SESSIONS, TASKS)

const EVENT: ActionLogEntry = {
  taskId: 'T-01',
  source: 'schedule',
  at: '2026-11-06T11:00:00Z',
  verdict: 'reuse',
  detail: '选中会话 A',
}

function propsOf(overrides: Partial<AgentDashboardPageProps> = {}): AgentDashboardPageProps {
  return {
    t,
    sessions: SESSIONS,
    summary: SUMMARY,
    events: [],
    eventProblems: {},
    loading: false,
    error: null,
    onBack: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  }
}

describe('状态大盘整页', () => {
  it('汇总条画会话计数、队列总深与任务五态', () => {
    const { container } = render(<AgentDashboardPage {...propsOf()} />)
    const summary = container.querySelector('[data-dashboard-summary]')
    expect(summary?.textContent).toContain(zh['shell.dashboardSessionsTotal'])
    expect(summary?.textContent).toContain(zh['shell.dashboardQueueTotal'])
    expect(container.querySelector('[data-dashboard-task-state="implementing"]')?.textContent).toContain('1')
    expect(container.querySelector('[data-dashboard-task-state="drafting"]')?.textContent).toContain('2')
    expect(container.querySelector('[data-dashboard-task-state="closed"]')?.textContent).toContain('1')
  })

  it('会话表按行画三种状态、认领任务与未认领', () => {
    const { container } = render(<AgentDashboardPage {...propsOf()} />)
    const waiting = container.querySelector('[data-dashboard-session="s-1"]')
    const running = container.querySelector('[data-dashboard-session="s-2"]')
    const idle = container.querySelector('[data-dashboard-session="s-3"]')
    expect(waiting?.textContent).toContain(zh['shell.taskAwaiting'])
    expect(running?.textContent).toContain(zh['shell.running'])
    expect(idle?.textContent).toContain(zh['shell.taskIdle'])
    expect(waiting?.textContent).toContain('T-01')
    expect(waiting?.textContent).toContain('登录限流')
    expect(waiting?.textContent).toContain('2026-11-09 15:04')
    expect(running?.textContent).toContain(zh['shell.dashboardUnclaimed'])
    expect(idle?.textContent).toContain('T-02')
  })

  it('没有事件时画事件空态，并保留关系图占位', () => {
    const { container } = render(<AgentDashboardPage {...propsOf()} />)
    expect(screen.getByText(zh['shell.dashboardEventsEmpty'])).toBeTruthy()
    expect(container.querySelector('[data-dashboard-graph-slot]')?.textContent)
      .toContain(zh['shell.dashboardGraphPending'])
  })

  it('单任务读取失败只画一条问题行，不影响其它事件', () => {
    const { container } = render(<AgentDashboardPage {...propsOf({
      events: [EVENT],
      eventProblems: { 'T-02': 'flow.jsonl: backend down' },
    })} />)
    expect(container.querySelector('[data-dashboard-event="T-01"]')?.textContent).toContain('选中会话 A')
    expect(container.querySelector('[data-dashboard-event-problem="T-02"]')?.textContent).toContain('backend down')
    expect(screen.queryByText(zh['shell.dashboardEventsEmpty'])).toBeNull()
  })

  it('手动刷新调用同一条重读动作', () => {
    const onRefresh = vi.fn()
    render(<AgentDashboardPage {...propsOf({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: zh['shell.dashboardRefresh'] }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('每 15 秒自动刷新，卸载后停止', () => {
    vi.useFakeTimers()
    const onRefresh = vi.fn()
    const { unmount } = render(<AgentDashboardPage {...propsOf({ onRefresh })} />)
    act(() => { vi.advanceTimersByTime(DASHBOARD_REFRESH_MS - 1) })
    expect(onRefresh).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    unmount()
    act(() => { vi.advanceTimersByTime(DASHBOARD_REFRESH_MS * 2) })
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

const REPO = 'E:/Projects/dashboard-demo'
const TASK_YAML = 'id: T-01\ntitle: 大盘里的任务\nstate: implementing\ngrade: B\n'

/** 盘上只有一份任务；其余目录按缺失处理。 */
function shellFiles(): ProjectionFilesRemote {
  const missing = (path: string) => ({
    ok: false as const,
    error: new RemoteError('workspace-file/not-found', `ENOENT: ${path}`, { path }),
  })
  return {
    list: async (_sessionId, path) => path === TASKS_DIR
      ? { ok: true, value: { path, entries: [{ name: 'T-01.yaml', type: 'file' as const }], truncated: false } }
      : missing(path),
    readPage: async (_sessionId, path) => path === `${TASKS_DIR}/T-01.yaml`
      ? {
        ok: true,
        value: {
          absolutePath: `${REPO}/${path}`, version: 'v1', offset: 1,
          text: TASK_YAML, lines: TASK_YAML.split('\n').length, eof: true,
        },
      }
      : missing(path),
  }
}

/** 装一个最小外壳：一条运行中的会话与一份任务。 */
function renderShell(): ReturnType<typeof render> {
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
    ids: [summary.id],
    byId: { [summary.id]: summary },
    phase: 'ready',
    projectionsBySession: {},
  }
  const status: SessionStatusSnapshot = new Map([[
    summary.id,
    { running: true, pendingInteraction: undefined, completionUnread: false },
  ]])
  const workspaces: WorkspaceSnapshot = {
    items: [{
      workspaceId: WorkspaceId('w-1'),
      path: REPO,
      title: 'demo',
      sessionIds: [summary.id],
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  const props: ShellProps = {
    t,
    files: shellFiles(),
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

describe('状态大盘入口', () => {
  it('顶栏按钮打开整页，返回后回到任务看板', async () => {
    const { container } = renderShell()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.dashboard'] }))
    expect(await screen.findByRole('heading', { name: zh['shell.dashboard'] })).toBeTruthy()
    expect(container.querySelector('[data-lcoder-dashboard]')).not.toBeNull()
    expect(await screen.findByText('施工会话')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['shell.backToBoard']) }))
    expect(await screen.findByText(zh['shell.board'])).toBeTruthy()
    expect(container.querySelector('[data-lcoder-dashboard]')).toBeNull()
  })
})
