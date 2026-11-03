/**
 * LCoder 专属外壳：主面板内的项目切换 + 任务看板 + 悬浮对话。
 *
 * 这一版是已确认原型的可运行版本：项目/任务先用静态数据把布局与交互跑通，
 * 真实 `.spec` 投影与 session 绑定在下一刀接入；组件的数据入口保持不变。
 *
 * 外壳占用 `main` 的 `lcoder-home` 键；DSH 原生侧栏在桌面 profile 里禁用，
 * 因此这里的左栏就是 LCoder 自己的导航，不再常驻 DSH 的工作区列表。
 */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './shell-data.ts'
import { buildShellPrompt, SHELL_PROJECT_INFO, SHELL_PROJECTS, SHELL_STATES } from './shell-data.ts'
import type { ShellProject, ShellProjectInfo, ShellTask, ShellTaskState } from './shell-data.ts'
import css from './Shell.module.css'

/** `main` 键控面板的组合 props：运行时标准 seat + 本包词典。 */
export type ShellProps =
  & PropsRuntime<'main', 'lcoder-home'>
  & PropsLocale<'lcoderWorkspace'>

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

/**
 * 外壳主组件。
 * @param props - 槽位组合进来的 props。
 * @returns 左栏 + 任务板 + 浮层。
 */
