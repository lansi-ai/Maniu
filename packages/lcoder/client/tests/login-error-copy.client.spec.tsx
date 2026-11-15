// @vitest-environment jsdom
/** 登录页报错文案按页签区分；协议勾选盒是可交互的真实控件。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginScreen } from '../src/account/login-screen.tsx'
import { translate, type Translate } from '../src/locale.ts'

const t: Translate = (key, params) => translate('zh', key, params)

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  // cloudFace 走 window.lcoder.call：固定回 invalid_credentials，并带请求号。
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(async () => ({
        ok: true,
        value: { ok: false, error: { code: 'invalid_credentials', message: '手机号或密码错误。', requestId: 'mock_abc' } },
      })),
    },
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

function element(testId: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  expect(node).not.toBeNull()
  return node as HTMLElement
}

/** 受控输入要走原生 setter，否则 React 的 onChange 不会触发。 */
async function typeInto(testId: string, value: string): Promise<void> {
  const input = element(testId) as HTMLInputElement
  // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function press(testId: string): Promise<void> {
  const node = element(testId)
  await act(async () => {
    node.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(<LoginScreen t={t} onAuthenticated={() => undefined} />)
  })
}

describe('登录页报错文案', () => {
  it('短信页签的凭据错误按验证码问题提示', async () => {
    await render()
    await typeInto('login-phone', '13800000001')
    await typeInto('login-code', '123456')
    await press('login-submit')
    expect(element('login-error').querySelector('strong')?.textContent).toBe(t('login.errorCode'))
    expect(element('login-error').textContent).toContain('mock_abc')
  })

  it('密码页签的凭据错误仍提示手机号或密码不正确', async () => {
    await render()
    await press('login-tab-password')
    await typeInto('login-phone', '13800000002')
    await typeInto('login-password', 'wrongpass1')
    await press('login-submit')
    expect(element('login-error').querySelector('strong')?.textContent).toBe(t('login.errorCredentials'))
  })

  it('注册页签的凭据错误按验证码问题提示', async () => {
    await render()
    await press('login-tab-register')
    await typeInto('login-phone', '13800000003')
    await typeInto('login-code', '123456')
    await typeInto('login-new-password', 'lcoder-m3-pass')
    await press('login-submit')
    expect(element('login-error').querySelector('strong')?.textContent).toBe(t('login.errorCode'))
  })
})

describe('协议勾选盒', () => {
  it('默认未勾选，点击可反复切换', async () => {
    await render()
    const box = element('login-agree') as HTMLInputElement
    expect(box.checked).toBe(false)
    await press('login-agree')
    expect((element('login-agree') as HTMLInputElement).checked).toBe(true)
    await press('login-agree')
    expect((element('login-agree') as HTMLInputElement).checked).toBe(false)
  })
})
