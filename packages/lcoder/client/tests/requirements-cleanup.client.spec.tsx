// @vitest-environment jsdom
/** 需求页头不再显示来源行与投影诊断块；强调色按钮在默认蓝皮肤下为白字。 */
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequirementsPage } from '../src/pages/requirements.tsx'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const PROJECTION: SpecProjection = {
  tasks: [],
  rules: [],
  contracts: [],
  proposals: [],
  requirements: [],
  groups: [],
  roles: [],
  project: null,
  secrets: {},
  automation: null,
  agents: null,
  problems: [],
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

/** 读取渲染端样式源文件。 */
function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('需求页头清理', () => {
  it('不渲染来源行与投影诊断块', async () => {
    await act(async () => {
      root.render(
        <RequirementsPage
          project={PROJECT}
          projection={PROJECTION}
          sessions={[]}
          loading={false}
          error={null}
          intakeResult={null}
          onClearIntakeResult={() => {}}
          onReload={() => {}}
          onStartIntake={async () => ({ ok: true, message: 'ok' })}
          onStartSession={async () => ({ ok: true, message: 'ok' })}
          onOpenSession={() => {}}
          onOpenTasks={() => {}}
        />,
      )
    })
    expect(container.querySelector('.page-sub')).toBeNull()
    expect(container.querySelector('[data-testid="requirement-problems"]')).toBeNull()
    expect(container.querySelector('[data-testid="requirement-search"]')).not.toBeNull()
  })
})

describe('强调色按钮前景', () => {
  it('默认蓝皮肤下为白字并覆盖常态、悬停、按下、聚焦与禁用', () => {
    const styles = source('../src/styles.css')
    const rule = /#root \.pill-accent,[\s\S]*?\{[\s\S]*?\}/u.exec(styles)?.[0] ?? ''
    for (const selector of [
      '#root .pill-accent,',
      '#root .pill-accent:hover,',
      '#root .pill-accent:active,',
      '#root .pill-accent:focus,',
      '#root .pill-accent:focus-visible,',
      '#root .pill-accent:disabled,',
      '#root .segmented button.active',
    ]) {
      expect(rule).toContain(selector)
    }
    expect(rule).toContain('color: var(--lg-on-accent);')
    expect(source('../src/theme/liquid-glass.css')).toContain('--lg-on-accent: #ffffff;')
  })
})
