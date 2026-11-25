// @vitest-environment jsdom
/** 任务详情页：简洁人话摘要默认展示、内部编号清洗与技术实施细节折叠。 */
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
  it('默认只展示简洁说明，点击不起眼入口才展开技术实施细节', async () => {
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
    expect(container.querySelectorAll('.task-path-chip')).toHaveLength(2)

    const toggle = container.querySelector('[data-testid="task-tech-toggle"]') as HTMLButtonElement | null
    expect(toggle).not.toBeNull()
    expect(toggle?.textContent).toContain('查看技术实施细节')

    await act(async () => {
      toggle?.click()
    })
    const details = container.querySelector('[data-testid="task-tech-details"]')
    expect(details?.textContent).toContain('Vite 5 + React 18')
    expect(toggle?.textContent).toContain('收起技术实施细节')
  })

  it('待确认任务提供确认并生成开发方案、修改任务与删除任务闭环操作', async () => {
    const onStartSession = vi.fn().mockResolvedValue({
      ok: true,
      message: '已启动',
      sessionId: 'session-new',
    })

    await act(async () => {
      root.render(
        <TaskDetail
          task={{ ...TASK, role: 'api-dev' }}
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

    const modifyBtn = container.querySelector('[data-testid="task-modify-toggle"]') as HTMLButtonElement | null
    const discardBtn = container.querySelector('[data-testid="task-discard-toggle"]') as HTMLButtonElement | null
    const confirmBtn = container.querySelector('[data-testid="task-confirm-advance"]') as HTMLButtonElement | null

    expect(confirmBtn).not.toBeNull()
    expect(modifyBtn).not.toBeNull()
    expect(discardBtn).not.toBeNull()

    await act(async () => {
      modifyBtn?.click()
    })
    expect(container.querySelector('[data-testid="task-modify-box"]')).not.toBeNull()

    await act(async () => {
      discardBtn?.click()
    })
    expect(container.querySelector('[data-testid="task-discard-confirm-box"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="task-discard-confirm"]')).not.toBeNull()

    await act(async () => {
      confirmBtn?.click()
    })
    expect(onStartSession).toHaveBeenCalledTimes(1)
    expect(onStartSession).toHaveBeenCalledWith(
      expect.stringContaining('补充开发实施方案：任务 T-06'),
      'maniu-architect',
    )
    expect(container.querySelector('[data-testid="task-bg-running"]')).not.toBeNull()
  })
})
