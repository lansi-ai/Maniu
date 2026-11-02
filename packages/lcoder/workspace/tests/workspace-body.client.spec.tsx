// @vitest-environment jsdom
/**
 * 正文的三栏结构，以及在不在会话工作区这两种状态下的表头。
 *
 * 这一版正文不持有数据，所以这里能断言的也只有结构：三栏都在、标题来自词典、
 * 工作区根有就显示、没有就换成说明。等 Remote 命名空间接进来，这个文件
 * 会先长出"栏里有内容"的那几条。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { WorkspaceBody, type WorkspaceBodyProps } from '../src/client/WorkspaceBody.tsx'
import { en, zh, type LcoderWorkspaceKey } from '../src/client/locales.ts'

afterEach(cleanup)

/**
 * 组一个正文的 props：文案走真词典，会话状态只给 `byId` 里的一条。
 * @param dict - 用哪本词典。
 * @param cwd - 这个会话的工作区目录；`undefined` 表示没有。
 * @returns 可直接交给组件的 props。
 */
function propsOf(dict: Record<LcoderWorkspaceKey, string>, cwd: string | undefined): WorkspaceBodyProps {
  const sessions = { byId: cwd === undefined ? {} : { 's-1': { cwd } } }
  return {
    t: makeTranslate(dict),
    sessionId: 's-1',
    useSessions: (selector: (state: typeof sessions) => unknown) => selector(sessions),
  } as unknown as WorkspaceBodyProps
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
    // 三栏都还是占位，不是数据。
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
})
