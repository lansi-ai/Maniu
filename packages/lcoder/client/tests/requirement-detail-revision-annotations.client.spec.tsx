// @vitest-environment jsdom
/** T-328/T-329 需求详情只读修改批注：开关与缓存、吸顶筛选条、逐块双栏配对与版本筛选。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirementDetail } from '../src/pages/requirement-detail.tsx'
import type { RequirementDocRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const V1 = `# 需求标题

## 背景
初版说明，将表单退回率降低 30% 以上。

## 验收
满足基本流程。
`

const V2 = `# 需求标题

## 背景
初版说明，将表单退回率降低 50% 以上。

## 验收
满足基本流程。

## 安全
需要记录操作人。
`

const V3 = `# 需求标题

## 背景
轻量说明，将表单退回率降低 50% 以上。

## 安全
需要记录操作人。
`

const ROW: RequirementDocRow = {
  id: 'REQ-01',
  title: '修改批注需求',
  text: V3,
  state: 'draft',
  options: [],
  versions: [
    { n: 1, at: '2026-11-18T09:00:00+08:00', note: '初稿' },
    { n: 2, at: '2026-11-19T10:00:00+08:00', note: '补充安全边界' },
    { n: 3, at: '2026-11-23T14:20:00+08:00', note: '细化背景并移除验收' },
  ],
  reviews: [],
}

const SINGLE: RequirementDocRow = {
  ...ROW,
  id: 'REQ-02',
  title: '单版本需求',
  text: V1,
  versions: [{ n: 1, at: '2026-11-18T09:00:00+08:00', note: '初稿' }],
}

const LONG_V1 = `# 长文需求

## 背景
${'甲'.repeat(200)}乙
`

const LONG_V2 = `# 长文需求

## 背景
${'甲'.repeat(200)}丙
`

const LONG_ROW: RequirementDocRow = {
  id: 'REQ-03',
  title: '长文需求',
  text: LONG_V2,
  state: 'draft',
  options: [],
  versions: [
    { n: 1, at: '2026-11-18T09:00:00+08:00', note: '初稿' },
    { n: 2, at: '2026-11-19T10:00:00+08:00', note: '改一处措辞' },
  ],
  reviews: [],
}

const SNAPSHOTS: Readonly<Record<string, string>> = {
  '.spec/requirements/REQ-01/versions/v1.md': V1,
  '.spec/requirements/REQ-01/versions/v2.md': V2,
  '.spec/requirements/REQ-01/versions/v3.md': V3,
  '.spec/requirements/REQ-03/versions/v1.md': LONG_V1,
  '.spec/requirements/REQ-03/versions/v2.md': LONG_V2,
}

function projectionOf(row: RequirementDocRow): SpecProjection {
  return {
    tasks: [],
    rules: [],
    contracts: [],
    proposals: [],
    requirements: [row],
    groups: [],
    roles: [],
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    problems: [],
  }
}

let container: HTMLDivElement
let root: Root
let readPaths: string[]

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  readPaths = []
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(async (_namespace: string, _method: string, args: { readonly path: string }) => {
        readPaths.push(args.path)
        const text = SNAPSHOTS[args.path] ?? '# 评审报告'
        return { ok: true, value: { text } }
      }),
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
})

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

function all(testId: string): readonly Element[] {
  return [...container.querySelectorAll(`[data-testid="${testId}"]`)]
}

async function renderDetail(row: RequirementDocRow): Promise<void> {
  act(() => {
    root.render(
      <RequirementDetail
        row={row}
        project={PROJECT}
        projection={projectionOf(row)}
        sessions={[]}
        onClose={() => {}}
        onOpenTask={() => {}}
        onOpenReader={() => {}}
        onReload={() => {}}
        onSplit={async () => ({ ok: true, message: 'ok' })}
        onReview={async () => ({ ok: true, message: 'ok' })}
        onRevise={async () => ({ ok: true, message: 'ok' })}
        onModifyRequest={() => {}}
        onCreateBased={async () => ({ ok: true, message: 'ok' })}
        onOpenTasks={() => {}}
      />,
    )
  })
  await settle()
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

async function press(node: Element | null): Promise<void> {
  expect(node).not.toBeNull()
  await act(async () => {
    (node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('批注开关', () => {
  it('单版本且无修改记录时隐藏开关', async () => {
    await renderDetail(SINGLE)
    expect(element('requirement-annotation-toggle')).toBeNull()
    expect(element('requirement-annotation-track')).toBeNull()
  })

  it('多版本默认关闭，点开后按需并发读取快照并渲染双栏', async () => {
    await renderDetail(ROW)
    const toggle = element('requirement-annotation-toggle')
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-pressed')).toBe('false')
    expect(toggle?.getAttribute('aria-label')).toContain('修改批注')
    expect(readPaths.filter(path => path.includes('/versions/'))).toEqual([])

    await press(toggle)
    expect(element('requirement-annotation-toggle')?.getAttribute('aria-pressed')).toBe('true')
    expect(element('requirement-annotation-track')).not.toBeNull()
    expect(readPaths.filter(path => path.includes('/versions/'))).toEqual([
      '.spec/requirements/REQ-01/versions/v1.md',
      '.spec/requirements/REQ-01/versions/v2.md',
      '.spec/requirements/REQ-01/versions/v3.md',
    ])
    expect(all('requirement-annotation-block').length).toBeGreaterThan(0)
    expect(all('requirement-annotation-card').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-testid="requirement-document-body"] .revision-annotated-body')).not.toBeNull()
    expect(container.querySelector('[data-testid="requirement-annotation-segments"] del')).not.toBeNull()
    expect(container.querySelector('[data-testid="requirement-annotation-segments"] ins')).not.toBeNull()
  })

  it('同一需求关闭再开启复用缓存，不重复读盘', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    const reads = readPaths.filter(path => path.includes('/versions/')).length
    await press(element('requirement-annotation-toggle'))
    expect(element('requirement-annotation-track')).toBeNull()
    await press(element('requirement-annotation-toggle'))
    expect(element('requirement-annotation-track')).not.toBeNull()
    expect(readPaths.filter(path => path.includes('/versions/')).length).toBe(reads)
  })
})

describe('正文高亮与批注卡', () => {
  it('新增/修改块有左侧色条，删除内容在锚点处给出标记', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    expect(container.querySelector('[data-testid="requirement-annotation-block"].is-added')).not.toBeNull()
    expect(container.querySelector('[data-testid="requirement-annotation-block"].is-modified')).not.toBeNull()
    expect(all('requirement-annotation-deleted')).toHaveLength(1)
    expect(all('requirement-annotation-deleted')[0]?.textContent).toContain('删除了 2 处内容')
    expect(all('requirement-annotation-kind').map(node => node.textContent)).toContain('删除')
  })

  it('同一段多版修改默认只展示最新一条，可展开看演进', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    const historyToggle = element('requirement-annotation-history-toggle')
    expect(historyToggle?.textContent).toContain('展开更早 1 次修改')
    expect(all('requirement-annotation-earlier')).toHaveLength(0)
    await press(historyToggle)
    expect(all('requirement-annotation-earlier')).toHaveLength(1)
  })

  it('短片段不渲染折叠按钮', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    expect(element('requirement-annotation-segment-toggle')).toBeNull()
  })

  it('长片段按字数折叠，展开后显示全部并可再收起', async () => {
    await renderDetail(LONG_ROW)
    await press(element('requirement-annotation-toggle'))
    const toggles = all('requirement-annotation-segment-toggle')
    expect(toggles).toHaveLength(1)
    expect(toggles[0]?.getAttribute('aria-expanded')).toBe('false')
    expect(toggles[0]?.textContent).toContain('展开全文')
    const folded = element('requirement-annotation-segments')
    expect(folded?.textContent).toContain('片段已折叠')
    expect(folded?.textContent).toContain('…')
    expect(folded?.textContent).not.toContain('丙')

    await press(toggles[0] ?? null)
    const expandedToggle = element('requirement-annotation-segment-toggle')
    expect(expandedToggle?.getAttribute('aria-expanded')).toBe('true')
    expect(expandedToggle?.textContent).toContain('收起')
    const unfolded = element('requirement-annotation-segments')
    expect(unfolded?.textContent).toContain('丙')
    expect(unfolded?.textContent).not.toContain('片段已折叠')

    await press(expandedToggle)
    expect(element('requirement-annotation-segment-toggle')?.textContent).toContain('展开全文')
    expect(element('requirement-annotation-segments')?.textContent).not.toContain('丙')
  })
})

describe('逐块双栏布局', () => {
  function rowOf(selector: string): Element | null {
    return container.querySelector(selector)?.closest('[data-testid="requirement-annotation-row"]') ?? null
  }

  it('批注卡与对应修改段同处一行，筛选条不再集中堆卡', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    const row = rowOf('[data-testid="requirement-annotation-block"].is-modified')
    expect(row).not.toBeNull()
    const block = row?.querySelector('[data-testid="requirement-annotation-block"]')
    const cards = row?.querySelectorAll('[data-testid="requirement-annotation-row-cards"] [data-testid="requirement-annotation-card"]')
    const cardIds = [...(cards ?? [])].map(node => node.getAttribute('data-annotation-id'))
    expect(cardIds.length).toBeGreaterThan(0)
    expect(cardIds).toContain(block?.getAttribute('data-annotation-id'))
    expect(element('requirement-annotation-track')?.querySelector('[data-testid="requirement-annotation-card"]')).toBeNull()
  })

  it('未修改段落所在行右侧留白，不渲染空卡片容器', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    const plainRows = all('requirement-annotation-row').filter(row =>
      row.querySelector('[data-testid="requirement-annotation-block"]') === null
      && row.querySelector('[data-testid="requirement-annotation-deleted"]') === null)
    expect(plainRows.length).toBeGreaterThan(0)
    for (const row of plainRows) {
      expect(row.querySelector('[data-testid="requirement-annotation-card"]')).toBeNull()
      expect(row.querySelector('[data-testid="requirement-annotation-row-cards"]')).toBeNull()
    }
  })

  it('版本切换只让对应版本的卡出现在所属行', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    expect(rowOf('[data-testid="requirement-annotation-block"].is-added')?.querySelector('[data-testid="requirement-annotation-card"]')).not.toBeNull()
    expect(rowOf('[data-testid="requirement-annotation-deleted"]')?.querySelector('[data-testid="requirement-annotation-card"]')).not.toBeNull()

    await press(container.querySelector('[data-testid="requirement-annotation-filter"][data-version="2"]'))
    expect(rowOf('[data-testid="requirement-annotation-block"].is-added')?.querySelector('[data-testid="requirement-annotation-card"]')).not.toBeNull()
    expect(all('requirement-annotation-deleted')).toHaveLength(0)

    await press(container.querySelector('[data-testid="requirement-annotation-filter"][data-version="3"]'))
    expect(rowOf('[data-testid="requirement-annotation-block"].is-added')?.querySelector('[data-testid="requirement-annotation-card"]')).toBeNull()
    const markerRow = rowOf('[data-testid="requirement-annotation-deleted"]')
    expect(markerRow).not.toBeNull()
    expect(markerRow?.querySelector('[data-testid="requirement-annotation-card"]')).not.toBeNull()
  })

  it('版本筛选条吸顶在抽屉滚动容器的正文之前，不随文档卡片一起滚动', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    const bar = element('requirement-annotation-filter-bar')
    expect(bar).not.toBeNull()
    expect(bar?.closest('[data-testid="requirement-document-body"]')).toBeNull()
    expect(bar?.closest('.detail-drawer-body')).not.toBeNull()
    expect(element('requirement-annotation-match')?.textContent).toContain('4')
  })
})

describe('双向联动与筛选', () => {
  it('点正文高亮块选中右侧卡，点右侧卡选中正文块', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    const modified = container.querySelector('[data-testid="requirement-annotation-block"].is-modified')
    expect(modified).not.toBeNull()
    const id = modified?.getAttribute('data-annotation-id') ?? ''
    await press(modified)
    const card = container.querySelector(`[data-annotation-id="${id}"][data-annotation-side="track"]`)
    expect(card?.className).toContain('is-selected')

    const deletedCard = all('requirement-annotation-card').find(node => node.getAttribute('data-change') === 'removed')
    expect(deletedCard).not.toBeNull()
    await press(deletedCard ?? null)
    const marker = container.querySelector(
      `[data-annotation-id="${deletedCard?.getAttribute('data-annotation-id') ?? ''}"][data-annotation-side="body"]`,
    )
    expect(marker?.className).toContain('is-selected')
  })

  it('版本胶囊切换只保留对应版本的批注与高亮', async () => {
    await renderDetail(ROW)
    await press(element('requirement-annotation-toggle'))
    expect(element('requirement-annotation-filter')?.textContent).toContain('全部')
    const allCards = all('requirement-annotation-card').length
    await press(container.querySelector('[data-testid="requirement-annotation-filter"][data-version="2"]'))
    const v2Cards = all('requirement-annotation-card')
    expect(v2Cards.length).toBeLessThan(allCards)
    expect(v2Cards.every(node => node.getAttribute('data-change') !== 'removed')).toBe(true)
    expect(container.querySelectorAll('[data-testid="requirement-annotation-block"].is-visible').length).toBeGreaterThan(0)

    await press(container.querySelector('[data-testid="requirement-annotation-filter"][data-version="3"]'))
    expect(container.querySelectorAll('[data-testid="requirement-annotation-block"].is-visible').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-testid="requirement-annotation-block"].is-filtered-out').length).toBeGreaterThan(0)
    expect(all('requirement-annotation-deleted').length).toBe(1)
  })
})
