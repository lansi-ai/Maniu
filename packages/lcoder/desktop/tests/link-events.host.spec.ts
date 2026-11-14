/** `$events` 帧的解析：waterfall 用连接代际回执，撤回只带事件标识。 */
import { describe, expect, it } from 'vitest'
import { waterfallCancelOf, waterfallOf } from '../src/link.ts'

describe('waterfallOf', () => {
  it('用 ready 帧的代际补齐 waterfall 回执身份', () => {
    expect(waterfallOf({
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'e-1',
      agentId: 'agent-1',
      request: { toolName: 'cmd_run' },
    }, 'client-9')).toEqual({
      name: 'approval/request',
      clientId: 'client-9',
      eventId: 'e-1',
      request: { toolName: 'cmd_run' },
    })
  })

  it('拿不到代际时不发事件，免得回执挂在一个不存在的连接上', () => {
    expect(waterfallOf({
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'e-1',
      request: {},
    }, undefined)).toBeUndefined()
  })

  it('只转发白名单里的两种 waterfall', () => {
    expect(waterfallOf({ type: 'waterfall', event: 'plugin-manager/changed', eventId: 'e-1', request: {} }, 'c'))
      .toBeUndefined()
    expect(waterfallOf({ type: 'waterfall', event: 'user-questions/request', eventId: 'e-2', request: { questions: [] } }, 'c'))
      .toMatchObject({ name: 'user-questions/request', eventId: 'e-2' })
  })

  it('形状不完整时拒绝', () => {
    expect(waterfallOf({ type: 'waterfall', event: 'approval/request' }, 'c')).toBeUndefined()
    expect(waterfallOf({ type: 'waterfall', event: 'approval/request', eventId: 'e', request: 'x' }, 'c')).toBeUndefined()
    expect(waterfallOf({ type: 'emit' }, 'c')).toBeUndefined()
    expect(waterfallOf('nope', 'c')).toBeUndefined()
  })
})

describe('waterfallCancelOf', () => {
  it('撤回只需要事件标识', () => {
    expect(waterfallCancelOf({ type: 'cancel', eventId: 'e-1' })).toEqual({ eventId: 'e-1' })
  })

  it('其他帧不当作撤回', () => {
    expect(waterfallCancelOf({ type: 'cancel' })).toBeUndefined()
    expect(waterfallCancelOf({ type: 'emit', eventId: 'e-1' })).toBeUndefined()
    expect(waterfallCancelOf(null)).toBeUndefined()
  })
})
