// @vitest-environment jsdom
/** 需求页头不再显示来源行与投影诊断块；强调色按钮统一使用官方强调色前景。 */
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
  it('官方 HeroUI 按钮承载强调色前景，旧胶囊样式已移除', () => {
    const styles = source('../src/styles.css')
    expect(styles).not.toContain('pill-accent')
    expect(styles).toContain('#root .segmented button.active')
    expect(styles).toContain('color: var(--accent-foreground);')
    expect(source('../src/index.css')).toContain('@import "@heroui/styles";')
  })
})
