/**
 * 需求页：表格与状态看板两种视图，共用一套筛选与九态分组。
 *
 * 页面只画传入的展示行，不发请求、不判断状态；进度由 `requirement-page.ts`
 * 调用 kernel 的派生函数算出。新建需求打开既有立项向导，点一行交给外壳打开详情抽屉。
 */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementProgressId } from '@lcoder/kernel/src/schema/requirement-progress.ts'
import type { RequirementFilter, RequirementViewRow } from './requirement-page.ts'
import {
  REQUIREMENT_BOARD_COLUMNS, REQUIREMENT_PROGRESS_LABEL, isRequirementFilterActive,
} from './requirement-page.ts'
import { formatOpenedAt } from './requirement.ts'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 需求页的两种视图；由外壳记住，切菜单回来仍是上次那一种。 */
export type RequirementView = 'table' | 'board'

/** 需求页 props：展示行、筛选、视图与两个动作。 */
export interface RequirementsPageProps {
  readonly t: Translate
  readonly views: readonly RequirementViewRow[]
  readonly view: RequirementView
  readonly filter: RequirementFilter
  readonly showCancelled: boolean
  /** 没有工作区或会话时如实空态，不给新建入口。 */
  readonly workspaceReady: boolean
  readonly loading: boolean
  readonly onViewChange: (view: RequirementView) => void
  readonly onFilterChange: (filter: RequirementFilter) => void
  readonly onToggleCancelled: () => void
  readonly onCreate: () => void
  readonly onOpen: (id: string) => void
}

/** 状态筛选的九态顺序：看板八列加已取消。 */
const FILTER_STATES: readonly RequirementProgressId[] = [...REQUIREMENT_BOARD_COLUMNS, 'cancelled']

/**
 * 一条需求在一行/一张卡上的公共标签。
 * @param t - 词典。
 * @param view - 展示行。
 * @returns 编号、标题与任务数。
 */
function taskCountText(t: Translate, view: RequirementViewRow): string {
  return t('shell.requirementTaskCount', { count: `${view.tasks.length}` })
}

/**
 * 画需求页。
 * @param props - 展示行、筛选、视图与动作。
 * @returns 工具栏、筛选面板与表格或看板。
 */
