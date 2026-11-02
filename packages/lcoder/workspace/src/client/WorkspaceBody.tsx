/**
 * 工作台的正文：左任务、中规格-代码对照、右对话。
 *
 * 这一步只落到**结构**：三栏的边框、标题、以及每一栏「还没接线」的说明。
 * 数据要等宿主侧的 Remote 命名空间建起来（由 `@lcoder/kernel` 提供）才进来，
 * 所以这里没有任何 store，也不读页签之外的会话状态——唯一的实时输入是
 * 会话的工作区目录，用来证明这个正文是**按会话**挂载的，而不是一张全局静态图。
 *
 * 列宽用容器查询而不是视口查询：工作台可能停在一个 400px 的侧栏里，也可能
 * 展开成整屏，塌成单栏的时机取决于自己被分到多宽，不是视口多宽。
 */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from './locales.ts'
import css from './WorkspaceBody.module.css'

/** 正文的组合 props：页签运行时 + 本包的文案。 */
export type WorkspaceBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'lcoderWorkspace'>

/**
 * 工作台正文。
 * @param props - 槽位组合进来的 props。
 * @returns 表头 + 三栏。
 */
export function WorkspaceBody({ useSessions, sessionId, t }: WorkspaceBodyProps): ReactNode {
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
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
          <p className={css.pending} data-lcoder-pending="tasks">{t('column.tasks.pending')}</p>
        </section>
        <section className={css.column} data-lcoder-column="spec">
          <h2 className={css.heading}>{t('column.spec')}</h2>
          <p className={css.pending} data-lcoder-pending="spec">{t('column.spec.pending')}</p>
        </section>
        <section className={css.column} data-lcoder-column="conversation">
          <h2 className={css.heading}>{t('column.conversation')}</h2>
          <p className={css.pending} data-lcoder-pending="conversation">{t('column.conversation.pending')}</p>
        </section>
      </div>
    </div>
  )
}
