// @vitest-environment jsdom
/** 任务详情页：概述与详细设计分块折叠、技术细节阅读器、任务说明卡内的范围与契约折叠区。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DESIGN_LIMITS,
  measureDesign,
  parseDesignBlocks,
  splitTaskDescription,
  TaskDetail,
} from '../src/pages/task-detail.tsx'
import type { ContractRow } from '../src/spec/rows.ts'
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

const CONTRACT: ContractRow = {
  id: 'T-06',
  change: ['补齐工程骨架'],
  notChange: ['不改业务接口'],
  acceptance: ['dev:web 正常启动'],
  failIf: ['dev:web 启动失败'],
  signedBy: 'human',
  signedAt: '2026-11-21T10:00:00+08:00',
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

/** 生成带小标题的详细设计；块与条目数可控。 */
function designOf(spec: readonly number[]): string {
  return spec.map((count, block) => [
    `### 小节 ${String(block + 1)}`,
    '',
    ...Array.from({ length: count }, (_, index) => `- 条目 ${String(block + 1)}-${String(index + 1)} 的说明`),
  ].join('\n')).join('\n\n')
}

/** 用填充文字把详细设计补到指定字数。 */
function designWithChars(length: number): string {
  const base = '### 只有一个块\n\n- 条目一\n\n'
  return `${base}${'说'.repeat(Math.max(0, length - base.length))}`
}

function taskWithDesign(description: string, overrides: Partial<TaskRow> = {}): TaskRow {
  return { ...TASK, description: `为员工提供可用的报销能力。\n\n## 详细设计\n\n${description}`, ...overrides }
}

interface RenderHandlers {
  readonly onStartSession?: (prompt: string, preset?: string) => Promise<{
    readonly ok: boolean
    readonly message: string
    readonly sessionId?: string
  }>
  readonly onOpenSession?: (sessionId: string) => void
}

async function renderTask(task: TaskRow, projection: SpecProjection = PROJECTION, handlers: RenderHandlers = {}): Promise<void> {
  await act(async () => {
    root.render(
      <TaskDetail
        task={task}
        projection={projection}
        project={PROJECT}
        sessions={[]}
        onClose={vi.fn()}
        onOpenDoc={vi.fn()}
        onReload={vi.fn()}
        {...(handlers.onStartSession === undefined ? {} : { onStartSession: handlers.onStartSession })}
        {...(handlers.onOpenSession === undefined ? {} : { onOpenSession: handlers.onOpenSession })}
      />,
    )
  })
}

describe('splitTaskDescription', () => {
  it('清洗内部方案编号并分离技术实施细节', () => {
    const parts = splitTaskDescription(TASK.description)
    expect(parts.summary).toBe('补齐仓库缺失的工程骨架，支持本地启动前后端并检查服务健康状态。')
    expect(parts.summary).not.toContain('P-03')
    expect(parts.design).toBe('')
    expect(parts.technical).toContain('Vite 5 + React 18')
    expect(parts.technical).toContain('验收标准')
  })

  it('支持显式 ## 技术实施细节 标题分段', () => {
    const parts = splitTaskDescription('为用户提供报销单提交能力。\n\n## 技术实施细节\n\n使用 POST /api/expenses 接口。')
    expect(parts.summary).toBe('为用户提供报销单提交能力。')
    expect(parts.design).toBe('')
    expect(parts.technical).toContain('POST /api/expenses')
  })

  it('概述 + 详细设计：详细设计单独抽出，不含技术细节', () => {
    const parts = splitTaskDescription('为用户提供报销能力。\n\n## 详细设计\n\n### 业务流程\n\n- 员工提交单据。')
    expect(parts.summary).toBe('为用户提供报销能力。')
    expect(parts.design).toContain('业务流程')
    expect(parts.technical).toBe('')
  })

  it('概述 + 详细设计 + 技术实施细节：设计里的「验收标准：」不会被误判为技术段', () => {
    const raw = [
      '为用户提供报销能力。',
      '',
      '## 详细设计',
      '',
      '### 业务流程',
      '',
      '1. 员工提交单据。',
      '',
      '### 系统规则',
      '',
      '验收标准：以单据最终状态为准，不是手工勾选。',
      '',
      '## 技术实施细节',
      '',
      '改 src/expense.mjs 并补测试。',
    ].join('\n')
    const parts = splitTaskDescription(raw)
    expect(parts.summary).toBe('为用户提供报销能力。')
    expect(parts.design).toContain('验收标准：以单据最终状态为准')
    expect(parts.design).not.toContain('src/expense.mjs')
    expect(parts.technical).toContain('src/expense.mjs')
    expect(parts.technical).not.toContain('验收标准')
  })

  it('旧格式（无详细设计、无标题）行为不变', () => {
    const parts = splitTaskDescription('第一段概述。\n\n第二段技术说明。')
    expect(parts.summary).toBe('第一段概述。')
    expect(parts.design).toBe('')
    expect(parts.technical).toBe('第二段技术说明。')
  })
})

