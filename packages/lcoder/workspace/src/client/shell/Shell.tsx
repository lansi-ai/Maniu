/**
 * LCoder 专属外壳：主面板内的项目切换 + 任务看板 + 悬浮对话。
 *
 * 数据来自当前会话工作区的 `.spec`：任务/规则走 `loadWorkspaceProjection`，
 * 项目信息走 `.spec/project.yaml`，敏感值按 `passwordRef` 从 `.spec/local.yaml`
 * 解析后只留在浏览器内存里。没有工作区或会话时显示空态，不编造数据。
 *
 * 外壳占用 `main` 的 `lcoder-home` 键；DSH 原生侧栏在桌面 profile 里禁用，
 * 启动时折叠空轨道，主面板占满窗口。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { loadLocalSecrets, loadProjectInfo, loadWorkspaceProjection } from '../projection.ts'
import type { ProjectionFilesRemote, TaskRow } from '../projection.ts'
import { buildOnboardingPrompt, buildShellPrompt, SHELL_STATES } from './shell-data.ts'
import type { ShellMessage, ShellProjectInfo, ShellTask, ShellTaskState } from './shell-data.ts'
import css from './Shell.module.css'

/** `main` 键控面板的组合 props：运行时标准 seat + 本包词典 + 文件投影面。 */
export type ShellProps =
  & PropsRuntime<'main', 'lcoder-home'>
  & PropsLocale<'lcoderWorkspace'>
  & {
    /** 文件投影面；没有时外壳保持空态。 */
    readonly files?: ProjectionFilesRemote
    /** 把仓库路径注册成工作区并建一个会话；返回可用于读取 `.spec` 的会话。 */
    readonly openRepository?: (path: string) => Promise<{ workspaceId: string; sessionId: SessionId }>
    /** 向真实会话发送一条文本提示。 */
    readonly sendPrompt?: (sessionId: SessionId, text: string) => Promise<void>
    /** 读真实会话的消息窗口。 */
    readonly readMessages?: (sessionId: SessionId) => readonly ShellMessage[]
    /** 订阅会话事件窗口变化。 */
    readonly subscribeSession?: (sessionId: SessionId, listener: () => void) => () => void
  }

/** 状态到词典键的映射，避免把状态字符串当展示文案。 */
const STATE_LABEL = {
  drafting: 'shell.drafting',
  contracted: 'shell.contracted',
  implementing: 'shell.implementing',
  verifying: 'shell.verifying',
  closed: 'shell.closed',
} as const

/** 状态到色点的映射（CSS Modules 的类名在模块加载时确定）。 */
const STATE_DOT: Record<ShellTaskState, string | undefined> = {
  drafting: css.stateDrafting,
  contracted: css.stateContracted,
  implementing: css.stateImplementing,
  verifying: css.stateVerifying,
  closed: css.stateClosed,
}

/** 状态到工具面的展示文案；与 kernel 的 SURFACE 同义。 */
const SURFACE: Record<ShellTaskState, string> = {
  drafting: '读 / 契约',
  contracted: '读 / 契约 / 编辑',
  implementing: '全量',
  verifying: '全量 + 收口',
  closed: '只读',
}

const KNOWN_STATES: ReadonlySet<string> = new Set(SHELL_STATES.map(state => state.id))

function shellState(value: string): ShellTaskState {
  return KNOWN_STATES.has(value) ? value as ShellTaskState : 'drafting'
}

function toShellTask(row: TaskRow): ShellTask {
  const state = shellState(row.state)
  return {
    id: row.id,
    title: row.title,
    state,
    grade: row.grade,
    rules: row.rules,
    evidence: row.evidence,
    surface: SURFACE[state],
  }
}

function resolveSecrets(info: ShellProjectInfo, secrets: Readonly<Record<string, string>>): ShellProjectInfo {
  return {
    ...info,
    environments: info.environments.map((env) => {
      const database = env.database
      if (database === undefined) return env
      const value = secrets[database.passwordRef]
      return value === undefined ? env : { ...env, database: { ...database, passwordValue: value } }
    }),
  }
}

/**
 * 外壳主组件。
 * @param props - 槽位组合进来的 props。
 * @returns 顶栏 + 任务板 + 项目信息抽屉 + 浮层。
 */
