/**
 * 交付物区：任务详情的「交付物」与需求详情的按任务汇总共用这一份排版。
 *
 * 普通任务没有交付索引时不画这一块；必须交付却缺失时只给一句可执行的提示，
 * 并把目标路径写出来——「没交」不能停在状态上，要让人知道下一步写哪里。
 */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShellDeliverable } from './shell-data.ts'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

/** 交付物区的 props。 */
export interface DeliverableViewProps {
  readonly t: Translate
  /** 这条任务编号；缺失提示按它拼目标路径。 */
  readonly taskId: string
  /** 投影里读到的交付索引；没登记时缺省。 */
  readonly deliverable?: ShellDeliverable
  /** 是否属于「必须交付」；普通任务缺索引时整块不画。 */
  readonly required: boolean
  /** 点文档路径时的预览回调；不给就只显示路径文本。 */
  readonly onOpenDoc?: (doc: string) => void
  /** 需求详情里把任务编号做成跳转按钮；任务详情不传。 */
  readonly onOpenTask?: (taskId: string) => void
  /** 是否画区块标题；需求详情在外层统一给标题时传 false。 */
  readonly showHeading?: boolean
}

/**
 * 画一条任务的交付物。
 * @param props - 词典、任务编号、索引、是否必须交付与两个打开回调。
 * @returns 交付物区块；普通任务且没有索引时为 null。
 */
export function DeliverableView({
  t, taskId, deliverable, required, onOpenDoc, onOpenTask, showHeading = true,
}: DeliverableViewProps): ReactNode {
  if (deliverable === undefined && !required) return null

  return (
    <section className={css.deliverableSection} data-deliverable-section={taskId}>
      <div className={css.deliverableHead}>
        {showHeading ? <h4>{t('shell.deliverableTitle')}</h4> : null}
        {onOpenTask === undefined ? (
          <span className={css.flowTaskId}>{taskId}</span>
        ) : (
          <button
            type="button"
            className={css.requirementTaskOpen}
            data-deliverable-task-link={taskId}
            onClick={() => { onOpenTask(taskId) }}
          >
            <span className={css.requirementTaskId}>{taskId}</span>
          </button>
        )}
      </div>
      {deliverable === undefined ? (
        <p className={css.problem} data-deliverable-missing>
          {fill(t('shell.deliverableMissing'), { path: `.spec/deliverables/${taskId}.yaml` })}
        </p>
      ) : (
        <>
          <p className={css.deliverableSummary} data-deliverable-summary>{deliverable.summary}</p>
          <ul className={css.deliverableList} data-deliverable-docs>
            {deliverable.docs.map(doc => (
              <li key={doc} className={css.deliverableRow}>
                <span className={css.deliverableLabel}>{t('shell.deliverableDocs')}</span>
                {onOpenDoc === undefined
                  ? <code className={css.deliverablePath} data-deliverable-doc={doc}>{doc}</code>
                  : (
                    <button
                      type="button"
                      className={css.deliverableDoc}
                      data-deliverable-doc={doc}
                      onClick={() => { onOpenDoc(doc) }}
                    >
                      {doc}
                    </button>
                  )}
              </li>
            ))}
          </ul>
          {deliverable.commands.length === 0 ? null : (
            <ul className={css.deliverableList} data-deliverable-commands>
              {deliverable.commands.map(command => (
                <li key={command} className={css.deliverableRow}>
                  <span className={css.deliverableLabel}>{t('shell.deliverableCommands')}</span>
                  <code className={css.deliverablePath}>{command}</code>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