describe('parseDesignBlocks 与阈值', () => {
  it('没有小标题时整段算一块', () => {
    const blocks = parseDesignBlocks('当金额大于 5000 元时，系统应提示需要二级审批。')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.title).toBe('')
    expect(blocks[0]?.items).toBe(1)
  })

  it('只有一个小标题时仍拆成一块并统计条目', () => {
    const blocks = parseDesignBlocks(designOf([3]))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.title).toBe('小节 1')
    expect(blocks[0]?.items).toBe(3)
  })

  it('恰好 12 条不触发折叠阈值，超过 12 条只展开第一块', () => {
    expect(DESIGN_LIMITS.expandItems).toBe(12)
    const twelve = measureDesign(designOf([4, 4, 4]))
    expect(twelve.items).toBe(12)
    expect(twelve.oversized).toBe(false)

    const thirteen = measureDesign(designOf([5, 4, 4]))
    expect(thirteen.items).toBe(13)
    expect(thirteen.oversized).toBe(false)
  })

  it('恰好 30 条留在卡片内，超过 30 条收进阅读器', () => {
    expect(DESIGN_LIMITS.readerItems).toBe(30)
    const thirty = measureDesign(designOf([10, 10, 10]))
    expect(thirty.items).toBe(30)
    expect(thirty.oversized).toBe(false)

    const thirtyOne = measureDesign(designOf([11, 10, 10]))
    expect(thirtyOne.items).toBe(31)
    expect(thirtyOne.oversized).toBe(true)
  })

  it('正文恰好 3000 字留在卡片内，超过 3000 字收进阅读器', () => {
    expect(DESIGN_LIMITS.readerChars).toBe(3000)
    const atLimit = measureDesign(designWithChars(3000))
    expect(atLimit.chars).toBe(3000)
    expect(atLimit.oversized).toBe(false)

    const overLimit = measureDesign(designWithChars(3001))
    expect(overLimit.chars).toBe(3001)
    expect(overLimit.oversized).toBe(true)
  })
})

