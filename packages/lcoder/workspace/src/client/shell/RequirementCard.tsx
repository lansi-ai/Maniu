/**
 * 需求确认卡片：需求编号、创建人、创建时间、默认折叠的需求内容与拆分任务。
 *
 * 只画传入的任务与动作；拆分指令由外壳发送，卡片不建会话、不发请求。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShellTask } from './shell-data.ts'
import { formatOpenedAt } from './requirement.ts'
import { useMarkdownLabels } from './ChatPanel.tsx'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 需求卡片要的任务与动作。 */
export interface RequirementCardProps {
  readonly t: Translate
  readonly task: ShellTask
  /** 拆分指令发送在途；按钮据此禁用。 */
  readonly splitting: boolean
  /** 就地错误原文；没有时为 null。 */
  readonly error: string | null
  readonly onClose: () => void
  readonly onSplit: () => void
}

/** 内容折叠时的一行摘要：取正文第一段，过长截断。 */
function previewOf(description: string): string {
  const line = description.trim().split(/\r?\n/u, 1)[0]?.trim() ?? ''
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}

/**
 * 画一张需求卡片。
 * @param props - 任务、在途与错误、关闭与拆分动作。
 * @returns 卡片内容；由外壳放在既有模态容器里。
 */
export function RequirementCard({
  t, task, splitting, error, onClose, onSplit,
}: RequirementCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const labels = useMarkdownLabels(t)
  const preview = previewOf(task.description)
  const createdAt = formatOpenedAt(task.openedAt)
  return (
    <div className={css.requirementCard} data-requirement-card>
      <div className={css.modalHead}>
        <div className={css.grow}>
          <h3 className={css.requirementTitle} data-requirement-title>
            {t('shell.requirementHeading', { id: task.id, title: task.title })}
          </h3>
        </div>
        <span className={css.pill}>{t('shell.drafting')}</span>
        <button type="button" className={css.iconBtn} onClick={onClose}>✕</button>
      </div>
      <div className={css.modalBody}>
        <dl className={css.requirementMeta}>
          <div className={css.requirementMetaItem}>
            <dt className={css.metaK}>{t('shell.requirementCreatorLabel')}</dt>
            <dd className={css.metaV}>{t('shell.requirementCreator')}</dd>
          </div>
          <div className={css.requirementMetaItem}>
            <dt className={css.metaK}>{t('shell.requirementCreatedLabel')}</dt>
            <dd className={css.metaV}>{createdAt === '' ? '—' : createdAt}</dd>
          </div>
        </dl>
        <section className={css.requirementContent}>
          <div className={css.requirementContentHead}>
            <span className={css.requirementContentTitle}>{t('shell.requirementContent')}</span>
            <button
              type="button"
              className={css.requirementMore}
              aria-expanded={open}
              onClick={() => { setOpen(value => !value) }}
            >
              {open ? t('shell.requirementShowLess') : t('shell.requirementShowMore')}
            </button>
          </div>
          {open ? (
            <div className={css.requirementBody} data-requirement-body>
              <MarkdownText text={task.description} labels={labels} />
              <p className={css.requirementMetaLine}>
                {t('shell.difficulty')}：{task.grade}
                {' · '}
                {t('shell.rules')}：{task.rules.join('、') || '—'}
              </p>
            </div>
          ) : (
            <p className={css.requirementPreview} data-requirement-preview>{preview || t('shell.noDescription')}</p>
          )}
        </section>
        {error === null ? null : <p className={css.problem}>{error}</p>}
      </div>
      <div className={css.modalFoot}>
        <div className={css.spacer} />
        <button type="button" className={css.secondaryBtn} onClick={onClose}>
          {t('shell.close')}
        </button>
        <button
          type="button"
          className={css.primaryBtn}
          data-requirement-split
          disabled={splitting}
          onClick={onSplit}
        >
          {splitting ? t('shell.splittingTasks') : t('shell.splitTasks')}
        </button>
      </div>
    </div>
  )
}
