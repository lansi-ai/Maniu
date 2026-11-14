// @vitest-environment jsdom
/**
 * Markdown 阅读器：全屏层、缩放、拖动平移、键盘与三态。
 *
 * 阅读器只吃调用方读好的文档；这里用真实 MarkdownText 渲染正文，断言用户看得见的结构。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { MarkdownReader } from '../src/client/shell/MarkdownReader.tsx'
import type { MarkdownReaderDoc } from '../src/client/shell/MarkdownReader.tsx'

afterEach(cleanup)

const t = makeTranslate(zh)

function docOf(overrides: Partial<MarkdownReaderDoc> = {}): MarkdownReaderDoc {
  return { path: 'README.md', status: 'ready', text: '# 项目说明\n\n这是基础框架。', ...overrides }
}

function zoomText(): string | null | undefined {
  return document.querySelector('[data-reader-zoom]')?.textContent
}

function scrollEl(): HTMLElement {
  return document.querySelector('[data-reader-scroll]') as HTMLElement
}

describe('阅读器的正文', () => {
  it('打开即聚焦阅读层，标题与表格按 Markdown 渲染', () => {
    const text = [
      '# 项目说明',
      '',
      '第一段正文。',
      '',
      '| 名称 | 值 |',
      '| --- | --- |',
      '| 甲 | 1 |',
    ].join('\n')
    render(<MarkdownReader t={t} doc={docOf({ text })} onClose={vi.fn()} />)

    const layer = document.querySelector('[data-markdown-reader]')
    expect(layer?.getAttribute('data-reader-path')).toBe('README.md')
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'README.md' }))

    const body = document.querySelector('[data-reader-doc]')
    expect(body?.querySelector('h1')?.textContent).toBe('项目说明')
    expect(body?.querySelector('table')?.textContent).toContain('甲')
    expect(document.querySelector('[data-reader-path-text]')?.textContent).toBe('README.md')
  })

  it('加载中、失败与空正文三态如实显示', () => {
    render(<MarkdownReader t={t} doc={docOf({ status: 'loading', text: '' })} onClose={vi.fn()} />)
    expect(document.querySelector('[data-reader-loading]')?.textContent).toBe(zh['shell.deliverableDocLoading'])
    expect(document.querySelector('[data-reader-doc]')).toBeNull()

    cleanup()
    render(<MarkdownReader t={t} doc={docOf({ status: 'failed', text: 'ENOENT: 读不到' })} onClose={vi.fn()} />)
    expect(document.querySelector('[data-reader-failed]')?.textContent).toBe('ENOENT: 读不到')

    cleanup()
    render(<MarkdownReader t={t} doc={docOf({ text: '  \n ' })} onClose={vi.fn()} />)
    expect(document.querySelector('[data-reader-empty]')?.textContent).toBe(zh['shell.readerEmpty'])
    expect(document.querySelector('[data-reader-doc]')).toBeNull()
  })

  it('关闭按钮交回调用方', () => {
    const onClose = vi.fn()
    render(<MarkdownReader t={t} doc={docOf()} onClose={onClose} />)

    fireEvent.click(document.querySelector('[data-reader-close]') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('阅读器的缩放', () => {
  it('加减与重置按 10% 步进，边界停在 50% 与 200%', () => {
    render(<MarkdownReader t={t} doc={docOf()} onClose={vi.fn()} />)
    const zoomIn = document.querySelector('[data-reader-zoom-in]') as HTMLElement
    const zoomOut = document.querySelector('[data-reader-zoom-out]') as HTMLElement

    expect(zoomText()).toBe('100%')
    fireEvent.click(zoomIn)
    expect(zoomText()).toBe('110%')
    fireEvent.click(zoomIn)
    fireEvent.click(zoomIn)
    expect(zoomText()).toBe('130%')
    fireEvent.click(zoomOut)
    expect(zoomText()).toBe('120%')

    for (let index = 0; index < 10; index += 1) fireEvent.click(zoomOut)
    expect(zoomText()).toBe('50%')
    expect((zoomOut as HTMLButtonElement).disabled).toBe(true)

    for (let index = 0; index < 20; index += 1) fireEvent.click(zoomIn)
    expect(zoomText()).toBe('200%')
    expect((zoomIn as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(document.querySelector('[data-reader-zoom-reset]') as HTMLElement)
    expect(zoomText()).toBe('100%')
  })

  it('Ctrl 或 Command 加滚轮缩放，普通滚轮不缩放', () => {
    render(<MarkdownReader t={t} doc={docOf()} onClose={vi.fn()} />)
    const viewport = scrollEl()

    fireEvent.wheel(viewport, { deltaY: -120, ctrlKey: true })
    expect(zoomText()).toBe('110%')
    fireEvent.wheel(viewport, { deltaY: -120, metaKey: true })
    expect(zoomText()).toBe('120%')
    fireEvent.wheel(viewport, { deltaY: 120, ctrlKey: true })
    expect(zoomText()).toBe('110%')

    fireEvent.wheel(viewport, { deltaY: -120 })
    expect(zoomText()).toBe('110%')
  })

  it('键盘 +/-/0 缩放与复位，Esc 关闭', () => {
    const onClose = vi.fn()
    render(<MarkdownReader t={t} doc={docOf()} onClose={onClose} />)

    fireEvent.keyDown(window, { key: '+' })
    expect(zoomText()).toBe('110%')
    fireEvent.keyDown(window, { key: '=' })
    expect(zoomText()).toBe('120%')
    fireEvent.keyDown(window, { key: '-' })
    expect(zoomText()).toBe('110%')
    fireEvent.keyDown(window, { key: '_' })
    expect(zoomText()).toBe('100%')
    fireEvent.keyDown(window, { key: 'a' })
    expect(zoomText()).toBe('100%')

    fireEvent.keyDown(window, { key: '0' })
    fireEvent.click(document.querySelector('[data-reader-zoom-in]') as HTMLElement)
    fireEvent.keyDown(window, { key: '0' })
    expect(zoomText()).toBe('100%')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('阅读器的拖动平移', () => {
  it('放大后按住拖动改滚动位置；缩回 100% 不再平移', () => {
    render(<MarkdownReader t={t} doc={docOf()} onClose={vi.fn()} />)
    const viewport = scrollEl()

    fireEvent.click(document.querySelector('[data-reader-zoom-in]') as HTMLElement)
    viewport.scrollLeft = 120
    viewport.scrollTop = 40

    fireEvent.pointerDown(viewport, { button: 0, isPrimary: true, pointerId: 1, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 160, clientY: 185 })
    expect(viewport.scrollLeft).toBe(160)
    expect(viewport.scrollTop).toBe(55)
    fireEvent.pointerUp(viewport, { pointerId: 1 })

    fireEvent.click(document.querySelector('[data-reader-zoom-reset]') as HTMLElement)
    const left = viewport.scrollLeft
    const top = viewport.scrollTop
    fireEvent.pointerDown(viewport, { button: 0, isPrimary: true, pointerId: 1, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 120, clientY: 120 })
    expect(viewport.scrollLeft).toBe(left)
    expect(viewport.scrollTop).toBe(top)
  })

  it('拖动只在左键、主指针并已按下时生效，指针捕获拿不到也不影响平移', () => {
    const onClose = vi.fn()
    render(<MarkdownReader t={t} doc={docOf()} onClose={onClose} />)
    const viewport = scrollEl()
    fireEvent.click(document.querySelector('[data-reader-zoom-in]') as HTMLElement)
    viewport.scrollLeft = 100

    // 没按下就移动、换指针编号、抬起：都不改变滚动位置。
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 60, clientY: 60 })
    expect(viewport.scrollLeft).toBe(100)
    fireEvent.pointerUp(viewport, { pointerId: 1 })

    const capture = vi.fn()
    Object.defineProperty(viewport, 'setPointerCapture', { configurable: true, value: capture })
    fireEvent.pointerDown(viewport, { button: 0, isPrimary: true, pointerId: 2, clientX: 200, clientY: 200 })
    expect(capture).toHaveBeenCalledWith(2)
    fireEvent.pointerMove(viewport, { pointerId: 9, clientX: 50, clientY: 50 })
    expect(viewport.scrollLeft).toBe(100)
    fireEvent.pointerUp(viewport, { pointerId: 9 })
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 190, clientY: 200 })
    expect(viewport.scrollLeft).toBe(110)

    const captureError = vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(viewport, 'setPointerCapture', {
      configurable: true,
      value: () => { throw new Error('no capture') },
    })
    fireEvent.pointerUp(viewport, { pointerId: 2 })
    fireEvent.pointerDown(viewport, { button: 0, isPrimary: true, pointerId: 3, clientX: 190, clientY: 200 })
    fireEvent.pointerMove(viewport, { pointerId: 3, clientX: 180, clientY: 200 })
    expect(viewport.scrollLeft).toBe(120)
    expect(captureError).toHaveBeenCalled()
    captureError.mockRestore()
  })
})
