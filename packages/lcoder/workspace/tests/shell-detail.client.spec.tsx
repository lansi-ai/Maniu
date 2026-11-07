// @vitest-environment jsdom
/**
 * 任务详情弹窗的渲染事实：不让人选角色、契约提示只在有契约时出现、
 * 调度思考过程移出详情但入队位置与日志失败仍看得见。
 *
 * 外壳拿的是投影面与三个选择器钩子；这里用内存投影替掉真远程，
 * 角色名册与模型可用性是直接注入的窄接口。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { zh } from '../src/client/locales.ts'
import {
  CONTRACTS_DIR, PROPOSALS_DIR, SCHEDULING_DIR, TASKS_DIR,
} from '../src/client/projection.ts'
import type { ProjectionFilesRemote } from '../src/client/projection.ts'

afterEach(cleanup)

const REPO = 'E:/Projects/demo'
const t = makeTranslate(zh)

/** 一份内存里的 `.spec`：只给任务与契约，其余目录按缺失处理。 */
interface SpecFiles {
  readonly tasks?: Readonly<Record<string, string>>
  readonly contracts?: Readonly<Record<string, string>>
}

/** 目录缺失的远程失败；`isMissing` 按 code 认这种。 */
function missing(path: string) {
  return { ok: false as const, error: new RemoteError('workspace-file/not-found', `ENOENT: ${path} does not exist`, { path }) }
}

function fakeFiles(spec: SpecFiles): ProjectionFilesRemote {
  const dirs: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    [TASKS_DIR]: spec.tasks ?? {},
    [CONTRACTS_DIR]: spec.contracts ?? {},
    [PROPOSALS_DIR]: {},
    [SCHEDULING_DIR]: {},
  }
  return {
    list: async (_sessionId, path) => {
      const files = dirs[path]
      if (files === undefined) return missing(path)
      return {
        ok: true,
        value: {
          path,
          entries: Object.keys(files).map(name => ({ name, type: 'file' as const })),
          truncated: false,
        },
      }
    },
    readPage: async (_sessionId, path) => {
      const slash = path.lastIndexOf('/')
      const dir = path.slice(0, slash)
      const name = path.slice(slash + 1)
      const text = dirs[dir]?.[name]
      if (text === undefined) return missing(path)
      return {
        ok: true,
        value: { absolutePath: `${REPO}/${path}`, version: 'v1', offset: 1, text, lines: text.split('\n').length, eof: true },
      }
    },
  }
}

/** 一条会话行；`cwd` 与会话号之外只给卡片要的字段。 */
function sessionRow(id: string, cwd: string, running: boolean): SessionSummary {
  return {
    id: SessionId(id),
    displayTitle: id,
    cwd,
    running,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
  }
}

interface ShellScenario {
  readonly spec: SpecFiles
  readonly sessions?: readonly SessionSummary[]
  readonly running?: ReadonlySet<string>
}

/** 已登录的云端替身：门禁放行，详情用例只关心渲染事实；门禁本身有 cloud-login 专测。 */
function signedInCloud(): CloudFace {
  return {
    available: true,
    state: async () => ({
      ok: true,
      value: {
        signedIn: true, needsLogin: false,
        user: { id: 'u1', displayName: null, phoneMasked: '+861****0000', status: 'active' },
        quota: null, guest: null, guestExpired: false, lastError: null,
      },
    }),
    sendSms: vi.fn(),
    register: vi.fn(),
    loginSms: vi.fn(),
    loginPassword: vi.fn(),
    refresh: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
    claimGuest: vi.fn(),
    selectRoute: async () => ({ ok: true, value: { provider: 'lcoder-cloud', model: 'deepseek-flash' } }),
  }
}

