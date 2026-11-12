// @vitest-environment jsdom
/**
 * 结果卡「更多讨论」的外壳接线：只对当前会话补发第二轮讨论指令，
 * 不新建会话、不重发立项咒语；发送在途阶段当场回到思考。
 * 「重新开始」只打开既有确认框，建会话与重发仍等确认后走原路径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import type { ShellMessage } from '../src/client/shell/shell-data.ts'
import { INTAKE_MORE_DISCUSSION } from '../src/client/shell/intake-wizard.ts'
import { CONTRACTS_DIR, PROPOSALS_DIR, SCHEDULING_DIR, TASKS_DIR } from '../src/client/projection.ts'
import type { ProjectionFilesRemote } from '../src/client/projection.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)
const REPO = 'E:/Projects/intake-demo'

/** 目录缺失的远程失败，与投影面约定一致。 */
function missing(path: string) {
  return { ok: false as const, error: new RemoteError('workspace-file/not-found', `ENOENT: ${path}`, { path }) }
}

/** 一个零任务的 `.spec`：只给空目录，项目信息与名册都读不到。 */
function emptyFiles(): ProjectionFilesRemote {
  return {
    list: async (_sessionId, path) => {
      const empty = [TASKS_DIR, CONTRACTS_DIR, PROPOSALS_DIR, SCHEDULING_DIR].includes(path)
      if (empty) return { ok: true, value: { path, entries: [], truncated: false } }
      return missing(path)
    },
    readPage: async (_sessionId, path) => missing(path),
  }
}

/** 已登录云端替身：门禁放行，路由切换成功。 */
function signedInCloud(): CloudFace {
  return {
    available: true,
    state: async () => ({
      ok: true,
      value: {
        signedIn: true, needsLogin: false,
        user: { id: 'u1', displayName: null, phoneMasked: '+861****0000', status: 'active' },
        quota: null, estimate: null, guest: null, guestExpired: false, lastError: null,
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
    selectRoute: async () => ({ ok: true, value: { provider: 'lcoder-cloud', model: 'deepseek-flash' } }),
  }
}

/** 立项会话已经访谈完一轮：第一轮咒语已落，最后一条助手答复是需求概要。 */
const MESSAGES: readonly ShellMessage[] = [
  { role: 'user', text: '全新项目立项：intake-demo（E:/Projects/intake-demo，main）', hidden: true },
  { role: 'assistant', text: '## 项目需求概要\n\n- 业务目标：记账' },
]

/** 一条受理过立项咒语的会话行。 */
function sessionRow(): SessionSummary {
  return {
    id: SessionId('s-1'),
    displayTitle: '立项会话',
    cwd: REPO,
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
  }
}

interface ShellHandles {
  readonly createSession: ReturnType<typeof vi.fn>
  readonly sendPrompt: ReturnType<typeof vi.fn>
}

/** 组装外壳：真实词典、空投影与可直接断言的两个宽接口替身。 */
function renderShell(): { view: ReturnType<typeof render>; handles: ShellHandles } {
  const row = sessionRow()
  const sessionList: SessionListState = {
    ids: [row.id],
    byId: { [row.id]: row },
    phase: 'ready',
    projectionsBySession: {},
  }
  const status: SessionStatusSnapshot = new Map([[row.id, {
    running: false, pendingInteraction: undefined, completionUnread: false,
  }]])
  const workspaces: WorkspaceSnapshot = {
    items: [{
      workspaceId: WorkspaceId('w-1'),
      path: REPO,
      title: 'intake-demo',
      sessionIds: [row.id],
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  // 发送永不落定：用来观察发送在途的阶段与菜单禁用。
  const createSession = vi.fn(async () => SessionId('s-9'))
  const sendPrompt = vi.fn(() => new Promise<void>(() => {}))
  const props: ShellProps = {
    t,
    cloud: signedInCloud(),
    files: emptyFiles(),
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
    listRoles: async () => [{ id: 'lcoder-review', name: '评审' }],
    checkModels: async () => ({ state: 'ready' }),
    createSession,
    sendPrompt,
    readMessages: () => MESSAGES,
    subscribeSession: () => () => {},
    holdSession: () => () => {},
    readSessionFlags: () => ({ awaitingFirstTurn: false, failed: false }),
  }
  return { view: render(<Shell {...props} />), handles: { createSession, sendPrompt } }
}

/** 打开向导并等到结果卡出现；消息到位后沉降窗口约两秒，留足等待。 */
async function openResultCard(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: zh['shell.onboardingNewProject'] }))
  await screen.findByText(zh['shell.wizardSummaryHint'], undefined, { timeout: 4000 })
  return screen.getByRole('button', { name: zh['shell.wizardMoreRounds'] })
}

describe('结果卡更多讨论', () => {
  it('只对当前会话发第二轮讨论指令，不新建会话、不重发立项咒语', async () => {
    const { view, handles } = renderShell()
    const more = await openResultCard()

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: zh['shell.wizardMoreDiscuss'] }))

    await waitFor(() => {
      expect(handles.sendPrompt).toHaveBeenCalledTimes(1)
    })
    expect(handles.sendPrompt).toHaveBeenCalledWith(SessionId('s-1'), INTAKE_MORE_DISCUSSION)
    expect(handles.createSession).not.toHaveBeenCalled()
    // 发送在途即算在跑：结果卡收起，阶段当场回到思考。
    expect(view.container.querySelector('[data-lcoder-intake-wizard]')?.getAttribute('data-phase')).toBe('thinking')
  })

  it('重新开始只打开既有确认框，确认前不建会话', async () => {
    const { view, handles } = renderShell()
    const more = await openResultCard()

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: zh['shell.restartIntake'] }))
    await waitFor(() => {
      expect(view.container.querySelector('[data-lcoder-intake-restart]')).not.toBeNull()
    })
    expect(handles.createSession).not.toHaveBeenCalled()
    const dialog = view.container.querySelector<HTMLElement>('[data-lcoder-intake-restart]')
    if (dialog !== null) fireEvent.click(within(dialog).getByRole('button', { name: zh['shell.cancel'] }))
    expect(view.container.querySelector('[data-lcoder-intake-restart]')).toBeNull()
  })
})
