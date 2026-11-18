/** Initial resize delivery from jsdom's modeled offsets; geometry/timing suites supply their own observers. */
import { afterAll, beforeEach } from 'vitest'

const original = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
let installed = false

// React Aria's SelectionIndicator (Tabs.Indicator) queries element animations on
// selection change; jsdom has no Web Animations implementation.
const originalGetAnimations = typeof Element === 'undefined'
  ? undefined
  : Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
let installedGetAnimations = false

class TestResizeObserver implements ResizeObserver {
  private readonly targets = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    if (this.targets.has(target)) return
    this.targets.add(target)
    const width = target instanceof HTMLElement ? target.offsetWidth : 0
    const height = target instanceof HTMLElement ? target.offsetHeight : 0
    const size = [{ inlineSize: width, blockSize: height }]
    this.callback([{
      target, contentRect: new DOMRectReadOnly(0, 0, width, height),
      borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size,
    }], this)
  }

  unobserve(target: Element): void { this.targets.delete(target) }

  disconnect(): void { this.targets.clear() }
}

beforeEach(() => {
  if (typeof document !== 'undefined' && typeof ResizeObserver === 'undefined') {
    // Establish the per-environment default, so vi.unstubAllGlobals restores it.
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: TestResizeObserver })
    installed = true
  }
  if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, writable: true, value: () => [] })
    installedGetAnimations = true
  }
})

afterAll(() => {
  if (installed) {
    if (original === undefined) Reflect.deleteProperty(globalThis, 'ResizeObserver')
    else Object.defineProperty(globalThis, 'ResizeObserver', original)
  }
  if (installedGetAnimations) {
    if (originalGetAnimations === undefined) Reflect.deleteProperty(Element.prototype, 'getAnimations')
    else Object.defineProperty(Element.prototype, 'getAnimations', originalGetAnimations)
  }
})
