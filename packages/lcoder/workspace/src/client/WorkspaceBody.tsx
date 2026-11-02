/**
 * 工作台的正文：左任务、中规格-代码对照、右对话。
 *
 * 数据面是**文件投影**：注入的 `projection` 把当前会话的工作区目录里的
 * `tasks/*.yaml` 与 `spec/rules.yaml` 读成行，正文只负责画。没绑投影面
 * （或会话没有工作区）时保持骨架态——同一份组件，测试与生产走同一路径。
 *
 * 状态机判断不在这里：这个任务能不能流转，归 kernel；正文只画文件事实。
 *
 * 列宽用容器查询而不是视口查询：工作台可能停在一个 400px 的侧栏里，也可能
 * 展开成整屏，塌成单栏的时机取决于自己被分到多宽，不是视口多宽。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceProjection } from './projection.ts'
import type {} from './locales.ts'
import css from './WorkspaceBody.module.css'

/** 插件注入的业务面：把会话映射到它的文件投影。 */
export interface WorkspaceInject {
  /**
   * 读取一个会话的投影。可选：缺省（没绑数据面）时三栏保持骨架态，
   * 而不是报错——骨架是这包的合法形态，不是残缺。
   */
  readonly projection?: (sessionId: SessionId, signal: AbortSignal) => Promise<WorkspaceProjection>
}

/** 正文的组合 props：页签运行时 + 本包的文案 + 注入的投影面。 */
export type WorkspaceBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'lcoderWorkspace'>
  & WorkspaceInject

/** 一次投影加载的生命周期。 */
type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: WorkspaceProjection }
  | { readonly kind: 'error'; readonly message: string }

/**
 * 工作台正文。
 * @param props - 槽位组合进来的 props。
 * @returns 表头 + 三栏。
 */
export function WorkspaceBody({ useSessions, sessionId, t, projection }: WorkspaceBodyProps): ReactNode {
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const [state, setState] = useState<LoadState>({ kind: 'idle' })

  useEffect(() => {
    if (cwd === undefined || projection === undefined) {
      setState({ kind: 'idle' })
      return
    }
    const controller = new AbortController()
    setState({ kind: 'loading' })
    projection(sessionId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', message: String(error) })
      })
    return () => {
      controller.abort()
    }
  }, [cwd, sessionId, projection])

  return (
    <div className={css.root} data-lcoder-workspace data-lcoder-cwd={cwd}>
      <header className={css.header}>
        <span className={css.title}>{t('type.label')}</span>
        {cwd === undefined
          ? <span className={css.muted} data-lcoder-no-root>{t('noWorkspace')}</span>
          : <span className={css.path} data-lcoder-root title={cwd}>{cwd}</span>}
      </header>
      <div className={css.columns} data-lcoder-columns>
        <section className={css.column} data-lcoder-column="tasks">
          <h2 className={css.heading}>{t('column.tasks')}</h2>
          <TaskColumn state={state} t={t} />
        </section>
        <section className={css.column} data-lcoder-column="spec">
          <h2 className={css.heading}>{t('column.spec')}</h2>
          <RuleColumn state={state} t={t} />
        </section>
        <section className={css.column} data-lcoder-column="conversation">
          <h2 className={css.heading}>{t('column.conversation')}</h2>
          <p className={css.pending} data-lcoder-pending="conversation">{t('column.conversation.pending')}</p>
        </section>
      </div>
    </div>
  )
}

/** 投影没绑（或会话没工作区）时两栏共用的骨架说明。 */
const PENDING_KEY = { tasks: 'column.tasks.pending', spec: 'column.spec.pending' } as const

function Skeleton({ slot, t }: { slot: 'tasks' | 'spec'; t: TranslateNS<'lcoderWorkspace'> }): ReactNode {
  return <p className={css.pending} data-lcoder-pending={slot}>{t(PENDING_KEY[slot])}</p>
}

function TaskColumn({ state, t }: { state: LoadState; t: TranslateNS<'lcoderWorkspace'> }): ReactNode {
  if (state.kind === 'idle') return <Skeleton slot="tasks" t={t} />
  if (state.kind === 'loading') return <p className={css.pending} data-lcoder-loading="tasks">{t('projection.loading')}</p>
  if (state.kind === 'error') return <p className={css.problem} data-lcoder-error="tasks">{t('projection.error')}：{state.message}</p>

  return (
    <div data-lcoder-tasks>
      {state.data.tasks.length === 0
        ? <p className={css.pending}>{t('tasks.empty')}</p>
        : (
          <ul className={css.list}>
            {state.data.tasks.map(task => (
              <li key={task.id} className={css.row} data-lcoder-task={task.id}>
                <span className={`${css.chip} ${css[`state_${safeState(task.state)}`]}`} data-lcoder-state={task.state}>
                  {task.state}
                </span>
                <span className={css.rowId}>{task.id}</span>
                <span className={css.rowTitle} title={task.title}>{task.title}</span>
              </li>
            ))}
          </ul>
        )}
      <Problems state={state} t={t} />
    </div>
  )
}

function RuleColumn({ state, t }: { state: LoadState; t: TranslateNS<'lcoderWorkspace'> }): ReactNode {
  if (state.kind === 'idle') return <Skeleton slot="spec" t={t} />
  if (state.kind === 'loading') return <p className={css.pending} data-lcoder-loading="spec">{t('projection.loading')}</p>
  if (state.kind === 'error') return <p className={css.problem} data-lcoder-error="spec">{t('projection.error')}：{state.message}</p>

  return (
    <div data-lcoder-rules>
      {state.data.rules.length === 0
        ? <p className={css.pending}>{t('rules.empty')}</p>
        : (
          <ul className={css.list}>
            {state.data.rules.map(rule => (
              <li key={rule.id} className={css.row} data-lcoder-rule={rule.id}>
                <span className={`${css.chip} ${rule.status === 'confirmed' ? css.confirmed : css.draft}`} data-lcoder-status={rule.status}>
                  {rule.status}
                </span>
                <span className={css.rowId}>{rule.id}</span>
                <span className={css.rowTitle} title={rule.text}>{rule.text}</span>
              </li>
            ))}
          </ul>
        )}
      <Problems state={state} t={t} />
    </div>
  )
}

function Problems({ state, t }: { state: Extract<LoadState, { kind: 'ready' }>; t: TranslateNS<'lcoderWorkspace'> }): ReactNode {
  if (state.data.problems.length === 0) return null
  return (
    <div className={css.problems} data-lcoder-problems>
      <p className={css.problemsTitle}>{t('projection.problems')}</p>
      {state.data.problems.map(problem => (
        <p key={problem} className={css.problem} data-lcoder-problem>{problem}</p>
      ))}
    </div>
  )
}

/** 状态值直接来自文件，可能越出五态枚举；类名只认白名单，其余一律中性色。 */
const KNOWN_STATES = ['drafting', 'contracted', 'implementing', 'verifying', 'closed'] as const

function safeState(state: string): string {
  return (KNOWN_STATES as readonly string[]).includes(state) ? state : 'unknown'
}
