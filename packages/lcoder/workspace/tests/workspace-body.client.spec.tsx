// @vitest-environment jsdom
/**
 * 正文的三栏结构，以及在数据面各个状态下的样子。
 *
 * 投影面是可选注入：不绑时保持骨架态（老行为），绑了就走
 * 加载 → 就绪/失败。这里的投影替身直接内存返回，不走真远程。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { WorkspaceBody, type WorkspaceBodyProps } from '../src/client/WorkspaceBody.tsx'
import { en, zh, type LcoderWorkspaceKey } from '../src/client/locales.ts'
import type { WorkspaceProjection } from '../src/client/projection.ts'

afterEach(cleanup)

/**
 * 组一个正文的 props：文案走真词典，会话状态只给 `byId` 里的一条。
 * @param dict - 用哪本词典。
 * @param cwd - 这个会话的工作区目录；`undefined` 表示没有。
 * @param projection - 可选的投影面；不传就是骨架态。
 * @returns 可直接交给组件的 props。
 */
function propsOf(
  dict: Record<LcoderWorkspaceKey, string>,
  cwd: string | undefined,
  projection?: WorkspaceBodyProps['projection'],
): WorkspaceBodyProps {
  const sessions = { byId: cwd === undefined ? {} : { 's-1': { cwd } } }
  return {
    t: makeTranslate(dict),
    sessionId: 's-1',
    useSessions: (selector: (state: typeof sessions) => unknown) => selector(sessions),
    projection,
  } as unknown as WorkspaceBodyProps
}

/** 一份最小的投影结果。 */
function projectionOf(rows: Partial<WorkspaceProjection>): WorkspaceProjection {
  return {
    tasks: [], rules: [], contracts: [], proposals: [], problems: [], ...rows,
  }
}

describe('WorkspaceBody', () => {
  it('按左中右画出三栏，标题取自词典', () => {
    const { container } = render(<WorkspaceBody {...propsOf(zh, '/work/app')} />)
    const columns = [...container.querySelectorAll('[data-lcoder-column]')]
    expect(columns.map(column => column.getAttribute('data-lcoder-column')))
      .toEqual(['tasks', 'spec', 'conversation'])
    for (const key of ['column.tasks', 'column.spec', 'column.conversation'] as const) {
      expect(screen.getByText(zh[key])).toBeDefined()
    }
    // 没绑投影面：三栏都还是骨架，不是数据。
    expect(container.querySelectorAll('[data-lcoder-pending]')).toHaveLength(3)
  })

  it('有工作区目录时把根路径显示在表头', () => {
    const { container } = render(<WorkspaceBody {...propsOf(zh, '/work/app')} />)
    expect(container.querySelector('[data-lcoder-root]')?.textContent).toBe('/work/app')
    expect(container.querySelector('[data-lcoder-workspace]')?.getAttribute('data-lcoder-cwd')).toBe('/work/app')
    expect(container.querySelector('[data-lcoder-no-root]')).toBeNull()
  })

  it('没有工作区目录时换成说明，不再画一条空路径', () => {
    const { container } = render(<WorkspaceBody {...propsOf(zh, undefined)} />)
    expect(container.querySelector('[data-lcoder-no-root]')?.textContent).toBe(zh.noWorkspace)
    expect(container.querySelector('[data-lcoder-root]')).toBeNull()
    expect(container.querySelector('[data-lcoder-workspace]')?.getAttribute('data-lcoder-cwd')).toBeNull()
  })

  it('换一本词典，整块正文跟着换语言', () => {
    render(<WorkspaceBody {...propsOf(en, undefined)} />)
    expect(screen.getByText(en['column.tasks'])).toBeDefined()
    expect(screen.queryByText(zh['column.tasks'])).toBeNull()
  })

  it('绑了投影面：任务与规格条目画成行，状态原样展示', async () => {
    const { container } = render(<WorkspaceBody {...propsOf(zh, '/work/app', () => Promise.resolve(projectionOf({
      tasks: [{ id: 'T-014', title: '登录接口限流', state: 'contracted', grade: 'B', rules: [], evidence: [] }],
      rules: [{ id: 'R-LOGIN-01', kind: 'rule', status: 'confirmed', text: '连输 5 次锁定 10 分钟' }],
    })))} />)

    await waitFor(() => { expect(container.querySelector('[data-lcoder-tasks]')).not.toBeNull() })
    const task = container.querySelector('[data-lcoder-task="T-014"]')
    expect(task?.textContent).toContain('登录接口限流')
    expect(task?.querySelector('[data-lcoder-state]')?.getAttribute('data-lcoder-state')).toBe('contracted')

    const rule = container.querySelector('[data-lcoder-rule="R-LOGIN-01"]')
    expect(rule?.querySelector('[data-lcoder-status]')?.getAttribute('data-lcoder-status')).toBe('confirmed')
    expect(container.querySelector('[data-lcoder-problems]')).toBeNull()
  })

  it('投影面失败时两栏各画一条失败说明，右栏不受影响', async () => {
    const { container } = render(<WorkspaceBody {...propsOf(zh, '/work/app', () => Promise.reject(new Error('网络断了')))} />)

    await waitFor(() => { expect(container.querySelectorAll('[data-lcoder-error]')).toHaveLength(2) })
    expect(container.querySelector('[data-lcoder-error="tasks"]')?.textContent).toContain('网络断了')
    expect(container.querySelector('[data-lcoder-pending="conversation"]')).not.toBeNull()
  })

  it('越出五态的状态值不套状态色，只中性展示', async () => {
    const { container } = render(<WorkspaceBody {...propsOf(zh, '/work/app', () => Promise.resolve(projectionOf({
      tasks: [{ id: 'T-001', title: '奇怪状态', state: 'on-fire', grade: 'A', rules: [], evidence: [] }],
    })))} />)

    await waitFor(() => { expect(container.querySelector('[data-lcoder-task="T-001"]')).not.toBeNull() })
    expect(container.querySelector('[data-lcoder-state="on-fire"]')).not.toBeNull()
  })
})
