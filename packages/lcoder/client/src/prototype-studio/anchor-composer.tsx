/**
 * 协作流输入区：点选锚点胶囊、交互/点选切换与修改指令发送。
 * 只经宿主桥接读写画布状态，不直接操作任何文件。
 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@heroui/react'
import type { Translate } from '../locale.ts'
import type { StudioBridge, StudioInteractionMode, StudioSelectionInfo } from './bridge.ts'

/** 点选锚点与该元素的专属修改要求；note 为空表示没为这一项单独指定。 */
export interface StudioAnchorDraft extends StudioSelectionInfo {
  readonly note?: string
}

/** 输入区属性。 */
export interface AnchorComposerProps {
  readonly t: Translate
  readonly bridge?: StudioBridge | undefined
  /** 正在跑模型回合时锁住发送，避免同一轮重复提交。 */
  readonly running: boolean
  /** 发送一轮修改意见；返回 true 表示已被会话接受，此时清空全局意见、锚点与各自的要求。 */
  readonly onSend: (instruction: string, anchors: readonly StudioAnchorDraft[]) => Promise<boolean>
}

/**
 * 按 DOM 路径去重追加点选锚点；同一元素重复点选保留首次的快照。
 * @param current - 现有锚点。
 * @param incoming - 新上报的元素。
 * @returns 追加后的锚点列表。
 */
export function appendAnchor(
  current: readonly StudioAnchorDraft[],
  incoming: StudioSelectionInfo,
): readonly StudioAnchorDraft[] {
  if (current.some(anchor => anchor.domPath === incoming.domPath)) return current
  return [...current, incoming]
}

/**
 * 画协作流输入区。
 * @param props - 词典、宿主桥与发送回调。
 * @returns 输入区。
 */
export function AnchorComposer(props: AnchorComposerProps): JSX.Element {
  const { t, bridge, running } = props
  const [anchors, setAnchors] = useState<readonly StudioAnchorDraft[]>([])
  const [interaction, setInteraction] = useState<StudioInteractionMode>('interact')
  const [instruction, setInstruction] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const unsubscribe = bridge?.onPrototypeSelection?.((info) => {
      setAnchors(current => appendAnchor(current, info))
    })
    return () => { unsubscribe?.() }
  }, [bridge])

  const switchInteraction = (mode: StudioInteractionMode): void => {
    if (interaction === mode) return
    setInteraction(mode)
    void Promise.resolve(bridge?.setPrototypeStudioInteraction?.(mode)).catch(() => undefined)
  }

  /** 只改一个锚点的专属要求；其它锚点的输入保持原样。 */
  const setAnchorNote = (domPath: string, note: string): void => {
    setAnchors(current => current.map(anchor => (anchor.domPath === domPath ? { ...anchor, note } : anchor)))
  }

  const anchorNotes = anchors.filter(anchor => (anchor.note ?? '').trim() !== '')
  const canSend = instruction.trim() !== '' || anchorNotes.length > 0

  const send = async (): Promise<void> => {
    if (!canSend || running || sending) return
    setSending(true)
    try {
      const accepted = await props.onSend(instruction.trim(), anchors)
      if (!accepted) return
      setInstruction('')
      setAnchors([])
    } finally {
      setSending(false)
    }
  }

  const busy = running || sending

  return (
    <section className="studio-composer" data-testid="studio-anchor-composer">
      <div className="studio-interaction-bar" data-testid="studio-interaction-toggle" role="group" aria-label={t('studio.interactionMode')}>
        <button
          type="button"
          className={interaction === 'interact' ? 'studio-segment studio-segment-on' : 'studio-segment'}
          data-testid="studio-interaction-interact"
          aria-pressed={interaction === 'interact'}
          onClick={() => { switchInteraction('interact') }}
        >
          {t('studio.interactMode')}
        </button>
        <button
          type="button"
          className={interaction === 'select' ? 'studio-segment studio-segment-on' : 'studio-segment'}
          data-testid="studio-interaction-select"
          aria-pressed={interaction === 'select'}
          onClick={() => { switchInteraction('select') }}
        >
          {t('studio.selectMode')}
        </button>
      </div>

      <div className="studio-anchor-list" data-testid="studio-anchor-list">
        {anchors.length === 0
          ? <span className="studio-empty">{t('studio.anchorEmpty')}</span>
          : (
            <>
              {anchors.map((anchor, index) => (
                <div key={anchor.domPath} className="studio-anchor-item" data-dom-path={anchor.domPath}>
                  <span className="studio-anchor-chip" data-testid="studio-anchor-chip" data-dom-path={anchor.domPath}>
                    <span className="studio-anchor-index">{`#${String(index + 1)}`}</span>
                    <span className="studio-anchor-name">
                      {t('studio.anchorChip', { label: anchor.label === undefined || anchor.label === '' ? anchor.domPath : anchor.label })}
                    </span>
                  </span>
                  <input
                    className="studio-anchor-note"
                    data-testid="studio-anchor-note"
                    data-dom-path={anchor.domPath}
                    value={anchor.note ?? ''}
                    placeholder={t('studio.anchorNotePlaceholder')}
                    aria-label={t('studio.anchorNotePlaceholder')}
                    onChange={(event) => { setAnchorNote(anchor.domPath, event.target.value) }}
                  />
                  <button
                    type="button"
                    className="studio-anchor-remove"
                    data-testid="studio-anchor-remove"
                    aria-label={t('studio.removeAnchor')}
                    onClick={() => { setAnchors(current => current.filter(item => item.domPath !== anchor.domPath)) }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <Button size="sm" variant="ghost" data-testid="studio-anchors-clear" onPress={() => { setAnchors([]) }}>
                {t('studio.clearAnchors')}
              </Button>
            </>
          )}
      </div>

      <div className="studio-instruction-row">
        <input
          className="studio-instruction-input"
          data-testid="studio-instruction-input"
          value={instruction}
          placeholder={anchors.length === 0 ? t('studio.instructionPlaceholder') : t('studio.instructionPlaceholderSupplement')}
          aria-label={anchors.length === 0 ? t('studio.instructionPlaceholder') : t('studio.instructionPlaceholderSupplement')}
          onChange={(event) => { setInstruction(event.target.value) }}
        />
        <Button
          size="sm"
          variant="primary"
          data-testid="studio-send-instruction"
          isDisabled={busy || !canSend}
          onPress={() => { void send() }}
        >
          {sending ? t('studio.sending') : t('studio.sendInstruction')}
        </Button>
      </div>
    </section>
  )
}