export function Shell({
  t, files, openRepository, sendPrompt, readMessages, subscribeSession, useSessions, useWorkspaces,
}: ShellProps): ReactNode {
  const workspaces = useWorkspaces(state => state.items)
  const sessionRows = useSessions(state => state.byId)

  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [dark, setDark] = useState(false)
  const [projectPicker, setProjectPicker] = useState(false)
  const [detail, setDetail] = useState<ShellTask | null>(null)
  const [prompt, setPrompt] = useState('')
  const [chat, setChat] = useState<ShellTask | null>(null)
  const [settings, setSettings] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)
  const [tasks, setTasks] = useState<readonly ShellTask[]>([])
  const [rulesCount, setRulesCount] = useState(0)
  const [info, setInfo] = useState<ShellProjectInfo | null>(null)
  const [problems, setProblems] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionOverride, setSessionOverride] = useState<SessionId | null>(null)
  const [repoPath, setRepoPath] = useState('')
  const [opening, setOpening] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [messages, setMessages] = useState<readonly ShellMessage[]>([])
  const [chatError, setChatError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const workspace = workspaces.find(item => String(item.workspaceId) === workspaceId) ?? workspaces[0]
  const activeWorkspaceId = workspace === undefined ? null : String(workspace.workspaceId)
  const sessionId = sessionOverride ?? workspace?.sessionIds[0]
  const session = sessionId === undefined ? undefined : sessionRows[sessionId]
  const projectPath = session?.cwd ?? workspace?.path ?? ''
  const projectName = workspace?.title ?? 'LCoder'
  const projectBranch = info?.branch ?? '—'
  const specRoot = projectPath === '' ? '' : `${projectPath}/.spec`
  const hasWorkspace = workspace !== undefined
  const hasSession = sessionId !== undefined
  const chatRunning = sessionId === undefined ? false : sessionRows[sessionId]?.running ?? false

  useEffect(() => {
    if (files === undefined || workspace === undefined || sessionId === undefined) {
      setTasks([])
      setRulesCount(0)
      setInfo(null)
      setProblems([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    Promise.all([
      loadWorkspaceProjection(files, sessionId, controller.signal),
      loadProjectInfo(files, sessionId, controller.signal),
      loadLocalSecrets(files, sessionId, controller.signal),
    ]).then(([projection, projectInfo, secrets]) => {
      if (controller.signal.aborted) return
      setTasks(projection.tasks.map(toShellTask))
      setRulesCount(projection.rules.length)
      setProblems([...projection.problems, ...projectInfo.problems])
      setInfo(projectInfo.info === null ? null : resolveSecrets(projectInfo.info, secrets))
      setLoading(false)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setTasks([])
      setRulesCount(0)
      setInfo(null)
      setProblems([String(error)])
      setLoading(false)
    })
    return () => { controller.abort() }
  }, [files, activeWorkspaceId, sessionId])

  useEffect(() => {
    if (chat === null || sessionId === undefined || readMessages === undefined || subscribeSession === undefined) {
      setMessages([])
      return
    }
    const refresh = (): void => { setMessages(readMessages(sessionId)) }
    refresh()
    return subscribeSession(sessionId, refresh)
  }, [chat, sessionId, readMessages, subscribeSession])

  const openTask = (task: ShellTask): void => {
    setDetail(task)
    setPrompt(buildShellPrompt({ name: projectName, path: projectPath, branch: projectBranch }, task))
    setCopied(false)
  }

  const copyPrompt = (): void => {
    void navigator.clipboard.writeText(prompt).then(
      () => {
        setCopied(true)
        setTimeout(() => { setCopied(false) }, 1200)
      },
      () => { setCopied(false) },
    )
  }

  const startConversation = (task: ShellTask): void => {
    setChat(task)
    setDetail(null)
    setChatError(null)
    if (sessionId === undefined || sendPrompt === undefined) {
      setChatError(t('shell.noSession'))
      return
    }
    void sendPrompt(sessionId, prompt).catch((error: unknown) => { setChatError(String(error)) })
  }

  /**
   * 零任务仓库的立项入口：把 `.spec/project.yaml` 声明的交付文档交给模型，
   * 让它先调研再逐个建 drafting 任务。外壳只读文件、不判断状态机。
   */
  const startOnboarding = (): void => {
    const text = buildOnboardingPrompt(
      { name: projectName, path: projectPath, branch: projectBranch },
      info?.docs ?? { product: '', architecture: '', tests: '' },
    )
    setDetail(null)
    setChatError(null)
    setPrompt(text)
    setCopied(false)
    setChat({ id: '', title: t('shell.onboardingChat'), state: 'drafting', grade: '-', rules: [], evidence: [], surface: '' })
    if (sessionId === undefined || sendPrompt === undefined) {
      setChatError(t('shell.noSession'))
      return
    }
    void sendPrompt(sessionId, text).catch((error: unknown) => { setChatError(String(error)) })
  }

  const sendDraft = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || sessionId === undefined || sendPrompt === undefined) return
    setDraft('')
    setChatError(null)
    try {
      await sendPrompt(sessionId, text)
    } catch (error: unknown) {
      setChatError(String(error))
    }
  }

  const submitRepo = async (): Promise<void> => {
    if (openRepository === undefined) return
    const path = repoPath.trim()
    if (path === '') return
    setOpening(true)
    setRepoError(null)
    try {
      const opened = await openRepository(path)
      setWorkspaceId(opened.workspaceId)
      setSessionOverride(opened.sessionId)
      setProjectPicker(false)
    } catch (error: unknown) {
      setRepoError(String(error))
    } finally {
      setOpening(false)
    }
  }

  const renderColumn = (state: (typeof SHELL_STATES)[number], compact = false): ReactNode => {
    const columnTasks = tasks.filter(task => task.state === state.id)
    return (
      <div key={state.id} className={css.column}>
        <div className={css.columnHead}>
          <span className={css.columnName}>
            <span className={`${css.stateDot ?? ''} ${STATE_DOT[state.id] ?? ''}`} />
            {t(state.labelKey)}
          </span>
          <span className={css.count}>{columnTasks.length}</span>
        </div>
        {columnTasks.length === 0
          ? <div className={css.empty}>{t('shell.empty')}</div>
          : columnTasks.map(task => (
            <button type="button" key={task.id} className={css.taskCard} onClick={() => { openTask(task) }}>
              <div className={css.taskId}><span>{task.id}</span><span>{task.grade}</span></div>
              <div className={css.taskTitle}>{task.title}</div>
              {compact ? null : (
                <div className={css.tags}>
                  {task.rules.map(rule => <span key={rule} className={css.tag}>{rule}</span>)}
                  <span className={`${css.tag} ${task.state === 'closed' ? css.tagOk : ''}`}>{task.surface}</span>
                </div>
              )}
            </button>
          ))}
      </div>
    )
  }

  return (
    <div className={css.shell} data-theme={dark ? 'dark' : 'light'}>
      <header className={css.topbar}>
        <div className={css.topBrand}>
          <div className={css.topLogo}>L</div>
          <span className={css.topTitle}>LCoder</span>
        </div>
        <button type="button" className={css.topProject} title={t('shell.switchProject')} onClick={() => { setProjectPicker(true) }}>
          <span className={css.psLogo}>{(projectName || 'L').slice(0, 1).toUpperCase()}</span>
          <span className={css.psText}>
            <span className={css.psName}>{projectName}</span>
            <span className={css.psPath}>{projectPath || '—'}</span>
          </span>
          <span className={css.psChevron}>⌄</span>
        </button>
        <div className={css.spacer} />
        <button type="button" className={css.secondaryBtn} onClick={() => { setDrawer(true) }}>ⓘ {t('shell.projectInfo')}</button>
        <button type="button" className={css.iconBtn} title={t('shell.theme')} onClick={() => { setDark(value => !value) }}>◐</button>
        <button type="button" className={css.iconBtn} title={t('shell.settings')} onClick={() => { setSettings(true) }}>⚙</button>
      </header>

      <main className={css.main}>
        <div className={css.boardWrap}>
          <div className={css.boardHead}>
            <h3>{t('shell.board')}</h3>
            <span className={css.boardHint}>{t('shell.boardHint')}</span>
          </div>
          {!hasWorkspace
            ? <p className={css.empty}>{t('shell.noWorkspace')}</p>
            : loading
              ? <p className={css.empty}>{t('shell.loading')}</p>
              : !hasSession
                ? <p className={css.empty}>{t('shell.noSession')}</p>
                : (
                  <>
                    <div className={css.board}>
                      {SHELL_STATES.map(state => renderColumn(state))}
                    </div>
                    {tasks.length === 0 ? (
                      <div className={css.onboardingBar}>
                        <p className={css.onboardingText}>{t('shell.onboardingEmpty')} {t('shell.onboardingHint')}</p>
                        <button type="button" className={css.primaryBtn} onClick={startOnboarding}>{t('shell.onboardingCta')}</button>
                      </div>
                    ) : null}
                    {problems.length > 0 ? (
                      <div className={css.problems}>
                        <p className={css.problemsTitle}>{t('shell.problems')}</p>
                        {problems.map(problem => <p key={problem} className={css.problem}>{problem}</p>)}
                      </div>
                    ) : null}
                  </>
                )}
        </div>
      </main>

      {drawer ? (
        <div className={css.drawerBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setDrawer(false) }}>
          <aside className={css.drawer}>
            <div className={css.drawerHead}>
              <div className={css.grow}>
                <h3>{t('shell.projectInfo')}</h3>
                <p>{t('shell.projectInfoHint')}</p>
              </div>
              <button type="button" className={css.iconBtn} onClick={() => { setDrawer(false) }}>✕</button>
            </div>
            <div className={css.drawerBody}>
              <section className={css.drawerSection}>
                <h4>{t('shell.basic')}</h4>
                <div className={css.infoGrid}>
                  <div className={css.infoRow}><span>{t('shell.kind')}</span><b>{info?.kind ?? '—'}</b></div>
                  <div className={css.infoRow}>
                    <span>{t('shell.repoUrl')}</span>
                    {info?.repoUrl === undefined || info.repoUrl === ''
                      ? <b>—</b>
                      : <a href={info.repoUrl} target="_blank" rel="noreferrer">{info.repoUrl}</a>}
                  </div>
                  <div className={css.infoRow}><span>{t('shell.branch')}</span><b>{info?.branch ?? '—'}</b></div>
                  <div className={css.infoRow}><span>{t('shell.specRoot')}</span><code>{specRoot || '—'}</code></div>
                  <div className={css.infoRow}><span>{t('shell.tasks')}</span><b>{tasks.length}</b></div>
                  <div className={css.infoRow}><span>{t('shell.rules')}</span><b>{rulesCount}</b></div>
                </div>
              </section>

              <section className={css.drawerSection}>
                <h4>{t('shell.docs')}</h4>
                <div className={css.docRow}><span>{t('shell.productDoc')}</span><code>{info?.docs.product || '—'}</code></div>
                <div className={css.docRow}><span>{t('shell.architectureDoc')}</span><code>{info?.docs.architecture || '—'}</code></div>
                <div className={css.docRow}><span>{t('shell.tests')}</span><code>{info?.docs.tests || '—'}</code></div>
              </section>

              <section className={css.drawerSection}>
                <h4>{t('shell.environments')}</h4>
                {info === null
                  ? <p className={css.empty}>{t('shell.projectInfoMissing')}</p>
                  : info.kind !== 'web' || info.environments.length === 0
                    ? <p className={css.empty}>{t('shell.webOnly')}</p>
                    : info.environments.map((env) => {
                      const database = env.database
                      const passwordKey = `${env.id}.password`
                      const shown = revealed[passwordKey] === true
                      return (
                        <div key={env.id} className={css.envCard}>
                          <div className={css.envHead}>
                            <b>{env.label}</b>
                            <span className={css.pill}>{env.note ?? ''}</span>
                          </div>
                          <div className={css.infoRow}><span>{t('shell.server')}</span><code>{env.server ?? '—'}</code></div>
                          {database === undefined ? null : (
                            <>
                              <div className={css.infoRow}><span>{t('shell.dbHost')}</span><code>{database.host}:{database.port ?? '—'}</code></div>
                              <div className={css.infoRow}><span>{t('shell.dbName')}</span><code>{database.name}</code></div>
                              <div className={css.infoRow}><span>{t('shell.dbUser')}</span><code>{database.user}</code></div>
                              <div className={css.infoRow}>
                                <span>{t('shell.password')}</span>
                                <code>{shown ? (database.passwordValue ?? t('shell.unconfigured')) : '••••••'}</code>
                                <button
                                  type="button"
                                  className={css.eyeBtn}
                                  title={shown ? t('shell.hide') : t('shell.reveal')}
                                  onClick={() => { setRevealed(prev => ({ ...prev, [passwordKey]: !prev[passwordKey] })) }}
                                >
                                  {shown ? '🙈' : '👁'}
                                </button>
                              </div>
                              <div className={css.secretRef}>{database.passwordRef} · {t('shell.secretNote')}</div>
                            </>
                          )}
                        </div>
                      )
                    })}
              </section>
            </div>
          </aside>
        </div>
      ) : null}

      {projectPicker ? (
        <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setProjectPicker(false) }}>
          <div className={`${css.modal} ${css.modalSmall}`}>
            <div className={css.modalHead}>
              <div className={css.grow}><h3>{t('shell.switchProject')}</h3><p>{t('shell.projectPickerHint')}</p></div>
              <button type="button" className={css.iconBtn} onClick={() => { setProjectPicker(false) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              {workspaces.length === 0
                ? <p className={css.empty}>{t('shell.noWorkspace')}</p>
                : (
                  <div className={css.projectPicker}>
                    {workspaces.map((item) => {
                      const id = String(item.workspaceId)
                      return (
                        <button
                          type="button"
                          key={id}
                          className={`${css.projectOption} ${id === activeWorkspaceId ? css.projectOptionActive : ''}`}
                          onClick={() => { setWorkspaceId(id); setSessionOverride(null); setProjectPicker(false) }}
                        >
                          <span className={css.psLogo}>{(item.title || 'L').slice(0, 1).toUpperCase()}</span>
                          <span className={css.poText}>
                            <span className={css.poName}>{item.title}</span>
                            <span className={css.poPath}>{item.path}</span>
                          </span>
                          <span className={css.poCount}>{item.sessionIds.length} {t('shell.sessions')}</span>
                          {id === activeWorkspaceId ? <span className={css.poCheck}>✓</span> : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              <div className={css.repoOpen}>
                <input
                  className={css.repoInput}
                  value={repoPath}
                  placeholder={t('shell.repoPathHint')}
                  onChange={(event) => { setRepoPath(event.target.value) }}
                />
                <button
                  type="button"
                  className={css.primaryBtn}
                  disabled={opening || openRepository === undefined || repoPath.trim() === ''}
                  onClick={() => { void submitRepo() }}
                >
                  {opening ? t('shell.opening') : t('shell.openRepo')}
                </button>
              </div>
              {repoError === null ? null : <p className={css.problem}>{repoError}</p>}
            </div>
            <div className={css.modalFoot}>
              <span className={css.boardHint}>{t('shell.projectSource')}</span>
            </div>
          </div>
        </div>
      ) : null}

      {detail !== null ? (
        <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setDetail(null) }}>
          <div className={css.modal}>
            <div className={css.modalHead}>
              <div className={css.grow}>
                <h3>{detail.id} · {detail.title}</h3>
                <p>{projectName} / {projectPath} · {t('shell.specRoot')} {specRoot || '—'}</p>
              </div>
              <span className={css.pill}>{t(STATE_LABEL[detail.state])}</span>
              <button type="button" className={css.iconBtn} onClick={() => { setDetail(null) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              <div className={css.metaGrid}>
                <div className={css.meta}><div className={css.metaK}>{t('shell.grade')}</div><div className={css.metaV}>{detail.grade}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.rules')}</div><div className={css.metaV}>{detail.rules.join(', ') || '—'}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.evidence')}</div><div className={css.metaV}>{detail.evidence.join(', ') || '—'}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.surface')}</div><div className={css.metaV}>{detail.surface}</div></div>
              </div>
              <div className={css.field}>
                <label>{t('shell.startPrompt')} <span className={css.labelHint}>{t('shell.promptHint')}</span></label>
                <textarea className={css.promptBox} value={prompt} onChange={(event) => { setPrompt(event.target.value) }} />
              </div>
            </div>
            <div className={css.modalFoot}>
              <button type="button" className={css.secondaryBtn} onClick={copyPrompt}>{copied ? t('shell.copied') : t('shell.copyPrompt')}</button>
              <div className={css.spacer} />
              <button type="button" className={css.secondaryBtn} onClick={() => { setDetail(null) }}>{t('shell.cancel')}</button>
              <button type="button" className={css.primaryBtn} onClick={() => { startConversation(detail) }}>{t('shell.startChat')}</button>
            </div>
          </div>
        </div>
      ) : null}

      {chat !== null ? (
        <div className={css.floating}>
          <div className={css.floatingBackdrop} onClick={() => { setChat(null) }} />
          <div className={css.floatingInner}>
            <div className={css.boardWindow}>
              <div className={css.miniHead}>
                <div className={css.grow}>
                  <h4>{projectName} · {t('shell.board')}</h4>
                  <p>{t('shell.chatHint')} · {t('shell.specRoot')} {specRoot || '—'}</p>
                </div>
                <span className={`${css.pill} ${css.pillBrand}`}>{t('shell.tasks')}</span>
              </div>
              <div className={css.miniBoard}>
                {SHELL_STATES.map(state => renderColumn(state, true))}
              </div>
            </div>

            <div className={css.chatWindow}>
              <div className={css.chatHead}>
                <div className={css.grow}>
                  <h4>{chat.id === '' ? chat.title : `${chat.id} · ${chat.title}`}</h4>
                  <p>LCoder · {t(STATE_LABEL[chat.state])} · {t('shell.chatHint')}</p>
                </div>
                <span className={css.pill}>{chatRunning ? t('shell.running') : t('shell.chatReady')}</span>
                <button type="button" className={css.iconBtn} title={t('shell.expand')} onClick={() => { setChat(null) }}>⤢</button>
              </div>
              <div className={css.chatBody}>
                {messages.length === 0
                  ? (
                    <div className={`${css.msg} ${css.msgSys}`}>
                      <span className={css.who}>LCoder</span>
                      {chatRunning ? t('shell.chatWaiting') : t('shell.chatEmpty')}
                    </div>
                  )
                  : messages.map((message, index) => (
                    <div
                      key={`${message.role}-${String(index)}`}
                      className={`${css.msg} ${message.role === 'user' ? css.msgUser : css.msgSys}`}
                    >
                      <span className={css.who}>{message.role === 'user' ? '你' : 'LCoder'}</span>
                      {message.text}
                    </div>
                  ))}
                {chatError === null ? null : <p className={css.problem}>{chatError}</p>}
              </div>
              <div className={css.chatInput}>
                <input
                  value={draft}
                  placeholder={t('shell.placeholder')}
                  onChange={(event) => { setDraft(event.target.value) }}
                />
                <button
                  type="button"
                  className={css.primaryBtn}
                  disabled={draft.trim() === '' || sessionId === undefined || sendPrompt === undefined}
                  onClick={() => { void sendDraft() }}
                >
                  {t('shell.send')}
                </button>
              </div>
            </div>
            <div className={css.caption}>{t('shell.chatHint')}</div>
          </div>
        </div>
      ) : null}

      {settings ? (
        <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setSettings(false) }}>
          <div className={`${css.modal} ${css.modalSmall}`}>
            <div className={css.modalHead}>
              <div className={css.grow}><h3>{t('shell.settings')}</h3><p>{t('shell.settingsHint')}</p></div>
              <button type="button" className={css.iconBtn} onClick={() => { setSettings(false) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              <div className={css.settingsGrid}>
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.specRoot')}</span><span className={css.settingLabelSpan}>{specRoot || '—'}</span></div><span className={css.pill}>{t('shell.sessionBound')}</span></div>
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.model')}</span><span className={css.settingLabelSpan}>DeepSeek-V4.1-Flash High</span></div><span className={css.pill}>{t('shell.default')}</span></div>
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.floating')}</span><span className={css.settingLabelSpan}>{t('shell.floatingHint')}</span></div><button type="button" className={`${css.switch} ${css.switchOn}`} /></div>
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.theme')}</span><span className={css.settingLabelSpan}>Light / Dark</span></div><button type="button" className={`${css.switch} ${dark ? css.switchOn : ''}`} onClick={() => { setDark(value => !value) }} /></div>
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.plugins')}</span><span className={css.settingLabelSpan}>{t('shell.onlySettings')}</span></div><span className={css.pill}>{t('shell.hidden')}</span></div>
              </div>
            </div>
            <div className={css.modalFoot}><div className={css.spacer} /><button type="button" className={css.primaryBtn} onClick={() => { setSettings(false) }}>{t('shell.done')}</button></div>
          </div>
        </div>
      ) : null}

      <div className={css.demoBadge}>LCoder · {t('shell.realData')}</div>
    </div>
  )
}
