/**
 * LCoder client 测试的最小 jsdom polyfill。
 *
 * HeroUI / React Aria 组件在 jsdom 中需要这两个浏览器 API；
 * 只补缺失的实现，不改任何组件行为。
 */

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverStub,
  })
}

if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => []
}
