import { afterEach, expect, it, vi } from 'vitest'
import { desktopWindowBridge } from '../src/client/shell/window-chrome.ts'

afterEach(() => { vi.unstubAllGlobals() })

it('is absent outside the Windows desktop shell', () => {
  expect(desktopWindowBridge()).toBeUndefined()
  vi.stubGlobal('dshDesktop', { protocolVersion: 1 })
  expect(desktopWindowBridge()).toBeUndefined()
})

it('returns the exposed window bridge', () => {
  const bridge = { command: vi.fn(), state: vi.fn(), subscribe: vi.fn() }
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, window: bridge })
  expect(desktopWindowBridge()).toBe(bridge)
})