/** 组装外壳 props：真实词典、内存投影、可直接断言的窄接口替身。 */
function renderShell(scenario: ShellScenario) {
  const rows = scenario.sessions ?? [sessionRow('s-1', REPO, false)]
  const sessionList: SessionListState = {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready',
    projectionsBySession: {},
  }
  const status: SessionStatusSnapshot = new Map(rows.map(row => [row.id, {
    running: scenario.running?.has(String(row.id)) ?? false,
    pendingInteraction: undefined,
    completionUnread: false,
  }]))
  const workspaces: WorkspaceSnapshot = {
    items: [{
      workspaceId: WorkspaceId('w-1'),
      path: REPO,
      title: 'demo',
      sessionIds: rows.map(row => row.id),
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  const logSchedule = vi.fn(async () => ({ ok: false, text: 'evidence 目录不可写' }))
  const props: ShellProps = {
    t,
    cloud: signedInCloud(),
    files: fakeFiles(scenario.spec),
    usePanelInfo: <S,>(selector: (state: PanelInfo) => S): S => selector({ activePanelId: null }),
    useWorkspaces: <S,>(selector: (state: WorkspaceSnapshot) => S): S => selector(workspaces),
    useWorkspaceAccess: () => true,
    useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessionList),
    useSessionStatus: <S,>(selector: (state: SessionStatusSnapshot) => S): S => selector(status),
    // 外壳不调用这几支全局钩子；给可调用的空替身只为满足槽位 props。
    useRemoteAccess: vi.fn(),
    useSessionRetainInfo: vi.fn(),
    useSessionAccess: vi.fn(),
    useContextMenu: vi.fn(),
    useResource: vi.fn(),
    listRoles: async () => [{ id: 'lcoder-review', name: '评审' }],
    checkModels: async () => ({ state: 'ready' }),
    createSession: async () => SessionId('s-9'),
    signContract: async () => ({ ok: true, text: '已签署' }),
    logSchedule,
  }
  const view = render(<Shell {...props} />)
  return { ...view, props, logSchedule }
}

/** 等任务卡出现在看板上，再点开它的详情。 */
async function openTask(title: string): Promise<void> {
  const card = await screen.findByText(title)
  fireEvent.click(card)
  await screen.findByText(zh['shell.startPrompt'])
}

const TASK_T01 = 'id: T-01\ntitle: 起草中的任务\nstate: drafting\ngrade: B\n'
const TASK_T02 = 'id: T-02\ntitle: 与 T-01 同方案的任务\nstate: drafting\ngrade: B\nproposal: P-01\n'
const CONTRACT_T01 = 'id: T-01\nchange:\n  - 加登录限流\nacceptance:\n  - 五次失败锁定十分钟\n'

describe('任务详情', () => {
  it('详情里没有角色行，「＋ 新会话」弹窗仍有角色可选', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_T01 } } })
    await openTask('起草中的任务')

    expect(screen.queryByText(zh['shell.role'])).toBeNull()
    expect(screen.queryByText(zh['shell.roleHint'])).toBeNull()

    fireEvent.click(screen.getByTitle(zh['shell.newSession']))
    expect(await screen.findByText('评审')).toBeTruthy()
    expect(screen.getByText(zh['shell.role'])).toBeTruthy()
  })

  it('没有契约文件时不出现签署暗示，也不提供签署按钮', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_T01 } } })
    await openTask('起草中的任务')

    expect(screen.getByText(zh['shell.contractMissing'])).toBeTruthy()
    expect(screen.queryByText(zh['shell.contractHint'])).toBeNull()
    expect(screen.queryByRole('button', { name: zh['shell.sign'] })).toBeNull()
  })

  it('有契约且未签署时显示签署提示与签署按钮', async () => {
    renderShell({ spec: { tasks: { 'T-01.yaml': TASK_T01 }, contracts: { 'T-01.contract.yaml': CONTRACT_T01 } } })
    await openTask('起草中的任务')

    expect(screen.queryByText(zh['shell.contractMissing'])).toBeNull()
    expect(screen.getByText(zh['shell.contractHint'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['shell.sign'] })).toBeTruthy()
  })

  it('详情不画调度思考过程，但入队位置与日志写入失败仍在', async () => {
    const { container } = renderShell({
      spec: {
        tasks: {
          // T-01 已认给 s-1 且同方案：再开 T-02 会判成入队。
          'T-01.yaml': 'id: T-01\ntitle: 正在跑的任务\nstate: implementing\ngrade: B\nproposal: P-01\nsession: s-1\n',
          'T-02.yaml': TASK_T02,
        },
      },
      sessions: [sessionRow('s-1', REPO, true)],
      running: new Set(['s-1']),
    })

    await openTask('与 T-01 同方案的任务')
    fireEvent.click(screen.getAllByRole('button', { name: zh['shell.startChat'] })[0]!)
    await waitFor(() => { expect(screen.queryByText(zh['shell.startPrompt'])).toBeNull() })

    // 重新点开详情：判定已留档，日志失败也记在这一条上。
    fireEvent.click(screen.getAllByText('与 T-01 同方案的任务')[0]!)
    await screen.findByText(zh['shell.startPrompt'])

    expect(screen.queryByText('调度思考过程')).toBeNull()
    expect(screen.queryByText('候选会话')).toBeNull()
    expect(container.querySelector('details')).toBeNull()

    expect(screen.getByText(zh['shell.queuedIn']).parentElement?.textContent).toContain('第 1 位')
    expect(screen.getByText('调度日志没写成：evidence 目录不可写')).toBeTruthy()
  })
})
