/**
 * 协作流输入区：点选锚点胶囊、交互/点选切换与修改指令发送。
 * 只经宿主桥接读写画布状态，不直接操作任何文件。
 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@heroui/react'
import type { Translate } from '../locale.ts'
import type { StudioBridge, StudioInteractionMode, StudioSelectionInfo } from './bridge.ts'

/** 输入区属性。 */
export interface AnchorComposerProps {
  readonly t: Translate
  readonly bridge?: StudioBridge | undefined
  /** 正在跑模型回合时锁住发送，避免同一轮重复提交。 */
  readonly running: boolean
  /** 发送一轮修改意见；返回 true 表示已被会话接受，此时清空文本与已消费锚点。 */
  readonly onSend: (instruction: string, anchors: readonly StudioSelectionInfo[]) => Promise<boolean>
}

/**
 * 按 DOM 路径去重追加点选锚点；同一元素重复点选保留首次的快照。
 * @param current - 现有锚点。
 * @param incoming - 新上报的元素。
 * @returns 追加后的锚点列表。
 */
export function appendAnchor(
  current: readonly StudioSelectionInfo[],
  incoming: StudioSelectionInfo,
): readonly StudioSelectionInfo[] {
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
  const [anchors, setAnchors] = useState<readonly StudioSelectionInfo[]>([])
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

  const send = async (): Promise<void> => {
    const text = instruction.trim()
    if (text === '' || running || sending) return
    setSending(true)
    try {
      const accepted = await props.onSend(text, anchors)
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
              {anchors.map(anchor => (
                <span key={anchor.domPath} className="studio-anchor-chip" data-testid="studio-anchor-chip" data-dom-path={anchor.domPath}>
                  <span>{t('studio.anchorChip', { label: anchor.label === undefined || anchor.label === '' ? anchor.domPath : anchor.label })}</span>
                  <button
                    type="button"
                    className="studio-anchor-remove"
                    data-testid="studio-anchor-remove"
                    aria-label={t('studio.removeAnchor')}
                    onClick={() => { setAnchors(current => current.filter(item => item.domPath !== anchor.domPath)) }}
                  >
                    ×
                  </button>
                </span>
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
          placeholder={t('studio.instructionPlaceholder')}
          aria-label={t('studio.instructionPlaceholder')}
          onChange={(event) => { setInstruction(event.target.value) }}
        />
        <Button
          size="sm"
          variant="primary"
          data-testid="studio-send-instruction"
          isDisabled={busy || instruction.trim() === ''}
          onPress={() => { void send() }}
        >
          {sending ? t('studio.sending') : t('studio.sendInstruction')}
        </Button>
      </div>
    </section>
  )
}