export function RequirementsPage({
  t, views, view, filter, showCancelled, workspaceReady, loading,
  onViewChange, onFilterChange, onToggleCancelled, onCreate, onOpen,
}: RequirementsPageProps): ReactNode {
  const toggleState = (id: RequirementProgressId): void => {
    onFilterChange({
      ...filter,
      states: filter.states.includes(id) ? filter.states.filter(item => item !== id) : [...filter.states, id],
    })
  }
  return (
    <div className={css.requirementsPage} data-lcoder-requirements>
      <div className={css.boardHead}>
        <h3>{t('shell.requirements')}</h3>
        <span className={css.boardHint}>{t('shell.requirementsHint')}</span>
        <div className={css.boardActions}>
          <div className={css.viewSwitch} role="group" aria-label={t('shell.requirementView')}>
            <button
              type="button"
              className={`${css.filterChip} ${view === 'table' ? css.filterChipActive : ''}`}
              data-requirement-view="table"
              aria-pressed={view === 'table'}
              onClick={() => { onViewChange('table') }}
            >
              {t('shell.requirementViewTable')}
            </button>
            <button
              type="button"
              className={`${css.filterChip} ${view === 'board' ? css.filterChipActive : ''}`}
              data-requirement-view="board"
              aria-pressed={view === 'board'}
              onClick={() => { onViewChange('board') }}
            >
              {t('shell.requirementViewBoard')}
            </button>
          </div>
          <button
            type="button"
            className={css.primaryBtn}
            data-requirement-create
            disabled={!workspaceReady}
            onClick={onCreate}
          >
            {t('shell.newRequirement')}
          </button>
        </div>
      </div>

      <div className={css.filterPanel} data-requirement-filters>
        <span className={css.filterLabel}>{t('shell.filterState')}</span>
        {FILTER_STATES.map(id => (
          <button
            type="button"
            key={id}
            className={`${css.filterChip} ${filter.states.includes(id) ? css.filterChipActive : ''}`}
            data-requirement-filter={id}
            aria-pressed={filter.states.includes(id)}
            onClick={() => { toggleState(id) }}
          >
            {t(REQUIREMENT_PROGRESS_LABEL[id])}
          </button>
        ))}
        <button
          type="button"
          className={`${css.filterChip} ${showCancelled ? css.filterChipActive : ''}`}
          data-requirement-show-cancelled
          aria-pressed={showCancelled}
          onClick={onToggleCancelled}
        >
          {t('shell.requirementShowCancelled')}
        </button>
        <input
          className={css.filterSearch}
          type="search"
          value={filter.text}
          placeholder={t('shell.requirementSearch')}
          aria-label={t('shell.requirementSearch')}
          onChange={(event): void => { onFilterChange({ ...filter, text: event.target.value }) }}
        />
        {isRequirementFilterActive(filter)
          ? (
            <button
              type="button"
              className={css.filterClear}
              data-requirement-filter-clear
              onClick={() => { onFilterChange({ text: '', states: [] }) }}
            >
              {t('shell.filterClear')}
            </button>
          )
          : null}
      </div>

      {!workspaceReady
        ? <p className={css.empty}>{t('shell.noWorkspace')}</p>
        : loading
          ? <p className={css.empty}>{t('shell.loading')}</p>
          : views.length === 0
            ? (
              <div className={css.onboardingBar} data-requirement-empty>
                <span className={css.boardHint}>{t('shell.requirementEmpty')}</span>
                <button type="button" className={css.secondaryBtn} onClick={onCreate}>
                  {t('shell.newRequirement')}
                </button>
              </div>
            )
            : view === 'table'
              ? (
                <div className={css.reqTableWrap}>
                  <table className={css.reqTable}>
                    <thead>
                      <tr>
                        <th scope="col">{t('shell.requirementNo')}</th>
                        <th scope="col">{t('shell.requirementTitle')}</th>
                        <th scope="col">{t('shell.requirementState')}</th>
                        <th scope="col">{t('shell.requirementTaskCountHeader')}</th>
                        <th scope="col">{t('shell.requirementUpdatedAt')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {views.map((item) => {
                        const updatedAt = formatOpenedAt(item.updatedAt)
                        return (
                          <tr
                            key={item.row.id}
                            className={css.reqRow}
                            data-requirement-row={item.row.id}
                            tabIndex={0}
                            role="button"
                            onClick={() => { onOpen(item.row.id) }}
                            onKeyDown={(event): void => {
                              if (event.key !== 'Enter' && event.key !== ' ') return
                              event.preventDefault()
                              onOpen(item.row.id)
                            }}
                          >
                            <td className={css.reqNo}>{item.row.id}</td>
                            <td className={css.reqTitleCell}>{item.row.title ?? t('shell.requirementUntitled')}</td>
                            <td>
                              <span className={css.tag} data-requirement-state={item.progress}>
                                {t(REQUIREMENT_PROGRESS_LABEL[item.progress])}
                              </span>
                            </td>
                            <td className={css.reqCount}>{taskCountText(t, item)}</td>
                            <td className={css.reqTime}>{updatedAt === '' ? '—' : updatedAt}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
              : (
                <div className={css.requirementBoard} data-requirement-board>
                  {REQUIREMENT_BOARD_COLUMNS.map((column) => {
                    const rows = views.filter(item => item.progress === column)
                    return (
                      <div key={column} className={css.column} data-requirement-column={column}>
                        <div className={css.columnHead}>
                          <span className={css.columnName}>{t(REQUIREMENT_PROGRESS_LABEL[column])}</span>
                          <span className={css.count}>{rows.length}</span>
                        </div>
                        {rows.length === 0
                          ? <div className={css.empty}>{t('shell.empty')}</div>
                          : rows.map(item => (
                            <button
                              type="button"
                              key={item.row.id}
                              className={css.taskCard}
                              data-requirement-card={item.row.id}
                              onClick={() => { onOpen(item.row.id) }}
                            >
                              <div className={css.taskId}><span>{item.row.id}</span></div>
                              <div className={css.taskTitle}>{item.row.title ?? t('shell.requirementUntitled')}</div>
                              <div className={css.tags}>
                                <span className={css.tag}>{taskCountText(t, item)}</span>
                                {item.updatedAt === undefined
                                  ? null
                                  : <span className={css.tag}>{formatOpenedAt(item.updatedAt)}</span>}
                              </div>
                            </button>
                          ))}
                      </div>
                    )
                  })}
                  {showCancelled
                    ? (
                      <div className={css.column} data-requirement-column="cancelled">
                        <div className={css.columnHead}>
                          <span className={css.columnName}>{t(REQUIREMENT_PROGRESS_LABEL.cancelled)}</span>
                          <span className={css.count}>{views.filter(item => item.progress === 'cancelled').length}</span>
                        </div>
                        {views.filter(item => item.progress === 'cancelled').map(item => (
                          <button
                            type="button"
                            key={item.row.id}
                            className={css.taskCard}
                            data-requirement-card={item.row.id}
                            onClick={() => { onOpen(item.row.id) }}
                          >
                            <div className={css.taskId}><span>{item.row.id}</span></div>
                            <div className={css.taskTitle}>{item.row.title ?? t('shell.requirementUntitled')}</div>
                            <div className={css.tags}>
                              <span className={css.tag}>{taskCountText(t, item)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )
                    : null}
                </div>
              )}
    </div>
  )
}
