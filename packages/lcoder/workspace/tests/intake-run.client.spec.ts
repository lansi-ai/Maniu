/**
 * 思考态沉降窗口的纯判定：窗口内不结束、超时结束、新活动与重新开跑会重置计时，
 * 挂载时已经停下的旧回合不再补一段假思考。
 */
import { describe, expect, it } from 'vitest'
import {
  INTAKE_SETTLE_MS, initialIntakeRunState, nextIntakeRunState,
} from '../src/client/shell/intake-run.ts'

/** 一轮刚结束的起点：此前在跑，现在没有运行、没有问题、活动序号为 3。 */
function stoppedAt(now: number): ReturnType<typeof nextIntakeRunState> {
  const running = initialIntakeRunState({ running: true, questionCount: 0, activity: 3 })
  return nextIntakeRunState(running, { running: false, questionCount: 0, activity: 3 }, now)
}

describe('结束态沉降窗口', () => {
  it('刚停下时仍按思考中展示，窗口内不结束', () => {
    const stopped = stoppedAt(1_000)

    expect(stopped.active).toBe(true)
    expect(stopped.since).toBe(1_000)
    expect(nextIntakeRunState(stopped, { running: false, questionCount: 0, activity: 3 }, 1_000 + INTAKE_SETTLE_MS - 1).active).toBe(true)
  })

  it('持续无运行超过窗口才交回结束态', () => {
    const stopped = stoppedAt(1_000)
    const ended = nextIntakeRunState(stopped, { running: false, questionCount: 0, activity: 3 }, 1_000 + INTAKE_SETTLE_MS)

    expect(ended.active).toBe(false)
    expect(nextIntakeRunState(ended, { running: false, questionCount: 0, activity: 3 }, 9_000).active).toBe(false)
  })

  it('窗口期间出现新消息会重新计时，不提前结束', () => {
    const stopped = stoppedAt(1_000)
    const reset = nextIntakeRunState(stopped, { running: false, questionCount: 0, activity: 4 }, 1_500)

    expect(reset.since).toBe(1_500)
    expect(nextIntakeRunState(reset, { running: false, questionCount: 0, activity: 4 }, 3_000).active).toBe(true)
    expect(nextIntakeRunState(reset, { running: false, questionCount: 0, activity: 4 }, 3_500).active).toBe(false)
  })

  it('running 回升立即回到思考中，并把窗口清掉', () => {
    const stopped = stoppedAt(1_000)
    const resumed = nextIntakeRunState(stopped, { running: true, questionCount: 0, activity: 3 }, 1_400)

    expect(resumed).toEqual({ since: null, activity: 3, active: true })
  })

  it('有待答问题时不算结束', () => {
    const stopped = nextIntakeRunState(
      initialIntakeRunState({ running: false, questionCount: 0, activity: 2 }),
      { running: false, questionCount: 1, activity: 2 },
      2_000,
    )

    expect(stopped).toEqual({ since: null, activity: 2, active: true })
  })

  it('打开时就已停下的旧回合直接是结束态，不补两秒假思考', () => {
    const ended = initialIntakeRunState({ running: false, questionCount: 0, activity: 2 })

    expect(ended).toEqual({ since: null, activity: 2, active: false })
    expect(nextIntakeRunState(ended, { running: false, questionCount: 0, activity: 2 }, 5_000)).toBe(ended)
  })

  it('结束之后又来新活动时重新开窗，先按思考中展示', () => {
    const ended = initialIntakeRunState({ running: false, questionCount: 0, activity: 2 })
    const next = nextIntakeRunState(ended, { running: false, questionCount: 0, activity: 3 }, 6_000)

    expect(next).toEqual({ since: 6_000, activity: 3, active: true })
  })
})