export function Shell({ t }: ShellProps): ReactNode {
  const [projects, setProjects] = useState<ShellProject[]>(() => [...SHELL_PROJECTS])
  const [projectId, setProjectId] = useState(SHELL_PROJECTS[0]?.id ?? 'lcoder')
  const [dark, setDark] = useState(false)
  const [projectPicker, setProjectPicker] = useState(false)
  const [detail, setDetail] = useState<ShellTask | null>(null)
  const [prompt, setPrompt] = useState('')
  const [chat, setChat] = useState<ShellTask | null>(null)
  const [settings, setSettings] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)
  const nextProject = useRef(SHELL_PROJECTS.length + 1)

  const project = projects.find(p => p.id === projectId) ?? projects[0]
  if (project === undefined) return null

  const info: ShellProjectInfo = SHELL_PROJECT_INFO[project.id] ?? {
    kind: 'library',
    repoUrl: '',
    branch: project.branch,
    docs: { product: 'README.md', architecture: 'docs/architecture.md', tests: 'tests' },
    environments: [],
  }

  const openTask = (task: ShellTask): void => {
    setDetail(task)
    setPrompt(buildShellPrompt(project, task))
    setCopied(false)
  }

  const addTask = (): void => {
    const task: ShellTask = {
      id: `T-${100 + project.tasks.length + 1}`,
      title: t('shell.newTaskPlaceholder'),
      state: 'drafting',
      grade: 'B',
      rules: ['R-01'],
      evidence: ['build'],
      surface: '读 / 契约',
    }
    setProjects(current => current.map(p => p.id === project.id ? { ...p, tasks: [task, ...p.tasks] } : p))
    openTask(task)
  }

  const addProject = (): void => {
    const n = nextProject.current++
    const next: ShellProject = {
      id: `project-${String(n)}`,
      name: `新项目 ${String(n)}`,
      path: `E:/Projects/new-project-${String(n)}`,
      branch: 'main',
      rules: 0,
      summary: '新建项目',
      tasks: [],
    }
    setProjects(current => [...current, next])
    setProjectId(next.id)
    setProjectPicker(false)
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

  const renderColumn = (state: (typeof SHELL_STATES)[number], compact = false): ReactNode => {
    const tasks = project.tasks.filter(task => task.state === state.id)
    return (
      <div key={state.id} className={css.column}>
        <div className={css.columnHead}>
          <span className={css.columnName}>
            <span className={`${css.stateDot ?? ''} ${STATE_DOT[state.id] ?? ''}`} />
            {t(state.labelKey)}
          </span>
          <span className={css.count}>{tasks.length}</span>
        </div>
        {tasks.length === 0
          ? <div className={css.empty}>{t('shell.empty')}</div>
          : tasks.map(task => (
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
          <span className={css.psLogo}>{project.name.slice(0, 1).toUpperCase()}</span>
          <span className={css.psText}>
            <span className={css.psName}>{project.name}</span>
            <span className={css.psPath}>{project.path}</span>
          </span>
          <span className={css.psChevron}>⌄</span>
        </button>
        <div className={css.spacer} />
        <button type="button" className={css.secondaryBtn} onClick={() => { setDrawer(true) }}>ⓘ {t('shell.projectInfo')}</button>
        <button type="button" className={css.iconBtn} title={t('shell.theme')} onClick={() => { setDark(value => !value) }}>◐</button>
        <button type="button" className={css.iconBtn} title={t('shell.settings')} onClick={() => { setSettings(true) }}>⚙</button>
        <button type="button" className={css.primaryBtn} onClick={addTask}>+ {t('shell.newTask')}</button>
      </header>

      <main className={css.main}>
        <div className={css.boardWrap}>
          <div className={css.boardHead}>
            <h3>{t('shell.board')}</h3>
            <span className={css.boardHint}>{t('shell.boardHint')}</span>
          </div>
          <div className={css.board}>
            {SHELL_STATES.map(state => renderColumn(state))}
          </div>
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
                  <div className={css.infoRow}><span>{t('shell.kind')}</span><b>{info.kind}</b></div>
                  <div className={css.infoRow}>
                    <span>{t('shell.repoUrl')}</span>
                    {info.repoUrl === ''
                      ? <b>—</b>
                      : <a href={info.repoUrl} target="_blank" rel="noreferrer">{info.repoUrl}</a>}
                  </div>
                  <div className={css.infoRow}><span>{t('shell.branch')}</span><b>{info.branch}</b></div>
                  <div className={css.infoRow}><span>{t('shell.specRoot')}</span><code>{project.path}/.spec</code></div>
                </div>
              </section>

              <section className={css.drawerSection}>
                <h4>{t('shell.docs')}</h4>
                <div className={css.docRow}><span>{t('shell.productDoc')}</span><code>{info.docs.product}</code></div>
                <div className={css.docRow}><span>{t('shell.architectureDoc')}</span><code>{info.docs.architecture}</code></div>
                <div className={css.docRow}><span>{t('shell.tests')}</span><code>{info.docs.tests}</code></div>
              </section>

              <section className={css.drawerSection}>
                <h4>{t('shell.environments')}</h4>
                {info.kind !== 'web' || info.environments.length === 0
                  ? <p className={css.empty}>{t('shell.webOnly')}</p>
                  : info.environments.map((env) => {
                    const passwordKey = `${env.id}.password`
                    const shown = revealed[passwordKey] === true
                    return (
                      <div key={env.id} className={css.envCard}>
                        <div className={css.envHead}>
                          <b>{env.label}</b>
                          <span className={css.pill}>{env.note ?? ''}</span>
                        </div>
                        <div className={css.infoRow}><span>{t('shell.server')}</span><code>{env.server}</code></div>
                        <div className={css.infoRow}><span>{t('shell.dbHost')}</span><code>{env.database.host}:{env.database.port}</code></div>
                        <div className={css.infoRow}><span>{t('shell.dbName')}</span><code>{env.database.name}</code></div>
                        <div className={css.infoRow}><span>{t('shell.dbUser')}</span><code>{env.database.user}</code></div>
                        <div className={css.infoRow}>
                          <span>{t('shell.password')}</span>
                          <code>{shown ? env.database.passwordPreview : '••••••'}</code>
                          <button
                            type="button"
                            className={css.eyeBtn}
                            title={shown ? t('shell.hide') : t('shell.reveal')}
                            onClick={() => { setRevealed(prev => ({ ...prev, [passwordKey]: !prev[passwordKey] })) }}
                          >
                            {shown ? '🙈' : '👁'}
                          </button>
                        </div>
                        <div className={css.secretRef}>{env.database.passwordRef} · {t('shell.secretNote')}</div>
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
              <div className={css.projectPicker}>
                {projects.map(item => (
                  <button
                    type="button"
                    key={item.id}
                    className={`${css.projectOption} ${item.id === project.id ? css.projectOptionActive : ''}`}
                    onClick={() => { setProjectId(item.id); setProjectPicker(false) }}
                  >
                    <span className={css.psLogo}>{item.name.slice(0, 1).toUpperCase()}</span>
                    <span className={css.poText}>
                      <span className={css.poName}>{item.name}</span>
                      <span className={css.poPath}>{item.path}</span>
                    </span>
                    <span className={css.poCount}>
                      {item.tasks.length} {t('shell.tasks')}
                    </span>
                    {item.id === project.id ? <span className={css.poCheck}>✓</span> : null}
                  </button>
                ))}
              </div>
            </div>
            <div className={css.modalFoot}>
              <span className={css.boardHint}>{t('shell.projectSource')}</span>
              <div className={css.spacer} />
              <button type="button" className={css.secondaryBtn} onClick={addProject}>{t('shell.newProject')}</button>
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
                <p>{project.name} / {project.summary} · {t('shell.specRoot')} {project.path}/.spec</p>
              </div>
              <span className={css.pill}>{t(STATE_LABEL[detail.state])}</span>
              <button type="button" className={css.iconBtn} onClick={() => { setDetail(null) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              <div className={css.metaGrid}>
                <div className={css.meta}><div className={css.metaK}>{t('shell.grade')}</div><div className={css.metaV}>{detail.grade}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.rules')}</div><div className={css.metaV}>{detail.rules.join(', ')}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.evidence')}</div><div className={css.metaV}>{detail.evidence.join(', ')}</div></div>
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
              <button type="button" className={css.primaryBtn} onClick={() => { setChat(detail); setDetail(null) }}>{t('shell.startChat')}</button>
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
                  <h4>{project.name} · {t('shell.board')}</h4>
                  <p>{t('shell.chatHint')} · {t('shell.specRoot')} {project.path}/.spec</p>
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
                  <h4>{chat.id} · {chat.title}</h4>
                  <p>LCoder · {t(STATE_LABEL[chat.state])} · {t('shell.chatHint')}</p>
                </div>
                <span className={css.pill}>{t(STATE_LABEL[chat.state])}</span>
                <button type="button" className={css.iconBtn} title={t('shell.expand')} onClick={() => { setChat(null) }}>⤢</button>
              </div>
              <div className={css.chatBody}>
                <div className={`${css.msg} ${css.msgSys}`}>
                  <span className={css.who}>{t('shell.chatSystem')}</span>
                  {t('shell.chatGenerated')}
                </div>
                <div className={`${css.msg} ${css.msgUser}`}>
                  <span className={css.who}>你</span>
                  {t('shell.chatUser')}
                </div>
                <div className={`${css.msg} ${css.msgSys}`}>
                  <span className={css.who}>LCoder</span>
                  {t('shell.chatReply')}
                </div>
              </div>
              <div className={css.chatInput}>
                <input placeholder={t('shell.placeholder')} />
                <button type="button" className={css.primaryBtn}>{t('shell.send')}</button>
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
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.specRoot')}</span><span className={css.settingLabelSpan}>{project.path}/.spec</span></div><span className={css.pill}>{t('shell.sessionBound')}</span></div>
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

      <div className={css.demoBadge}>LCoder 外壳 · 演示数据</div>
    </div>
  )
}
