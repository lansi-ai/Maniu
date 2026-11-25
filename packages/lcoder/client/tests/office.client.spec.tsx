// @vitest-environment jsdom
/** 办公室页面：展示派生/新建项目成员、默认折叠提示词与工作记录、图标展开与招募面板。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translate, type Translate } from '../src/locale.ts'
import { OfficePage, splitMemberName } from '../src/pages/office.tsx'
import { roleLabel } from '../src/spec/board.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { TalentsHandle } from '../src/talents/use-talents.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const t: Translate = (key, params) => translate('zh', key, params)

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
  tasks: [
    {
      id: 'T-01',
      title: '完成登录页面',
      state: 'closed',
      grade: 'B',
      description: '',
      paths: [],
      irreversible: [],
      evidence: [],
      rules: [],
      dependsOn: [],
      attachments: [],
      role: 'pm-jason',
    },
  ],
  contracts: [],
  deliverables: [],
  roles: [
    {
      id: 'pm-jason',
      name: '项目经理-Jason',
      inherits: 'pm',
      derivedFrom: '慢牛项目经理',
      persona: '负责推进产品需求与排期。',
    },
    {
      id: 'fe-dev',
      name: '前端工程师-林夕',
      inherits: 'dev',
      derivedFrom: '实施',
      persona: '负责前端页面实现。',
    },
    {
      id: 'qa-su',
      name: '测试工程师-苏晴',
      inherits: 'dev',
      derivedFrom: '实施',
    },
  ],
  rules: [],
  flow: null,
  automation: null,
  env: null,
  issues: [],
}

const TALENTS: TalentsHandle = {
  catalog: null,
  catalogError: null,
  project: null,
  projectError: null,
  global: [],
  projectTalents: [],
  builtins: [
    { id: 'maniu-pm', name: '慢牛项目经理', description: '系统内置项目经理', isDefault: false },
  ],
  builtinsLoading: false,
  builtinsError: null,
  builtinDetails: {},
  loading: false,
  error: null,
  applyErrors: {},
  applied: new Set(),
  busy: false,
  presetNames: {},
  reload: vi.fn(),
  create: vi.fn().mockResolvedValue(null),
  update: vi.fn().mockResolvedValue(null),
  remove: vi.fn().mockResolvedValue(null),
  checkRefs: vi.fn().mockResolvedValue({ ok: true, sessionIds: [] }),
  inspectBuiltin: vi.fn(),
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

describe('OfficePage', () => {
  it('展示中文成员与派生标注，提示词和工作记录默认折叠并在点击图标后展开', async () => {
    await act(async () => {
      root.render(
        <OfficePage
          t={t}
          project={PROJECT}
          projection={PROJECTION}
          sessions={[]}
          talents={TALENTS}
          onReload={vi.fn()}
        />,
      )
    })

    const nameEl = container.querySelector('[data-testid="office-member-name-pm-jason"]')
    const roleEl = container.querySelector('[data-testid="office-member-role-pm-jason"]')
    expect(nameEl?.textContent).toBe('Jason')
    expect(roleEl?.textContent).toBe('项目经理')
    const card = container.querySelector('[data-testid="office-member-card"][data-member-id="pm-jason"]')
    expect(card?.textContent).toContain('派生自 慢牛项目经理')
    expect(container.querySelector('[data-testid="office-prompt-panel-pm-jason"]')).toBeNull()
    expect(container.querySelector('[data-testid="office-work-panel-pm-jason"]')).toBeNull()

    const promptToggle = container.querySelector('[data-testid="office-prompt-toggle-pm-jason"]') as HTMLButtonElement
    const workToggle = container.querySelector('[data-testid="office-work-toggle-pm-jason"]') as HTMLButtonElement

    await act(async () => {
      promptToggle.click()
      workToggle.click()
    })

    expect(container.querySelector('[data-testid="office-prompt-panel-pm-jason"]')?.textContent).toContain('负责推进产品需求与排期')
    expect(container.querySelector('[data-testid="office-prompt-panel-pm-jason"]')?.textContent).not.toContain('权限')
    expect(container.querySelector('[data-testid="office-member-bio-pm-jason"]')).toBeNull()
    expect(container.querySelector('[data-testid="office-work-panel-pm-jason"]')?.textContent).toContain('T-01')
    expect(container.querySelector('[data-testid="office-work-panel-pm-jason"]')?.textContent).toContain('完成登录页面')
  })

  it('支持在派生模式与新建项目人才模式之间切换，且不显示继承开发工程师', async () => {
    await act(async () => {
      root.render(
        <OfficePage
          t={t}
          project={PROJECT}
          projection={PROJECTION}
          sessions={[]}
          talents={TALENTS}
          onReload={vi.fn()}
        />,
      )
    })

    const recruitBtn = container.querySelector('[data-testid="office-recruit-toggle"]') as HTMLButtonElement
    await act(async () => {
      recruitBtn.click()
    })
    expect(container.querySelector('[data-testid="office-source-select"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="office-inherit-select"]')).toBeNull()

    const createTab = container.querySelector('[data-testid="office-mode-create"]') as HTMLButtonElement
    await act(async () => {
      createTab.click()
    })
    expect(container.querySelector('[data-testid="office-source-select"]')).toBeNull()
    expect(container.querySelector('[data-testid="office-inherit-select"]')).not.toBeNull()
  })

  it('按职能分类分组与筛选成员，并支持姓名/岗位拆分', async () => {
    expect(splitMemberName('前端工程师-林夕')).toEqual({ personName: '林夕', roleTitle: '前端工程师' })

    await act(async () => {
      root.render(
        <OfficePage
          t={t}
          project={PROJECT}
          projection={PROJECTION}
          sessions={[]}
          talents={TALENTS}
          onReload={vi.fn()}
        />,
      )
    })

    expect(container.querySelector('[data-testid="office-group-product"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="office-group-dev"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="office-group-qa"]')).not.toBeNull()

    const qaPill = container.querySelector('[data-testid="office-cat-qa"]') as HTMLButtonElement
    await act(async () => {
      qaPill.click()
    })
    const cards = [...container.querySelectorAll('[data-testid="office-member-card"]')]
    expect(cards).toHaveLength(1)
    expect(cards[0]?.getAttribute('data-member-id')).toBe('qa-su')
  })

  it('roleLabel 将英文 id 映射为中文名称', () => {
    expect(roleLabel('pm-jason', PROJECTION.roles)).toBe('项目经理')
    expect(roleLabel('dev', PROJECTION.roles)).toBe('开发工程师')
  })
})
