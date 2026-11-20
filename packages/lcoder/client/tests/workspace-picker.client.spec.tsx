// @vitest-environment jsdom
/** 项目页「浏览…」走 preload 的目录选择；取消不改输入，失败显示可解释提示。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsPage } from '../src/pages/projects.tsx'
import { pickDirectory } from '../src/workspace/use-workspaces.ts'

let container: HTMLDivElement
let root: Root
const pick = vi.fn<(defaultPath?: string) => Promise<string | null>>()

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  pick.mockReset()
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { pickDirectory: pick },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
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

function renderPage(currentPath?: string): void {
  act(() => {
    root.render(
      <ProjectsPage
        items={[]}
        current={currentPath === undefined ? null : { workspaceId: 'w1', path: currentPath, title: 'Repo', scopeSessionId: 's1' }}
        error={null}
        onSelect={() => {}}
        onOpened={() => {}}
      />,
    )
  })
}

async function browse(): Promise<void> {
  await act(async () => { element('project-browse').click() })
}

function typePath(value: string): void {
  const input = element('project-path') as HTMLInputElement
  // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('pickDirectory', () => {
  it('直接返回 preload 的结果', async () => {
    pick.mockResolvedValue('E:/repo')
    await expect(pickDirectory()).resolves.toBe('E:/repo')
    pick.mockResolvedValue(null)
    await expect(pickDirectory()).resolves.toBeNull()
  })

  it('把起始目录转给 preload', async () => {
    pick.mockResolvedValue(null)
    await pickDirectory('E:/current')
    expect(pick).toHaveBeenCalledWith('E:/current')
  })
})

describe('项目页浏览按钮', () => {
  it('选中目录后回填输入框', async () => {
    pick.mockResolvedValue('E:/repo')
    renderPage()
    await browse()
    expect((element('project-path') as HTMLInputElement).value).toBe('E:/repo')
    expect(container.querySelector('[data-testid="project-error"]')).toBeNull()
  })

  it('把输入框里的路径作为起始目录', async () => {
    pick.mockResolvedValue(null)
    renderPage('E:/existing')
    await browse()
    expect(pick).toHaveBeenCalledWith('E:/existing')
  })

  it('输入框清空时回落到当前项目路径', async () => {
    pick.mockResolvedValue(null)
    renderPage('E:/existing')
    typePath('')
    await browse()
    expect(pick).toHaveBeenCalledWith('E:/existing')
  })

  it('没有输入也没有当前项目时只开对话框', async () => {
    pick.mockResolvedValue(null)
    renderPage()
    await browse()
    expect(pick).toHaveBeenCalledWith(undefined)
  })

  it('取消不改变已有路径', async () => {
    pick.mockResolvedValue(null)
    renderPage('E:/existing')
    await browse()
    expect((element('project-path') as HTMLInputElement).value).toBe('E:/existing')
  })

  it('选择框打不开时显示原因', async () => {
    pick.mockRejectedValue(new Error('无法打开系统目录选择框：chooser failed'))
    renderPage()
    await browse()
    expect(element('project-error').textContent).toContain('无法打开系统目录选择框')
  })
})
