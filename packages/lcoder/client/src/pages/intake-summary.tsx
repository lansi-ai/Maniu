/** 立项概要就地预览：读会话最后一条助手正文，底部确认落盘或回对话修改，不切页。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@heroui/react'
import { translate, type Translate } from '../locale.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import { readLastAssistantText } from '../intake/summary.ts'
import { DetailDrawer } from './detail-drawer.tsx'

/** 工作台页面尚未接入词典，未传取词函数时沿用中文。 */
const zhText: Translate = (key, params) => translate('zh', key, params)

/** 概要正文的读取状态；加载与空态分开，避免把读不到当成空文档。 */
interface SummaryRead {
  readonly status: 'loading' | 'ready' | 'empty'
  readonly text: string
}

/** 立项概要就地预览属性。 */
export interface IntakeSummaryProps {
  readonly sessionId: string
  readonly onConfirm: () => void
  readonly onOpenSession: () => void
  readonly onClose: () => void
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
}

/**
 * 在需求页内展示立项会话最后一条助手回复，并就地确认或回对话修改。
 * @param props - 会话号、三个动作回调与取词函数。
 * @returns 概要抽屉。
 */
export function IntakeSummary(props: IntakeSummaryProps): JSX.Element {
  const t = props.t ?? zhText
  const [read, setRead] = useState<SummaryRead>({ status: 'loading', text: '' })

  useEffect(() => {
    let live = true
    setRead({ status: 'loading', text: '' })
    void readLastAssistantText(props.sessionId).then((text) => {
      if (!live) return
      setRead(text === null ? { status: 'empty', text: '' } : { status: 'ready', text })
    })
    return () => { live = false }
  }, [props.sessionId])

  return (
    <DetailDrawer
      testId="intake-summary"
      closeTestId="intake-summary-close"
      onClose={props.onClose}
      head={<h3>{t('intake.summaryTitle')}</h3>}
      t={t}
    >
      {read.status === 'loading' && <p className="detail-note" data-testid="intake-summary-loading">{t('intake.summaryLoading')}</p>}
      {read.status === 'empty' && <p className="empty" data-testid="intake-summary-empty">{t('intake.summaryEmpty')}</p>}
      {read.status === 'ready' && (
        <div className="markdown-body tall" data-testid="intake-summary-body">{renderMarkdown(read.text)}</div>
      )}
      <div className="action-row">
        <Button variant="primary" data-testid="intake-summary-confirm" onPress={props.onConfirm}>
          {t('intake.summaryConfirm')}
        </Button>
        <Button variant="secondary" data-testid="intake-summary-edit" onPress={props.onOpenSession}>
          {t('intake.summaryEdit')}
        </Button>
      </div>
    </DetailDrawer>
  )
}