describe('TaskDetail', () => {
  it('默认只展示概述，技术细节经图标弹阅读器，任务说明卡内范围默认收起', async () => {
    await renderTask(TASK)

    const desc = container.querySelector('[data-testid="task-description"]')
    expect(desc?.textContent).toContain('补齐仓库缺失的工程骨架')
    expect(desc?.textContent).not.toContain('P-03')
    expect(desc?.textContent).not.toContain('Vite 5 + React 18')
    expect(container.querySelector('[data-testid="task-tech-details"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-contract-section"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-deliverable"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-attachments"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-schedule"]')).toBeNull()
    // 标题行只剩编号与状态，A/B/C 字母徽标已去掉。
    expect(container.querySelector('.task-detail-head')?.textContent).toBe('T-06待确认')

    const scope = container.querySelector('[data-testid="task-scope"]') as HTMLDetailsElement | null
    expect(scope).not.toBeNull()
    expect(scope?.closest('[data-testid="task-description"]')).not.toBeNull()
    expect(scope?.open).toBe(false)
    expect(container.querySelector('.task-detail-aside [data-testid="task-scope"]')).toBeNull()
    expect(scope?.querySelector('[data-testid="task-paths"]')).not.toBeNull()
    expect(scope?.querySelectorAll('.task-path-chip')).toHaveLength(2)
    // 分级 S 不在「大/中/小」映射内，不显示改动规模行。
    expect(scope?.querySelector('[data-testid="task-scope-grade"]')).toBeNull()

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
  })

  it('详细设计直接显示在任务说明卡，技术图标只打开技术部分', async () => {
    const description = [
      '为用户提供报销能力。',
      '',
      '## 详细设计',
      '',
      '### 业务流程',
      '',
      '- 员工提交单据。',
      '',
      '## 技术实施细节',
      '',
      '改 expense.mjs 并补测试。',
    ].join('\n')
    await renderTask({ ...TASK, description })

    const desc = container.querySelector('[data-testid="task-description"]')
    expect(desc?.textContent).toContain('详细设计')
    expect(desc?.textContent).toContain('员工提交单据')
    expect(desc?.textContent).not.toContain('expense.mjs')

    const techOpen = container.querySelector('[data-testid="task-tech-open"]') as HTMLButtonElement | null
    await act(async () => { techOpen?.click() })
    const body = document.body.querySelector('[data-testid="task-tech-fullscreen-body"]')
    expect(body?.textContent).toContain('expense.mjs')
    expect(body?.textContent).not.toContain('员工提交单据')
  })

  it('详细设计超过 12 条时默认只展开第一块，块数 ≥3 可一键全部展开/收起', async () => {
    await renderTask(taskWithDesign(designOf([5, 4, 4])))

    const toggles = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="task-design-block-toggle"]')]
    expect(toggles).toHaveLength(3)
    expect(toggles.map(node => node.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false'])
    expect(toggles[0]?.textContent).toContain('小节 1')
    expect(toggles[0]?.textContent).toContain('5 条')

    const expandAll = container.querySelector('[data-testid="task-design-toggle-all"]') as HTMLButtonElement | null
    expect(expandAll?.textContent).toBe('全部展开')
    await act(async () => { expandAll?.click() })
    expect(toggles.map(node => node.getAttribute('aria-expanded'))).toEqual(['true', 'true', 'true'])
    expect(expandAll?.textContent).toBe('全部收起')

    await act(async () => { expandAll?.click() })
    expect(toggles.map(node => node.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false'])
    expect(expandAll?.textContent).toBe('全部展开')
  })

  it('详细设计恰好 12 条时全部展开', async () => {
    await renderTask(taskWithDesign(designOf([4, 4, 4])))
    const toggles = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="task-design-block-toggle"]')]
    expect(toggles.map(node => node.getAttribute('aria-expanded'))).toEqual(['true', 'true', 'true'])
  })

  it('详细设计超过 30 条时只留第一块，文字链接打开完整阅读器', async () => {
    await renderTask(taskWithDesign(designOf([11, 10, 10])))

    expect(container.querySelectorAll('[data-testid="task-design-block"]')).toHaveLength(1)
    const link = container.querySelector('[data-testid="task-design-view-full"]') as HTMLButtonElement | null
    expect(link?.textContent).toContain('查看完整详细设计（共 31 条）')

    await act(async () => { link?.click() })
    const reader = document.body.querySelector('[data-testid="task-design-fullscreen-layer"]')
    expect(reader).not.toBeNull()
    expect(reader?.querySelector('[data-testid="task-design-fullscreen-body"]')?.textContent).toContain('小节 3')
  })

  it('详细设计超过 3000 字时同样收进阅读器', async () => {
    await renderTask(taskWithDesign(designWithChars(3001)))
    expect(container.querySelector('[data-testid="task-design-view-full"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="task-design-block"]')).toHaveLength(1)
  })

  it('待确认任务缺详细设计时给补写入口，点击后走研发经理后台会话', async () => {
    const onStartSession = vi.fn().mockResolvedValue({ ok: true, message: '已启动', sessionId: 'session-design' })
    await renderTask(TASK, PROJECTION, { onStartSession, onOpenSession: vi.fn() })

    expect(container.querySelector('[data-testid="task-design-empty"]')?.textContent).toContain('这条任务还没有详细设计')
    const generate = container.querySelector('[data-testid="task-design-generate"]') as HTMLButtonElement | null
    expect(generate?.textContent).toBe('让 AI 补充详细设计')

    await act(async () => { generate?.click() })
    expect(onStartSession).toHaveBeenCalledTimes(1)
    expect(onStartSession).toHaveBeenCalledWith(
      expect.stringContaining('补充详细设计：任务 T-06'),
      'maniu-manager',
    )
    expect(container.querySelector('[data-testid="task-design-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="task-bg-running"]')).not.toBeNull()
  })

  it('已确认任务缺详细设计时不显示补写入口', async () => {
    await renderTask({ ...TASK, state: 'contracted' }, { ...PROJECTION, contracts: [CONTRACT] })
    expect(container.querySelector('[data-testid="task-design-empty"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-design-generate"]')).toBeNull()
  })

  it('非待确认任务仍在任务说明卡内展示契约，testid 保留', async () => {
    await renderTask({ ...TASK, state: 'contracted', grade: 'A' }, { ...PROJECTION, contracts: [CONTRACT] })

    const scope = container.querySelector('[data-testid="task-scope"]') as HTMLDetailsElement | null
    expect(scope?.querySelector('[data-testid="task-scope-grade"]')?.textContent).toBe('大')

    const section = container.querySelector('[data-testid="task-contract-section"]') as HTMLDetailsElement | null
    expect(section).not.toBeNull()
    expect(section?.closest('[data-testid="task-description"]')).not.toBeNull()
    expect(section?.open).toBe(false)
    expect(section?.querySelector('[data-testid="task-contract-signed"]')?.textContent).toBe('人签')
    expect(section?.querySelectorAll('[data-testid="task-acceptance"] li')).toHaveLength(1)
  })

  it('确认按钮文案为「确认」，先弹含负责岗位名的二次确认，确认后才推进', async () => {
    const onStartSession = vi.fn().mockResolvedValue({
      ok: true,
      message: '已启动',
      sessionId: 'session-new',
    })

    await renderTask({ ...TASK, role: '后端开发工程师' }, PROJECTION, { onStartSession, onOpenSession: vi.fn() })

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
    await renderTask(TASK, PROJECTION, { onStartSession })

    const confirmBtn = container.querySelector('[data-testid="task-confirm-advance"]') as HTMLButtonElement | null
    await act(async () => { confirmBtn?.click() })
    expect(document.body.querySelector('[data-testid="task-advance-confirm-dialog"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-action-result"]')?.textContent).toContain('请先选择或填写负责岗位')
    expect(onStartSession).not.toHaveBeenCalled()
  })

  it('修改与删除为纯图标按钮，保留 testid 与提示文案', async () => {
    await renderTask({ ...TASK, role: '后端开发工程师' }, PROJECTION, {
      onStartSession: vi.fn().mockResolvedValue({ ok: true, message: '已启动' }),
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
