// @vitest-environment jsdom
/** 任务详情页：简洁人话摘要、技术细节阅读弹层、改动范围收起与确认二次弹层。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { splitTaskDescription, TaskDetail } from '../src/pages/task-detail.tsx'
import type { SpecProjection } from '../src/spec/load.ts'
import type { TaskRow } from '../src/spec/rows.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'ws-1',
  scopeSessionId: 'session-1',
  title: 'seed-sandbox',
  path: 'E:/Projects/LCoder/lcoder/seed-sandbox',
}

const PROJECTION: SpecProjection = {
  root: `${PROJECT.path}/.spec`,
  project: { name: 'seed-sandbox', description: '', tracks: [] },
  requirements: [],
  proposals: [],
  tasks: [],
  contracts: [],
  deliverables: [],
  roles: [],
  rules: [],
  flow: null,
  automation: null,
  env: null,
  issues: [],
}

const TASK: TaskRow = {
  id: 'T-06',
  title: '搭建前后端基础骨架',
  state: 'drafting',
  grade: 'S',
  description: [
    '按 P-03 方案 A 补齐仓库缺失的工程骨架，支持本地启动前后端并检查服务健康状态。',
    '',
    '范围：',
    '- web/：Vite 5 + React 18 骨架',
    '- server/：Node 22 原生 HTTP 服务',
    '',
    '验收标准：',
    '- dev:web 与 dev:api 正常启动',
  ].join('\n'),
  paths: ['web/', 'server/'],
  irreversible: [],
  evidence: [],
  rules: [],
  dependsOn: [],
  attachments: [],
  proposal: 'P-03',
  requirement: 'REQ-01',
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

describe('splitTaskDescription', () => {
  it('清洗内部方案编号并分离技术实施细节', () => {
    const parts = splitTaskDescription(TASK.description)
    expect(parts.summary).toBe('补齐仓库缺失的工程骨架，支持本地启动前后端并检查服务健康状态。')
    expect(parts.summary).not.toContain('P-03')
    expect(parts.technical).toContain('Vite 5 + React 18')
    expect(parts.technical).toContain('验收标准')
  })

  it('支持显式 ## 技术实施细节 标题分段', () => {
    const parts = splitTaskDescription('为用户提供报销单提交能力。\n\n## 技术实施细节\n\n使用 POST /api/expenses 接口。')
    expect(parts.summary).toBe('为用户提供报销单提交能力。')
    expect(parts.technical).toContain('POST /api/expenses')
  })
})

describe('TaskDetail', () => {
  it('默认只展示简洁说明，技术细节经图标直接弹阅读器，改动范围默认收起可展开', async () => {
    await act(async () => {
      root.render(
        <TaskDetail
          task={TASK}
          projection={PROJECTION}
          project={PROJECT}
          sessions={[]}
          onClose={vi.fn()}
          onOpenDoc={vi.fn()}
          onReload={vi.fn()}
        />,
      )
    })

    const desc = container.querySelector('[data-testid="task-description"]')
    expect(desc?.textContent).toContain('补齐仓库缺失的工程骨架')
    expect(desc?.textContent).not.toContain('P-03')
    expect(desc?.textContent).not.toContain('Vite 5 + React 18')
    expect(container.querySelector('[data-testid="task-tech-details"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-contract-section"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-deliverable"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-attachments"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-schedule"]')).toBeNull()

    const techOpen = container.querySelector('[data-testid="task-tech-open"]') as HTMLButtonElement | null
    expect(techOpen).not.toBeNull()
    expect(techOpen?.textContent?.trim()).toBe('')
    expect(techOpen?.getAttribute('aria-label')).toBe('查看技术实施细节')
    expect(techOpen?.title).toBe('查看技术实施细节')

    await act(async () => { techOpen?.click() })
    const reader = document.body.querySelector('[data-testid="task-tech-fullscreen-layer"]')
    expect(reader).not.toBeNull()
    expect(reader?.querySelector('[data-testid="task-tech-fullscreen-body"]')?.textContent).toContain('Vite 5 + React 18')
    expect(container.querySelector('[data-testid="task-tech-details"]')).toBeNull()
    expect(desc?.textContent).not.toContain('Vite 5 + React 18')

    const readerClose = document.body.querySelector('[data-testid="task-tech-reader-close"]') as HTMLButtonElement | null
    expect(readerClose?.getAttribute('aria-label')).toBe('关闭')
    await act(async () => { readerClose?.click() })
    expect(document.body.querySelector('[data-testid="task-tech-fullscreen-layer"]')).toBeNull()

    const scope = container.querySelector('[data-testid="task-scope"]')
    const scopeToggle = container.querySelector('[data-testid="task-scope-toggle"]') as HTMLButtonElement | null
    expect(scopeToggle?.getAttribute('aria-expanded')).toBe('false')
    expect(scopeToggle?.getAttribute('aria-label')).toBe('改动范围与约束')
    expect(scopeToggle?.title).toBe('改动范围与约束')
    expect(scope?.querySelector('.task-scope-list')).toBeNull()
    expect(scope?.querySelector('[data-testid="task-paths"]')).toBeNull()

    await act(async () => { scopeToggle?.click() })
    expect(scopeToggle?.getAttribute('aria-expanded')).toBe('true')
    expect(scope?.querySelector('[data-testid="task-paths"]')).not.toBeNull()
    expect(scope?.querySelectorAll('.task-path-chip')).toHaveLength(2)

    await act(async () => { scopeToggle?.click() })
    expect(scopeToggle?.getAttribute('aria-expanded')).toBe('false')
    expect(scope?.querySelector('.task-scope-list')).toBeNull()
  })

  it('确认按钮文案为「确认」，先弹含负责岗位名的二次确认，确认后才推进', async () => {
    const onStartSession = vi.fn().mockResolvedValue({
      ok: true,
      message: '已启动',
      sessionId: 'session-new',
    })

    await act(async () => {
      root.render(
        <TaskDetail
          task={{ ...TASK, role: '后端开发工程师' }}
          projection={PROJECTION}
          project={PROJECT}
          sessions={[]}
          onClose={vi.fn()}
          onOpenDoc={vi.fn()}
          onReload={vi.fn()}
          onStartSession={onStartSession}
          onOpenSession={vi.fn()}
        />,
      )
    })

    const confirmBtn = container.querySelector('[data-testid="task-confirm-advance"]') as HTMLButtonElement | null
    expect(confirmBtn?.textContent?.trim()).toBe('确认')
    expect(container.querySelector('[data-testid="task-detail-expand"]')).toBeNull()

    await act(async () => { confirmBtn?.click() })
    const dialog = document.body.querySelector('[data-testid="task-advance-confirm-dialog"]')
    expect(dialog).not.toBeNull()
    const hint = dialog?.querySelector('[data-testid="task-advance-confirm-hint"]')?.textContent ?? ''
    expect(hint).toContain('将生成技术实施方案')
    expect(hint).toContain('后端开发工程师')
    expect(onStartSession).not.toHaveBeenCalled()

    const cancel = dialog?.querySelector('[data-testid="task-advance-confirm-cancel"]') as HTMLButtonElement | null
    await act(async () => { cancel?.click() })
    expect(document.body.querySelector('[data-testid="task-advance-confirm-dialog"]')).toBeNull()
    expect(onStartSession).not.toHaveBeenCalled()

    await act(async () => { confirmBtn?.click() })
    const start = document.body.querySelector('[data-testid="task-advance-confirm-start"]') as HTMLButtonElement | null
    expect(start?.textContent?.trim()).toBe('确认开始')
    await act(async () => { start?.click() })
    expect(onStartSession).toHaveBeenCalledTimes(1)
    expect(onStartSession).toHaveBeenCalledWith(
      expect.stringContaining('补充开发实施方案：任务 T-06'),
      'maniu-architect',
    )
    expect(container.querySelector('[data-testid="task-bg-running"]')).not.toBeNull()
  })

  it('未分配负责人时点击确认沿用缺人提示，不弹二次确认', async () => {
    const onStartSession = vi.fn().mockResolvedValue({ ok: true, message: '已启动' })
    await act(async () => {
      root.render(
        <TaskDetail
          task={TASK}
          projection={PROJECTION}
          project={PROJECT}
          sessions={[]}
          onClose={vi.fn()}
          onOpenDoc={vi.fn()}
          onReload={vi.fn()}
          onStartSession={onStartSession}
        />,
      )
    })

    const confirmBtn = container.querySelector('[data-testid="task-confirm-advance"]') as HTMLButtonElement | null
    await act(async () => { confirmBtn?.click() })
    expect(document.body.querySelector('[data-testid="task-advance-confirm-dialog"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-action-result"]')?.textContent).toContain('请先选择或填写负责岗位')
    expect(onStartSession).not.toHaveBeenCalled()
  })

  it('修改与删除为纯图标按钮，保留 testid 与提示文案', async () => {
    await act(async () => {
      root.render(
        <TaskDetail
          task={{ ...TASK, role: '后端开发工程师' }}
          projection={PROJECTION}
          project={PROJECT}
          sessions={[]}
          onClose={vi.fn()}
          onOpenDoc={vi.fn()}
          onReload={vi.fn()}
          onStartSession={vi.fn().mockResolvedValue({ ok: true, message: '已启动' })}
        />,
      )
    })

    const modifyBtn = container.querySelector('[data-testid="task-modify-toggle"]') as HTMLButtonElement | null
    const discardBtn = container.querySelector('[data-testid="task-discard-toggle"]') as HTMLButtonElement | null
    expect(modifyBtn?.textContent?.trim()).toBe('')
    expect(discardBtn?.textContent?.trim()).toBe('')
    expect(modifyBtn?.getAttribute('aria-label')).toBe('修改任务')
    expect(modifyBtn?.title).toBe('修改任务')
    expect(discardBtn?.getAttribute('aria-label')).toBe('删除任务')
    expect(discardBtn?.title).toBe('删除任务')

    await act(async () => { modifyBtn?.click() })
    expect(container.querySelector('[data-testid="task-modify-box"]')).not.toBeNull()
    await act(async () => { discardBtn?.click() })
    expect(container.querySelector('[data-testid="task-discard-confirm-box"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="task-discard-confirm"]')).not.toBeNull()
  })
})
