// @vitest-environment jsdom
/** 项目页：单一「新建项目」入口、目录选择与登记、当前置顶的行列表与文案。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsPage } from '../src/pages/projects.tsx'
import { EN } from '../src/locale-en.ts'
import { ZH } from '../src/locale-zh.ts'
import { translate, type Translate } from '../src/locale.ts'
import { pickDirectory, type ProjectScope, type WorkspaceRow } from '../src/workspace/use-workspaces.ts'

const t: Translate = (key, params) => translate('zh', key, params)

let container: HTMLDivElement
let root: Root
const pick = vi.fn<(defaultPath?: string) => Promise<string | null>>()
const call = vi.fn<(domain: string, op: string, payload: unknown) => Promise<unknown>>()

const NEW_WORKSPACE = { workspaceId: 'w-new', path: 'E:/repo', title: 'Repo', sessionIds: [] }

function successAnswer(): unknown {
  return { ok: true, value: { workspace: NEW_WORKSPACE } }
}

function row(id: string, title: string, path: string, sessionIds: readonly string[] = []): WorkspaceRow {
  return { workspaceId: id, path, title, sessionIds }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  pick.mockReset()
  call.mockReset()
  call.mockResolvedValue(successAnswer())
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { pickDirectory: pick, call },
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

interface RenderOptions {
  readonly items?: readonly WorkspaceRow[]
  readonly current?: ProjectScope | null
  readonly error?: string | null
  readonly onSelect?: (workspace: WorkspaceRow) => void
  readonly onOpened?: (workspace: WorkspaceRow) => void
}

function renderPage(options: RenderOptions = {}): void {
  act(() => {
    root.render(
      <ProjectsPage
        items={options.items ?? []}
        current={options.current === undefined ? null : options.current}
        error={options.error ?? null}
        t={t}
        onSelect={options.onSelect ?? (() => {})}
        onOpened={options.onOpened ?? (() => {})}
      />,
    )
  })
}

async function clickOpen(): Promise<void> {
  await act(async () => { element('project-open').click() })
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

describe('项目页新建项目入口', () => {
  it('唯一主按钮带 project-open 标识并使用词典文案', () => {
    renderPage()
    const button = element('project-open')
    expect(button.textContent).toContain(t('projects.new'))
    expect(container.querySelectorAll('[data-testid="project-open"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="project-path"]')).toBeNull()
    expect(container.querySelector('[data-testid="project-browse"]')).toBeNull()
  })

  it('点击按钮打开目录选择器，并以当前项目路径为起始目录', async () => {
    pick.mockResolvedValue(null)
    renderPage({
      current: { workspaceId: 'w1', path: 'E:/current', title: 'One', scopeSessionId: 's1' },
    })
    await clickOpen()
    expect(pick).toHaveBeenCalledTimes(1)
    expect(pick).toHaveBeenCalledWith('E:/current')
  })

  it('没有当前项目时目录选择器不传起始目录', async () => {
    pick.mockResolvedValue(null)
    renderPage()
    await clickOpen()
    expect(pick).toHaveBeenCalledWith(undefined)
  })

  it('选中目录后登记项目并回调 onOpened', async () => {
    pick.mockResolvedValue('E:/repo')
    const onOpened = vi.fn<(workspace: WorkspaceRow) => void>()
    renderPage({ onOpened })
    await clickOpen()
    expect(call).toHaveBeenCalledWith('workspace', 'create', { request: { path: 'E:/repo' } })
    expect(onOpened).toHaveBeenCalledTimes(1)
    expect(onOpened.mock.calls[0]![0]!.workspaceId).toBe('w-new')
    expect(container.querySelector('[data-testid="project-error"]')).toBeNull()
  })

  it('取消选择不登记也不切换', async () => {
    pick.mockResolvedValue(null)
    const onOpened = vi.fn<(workspace: WorkspaceRow) => void>()
    renderPage({ onOpened })
    await clickOpen()
    expect(call).not.toHaveBeenCalled()
    expect(onOpened).not.toHaveBeenCalled()
  })

  it('选择框打不开时显示可解释错误', async () => {
    pick.mockRejectedValue(new Error('chooser failed'))
    renderPage()
    await clickOpen()
    expect(element('project-error').textContent).toContain(
      t('projects.pickFailed', { detail: 'chooser failed' }),
    )
    expect(call).not.toHaveBeenCalled()
  })

  it('登记失败时显示可读错误', async () => {
    pick.mockResolvedValue('E:/repo')
    call.mockResolvedValue({ ok: false, error: { code: 'E_OPEN', message: 'boom' } })
    const onOpened = vi.fn<(workspace: WorkspaceRow) => void>()
    renderPage({ onOpened })
    await clickOpen()
    expect(element('project-error').textContent).toContain(
      t('projects.openFailed', { detail: 'E_OPEN: boom' }),
    )
    expect(onOpened).not.toHaveBeenCalled()
  })
})

describe('项目页列表', () => {
  it('当前项目置顶并带当前徽标，其余保持原顺序', () => {
    renderPage({
      current: { workspaceId: 'w2', path: 'E:/two', title: 'Two', scopeSessionId: 's2' },
      items: [row('w1', 'One', 'E:/one'), row('w2', 'Two', 'E:/two'), row('w3', 'Three', 'E:/three')],
    })
    const items = [...container.querySelectorAll('[data-testid="project-item"]')]
    expect(items).toHaveLength(3)
    expect(items[0]!.getAttribute('data-workspace-id')).toBe('w2')
    expect(items[0]!.getAttribute('data-current')).toBe('true')
    expect(items[0]!.getAttribute('aria-current')).toBe('true')
    expect(items[1]!.getAttribute('data-workspace-id')).toBe('w1')
    expect(items[2]!.getAttribute('data-workspace-id')).toBe('w3')
    expect(items[0]!.textContent).toContain(t('projects.currentBadge'))
    expect(items[1]!.textContent).not.toContain(t('projects.currentBadge'))
  })

  it('列表行只显示名称和路径，不显示会话数', () => {
    renderPage({ items: [row('w1', 'One', 'E:/one', ['s1', 's2', 's3'])] })
    const text = element('project-item').textContent ?? ''
    expect(text).toContain('One')
    expect(text).toContain('E:/one')
    expect(text).not.toContain('个会话')
    expect(text).not.toContain('3')
  })

  it('点击列表行回调 onSelect', () => {
    const onSelect = vi.fn<(workspace: WorkspaceRow) => void>()
    renderPage({ items: [row('w1', 'One', 'E:/one')], onSelect })
    act(() => { element('project-item').click() })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0]![0]!.workspaceId).toBe('w1')
  })

  it('空列表显示走词典的空态', () => {
    renderPage()
    expect(element('project-empty').textContent).toContain(t('projects.empty'))
  })
})

describe('项目页双语词典', () => {
  it('中英词典都提供项目页专属键', () => {
    const keys = [
      'projects.title',
      'projects.current',
      'projects.none',
      'projects.new',
      'projects.newBusy',
      'projects.currentBadge',
      'projects.empty',
      'projects.pickFailed',
      'projects.openFailed',
    ] as const
    for (const key of keys) {
      expect(ZH[key]).toBeTypeOf('string')
      expect(EN[key]).toBeTypeOf('string')
      expect(ZH[key]).not.toBe('')
      expect(EN[key]).not.toBe('')
    }
    expect(EN['projects.title']).toBe('Projects')
    expect(EN['projects.currentBadge']).toBe('Current')
    expect(EN['projects.empty']).toContain('New project')
  })
})
