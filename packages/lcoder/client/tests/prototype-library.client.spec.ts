// @vitest-environment jsdom
/** T-310：内置 4 套组件素材库完整性、localStorage 容错持久化、CRUD 复制与提示词注入单测。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BUILTIN_PROTOTYPE_LIBRARIES,
  createCustomLibrary,
  DEFAULT_PROTOTYPE_LIBRARY_ID,
  deleteCustomLibrary,
  duplicatePrototypeLibrary,
  effectivePreviewHtml,
  loadPrototypeLibraryState,
  PROTOTYPE_DEFAULT_LIBRARY_STORAGE_KEY,
  PROTOTYPE_LIBRARIES_STORAGE_KEY,
  resolvePrototypeLibrary,
  saveCustomLibraries,
  setDefaultPrototypeLibraryId,
  updateCustomLibrary,
  type LibraryStorage,
} from '../src/prototype/libraries.ts'
import { buildPrototypePrompt } from '../src/prototype/prompt.ts'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('内置 4 套组件素材库', () => {
  it('包含 4 套差异化内置库且默认库为 heroui-glass', () => {
    expect(DEFAULT_PROTOTYPE_LIBRARY_ID).toBe('heroui-glass')
    expect(BUILTIN_PROTOTYPE_LIBRARIES.map(lib => lib.id)).toEqual([
      'heroui-glass',
      'enterprise-admin',
      'minimal-linear',
      'mobile-card',
    ])
    for (const lib of BUILTIN_PROTOTYPE_LIBRARIES) {
      expect(lib.builtin).toBe(true)
      expect(lib.name.trim().length).toBeGreaterThan(0)
      expect(lib.summary.trim().length).toBeGreaterThan(0)
      expect(lib.tags.length).toBeGreaterThanOrEqual(3)
      expect(lib.palette.length).toBeGreaterThanOrEqual(4)
      expect(lib.designTokens.trim().length).toBeGreaterThan(20)
      expect(lib.componentGuidelines.trim().length).toBeGreaterThan(20)
    }
  })

  it('每套内置库的 previewHtml 均为零 JS、零外链且可被 DOMParser 解析', () => {
    for (const lib of BUILTIN_PROTOTYPE_LIBRARIES) {
      const html = lib.previewHtml
      expect(html.toLowerCase()).toContain('<!doctype html>')
      expect(html).not.toMatch(/<script\b/i)
      expect(html).not.toMatch(/\bon[a-z]+\s*=/i)
      expect(html).not.toMatch(/javascript:/i)
      expect(html).not.toMatch(/https?:\/\//i)
      expect(html).not.toContain('//')

      const doc = new DOMParser().parseFromString(html, 'text/html')
      expect(doc.querySelector('nav')).not.toBeNull()
      expect(doc.querySelector('h1')).not.toBeNull()
      expect(doc.querySelector('button')).not.toBeNull()
      expect(doc.querySelector('input')).not.toBeNull()
      expect(doc.querySelector('table')).not.toBeNull()
    }
  })
})

describe('localStorage 读写与脏数据容错', () => {
  it('遇到损坏 JSON、非数组或残缺字段时不崩溃并过滤脏条目', () => {
    localStorage.setItem(PROTOTYPE_LIBRARIES_STORAGE_KEY, '{broken-json')
    localStorage.setItem(PROTOTYPE_DEFAULT_LIBRARY_STORAGE_KEY, 'unknown-id')

    const fromBroken = loadPrototypeLibraryState()
    expect(fromBroken.customLibraries).toEqual([])
    expect(fromBroken.libraries).toHaveLength(4)
    expect(fromBroken.defaultLibraryId).toBe('heroui-glass')

    localStorage.setItem(PROTOTYPE_LIBRARIES_STORAGE_KEY, JSON.stringify([
      null,
      123,
      { id: 'heroui-glass', name: '冒充内置', designTokens: 'a', componentGuidelines: 'b' },
      { id: 'missing-fields', name: '缺字段' },
      {
        id: 'custom-valid',
        name: '金融蓝白',
        summary: '稳健控制台',
        tags: ['后台', 42, '  表格  '],
        builtin: true,
        palette: ['#1D4ED8', '#FFFFFF'],
        designTokens: 'bg: #fff',
        componentGuidelines: '1. 细边框',
        previewHtml: '',
      },
      {
        id: 'custom-valid',
        name: '重复 ID 应被忽略',
        summary: '',
        tags: [],
        builtin: false,
        palette: [],
        designTokens: 'x',
        componentGuidelines: 'y',
        previewHtml: '',
      },
    ]))

    const filtered = loadPrototypeLibraryState()
    expect(filtered.customLibraries).toHaveLength(1)
    expect(filtered.customLibraries[0]).toMatchObject({
      id: 'custom-valid',
      name: '金融蓝白',
      builtin: false,
      tags: ['后台', '表格'],
    })
  })

  it('底层存储抛异常时安全回退到内置默认状态', () => {
    const throwingStore: LibraryStorage = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
    }
    const state = loadPrototypeLibraryState(throwingStore)
    expect(state.libraries).toHaveLength(4)
    expect(state.defaultLibraryId).toBe('heroui-glass')
    expect(() => saveCustomLibraries([], throwingStore)).not.toThrow()
    expect(setDefaultPrototypeLibraryId('enterprise-admin', throwingStore)).toBe('enterprise-admin')
  })
})

describe('自定义库增删改复制与默认库切换', () => {
  it('支持新建、复制、编辑、切换默认与删除，并保护内置库不可删除', () => {
    const { created } = createCustomLibrary({
      name: '医疗浅绿风',
      summary: '诊所工作站',
      tags: ['医疗', '表单'],
      palette: ['#059669', '#ECFDF5', '#064E3B'],
      designTokens: 'primary: #059669',
      componentGuidelines: '1. 圆角 10px',
      previewHtml: '',
    })
    expect(created.builtin).toBe(false)
    expect(effectivePreviewHtml(created)).not.toMatch(/<script\b/i)
    expect(effectivePreviewHtml(created)).toContain('医疗浅绿风')

    const enterprise = BUILTIN_PROTOTYPE_LIBRARIES[1]
    expect(enterprise).toBeDefined()
    if (enterprise === undefined) return
    const duplicated = duplicatePrototypeLibrary(enterprise, '企业中后台副本')
    expect(duplicated.created.builtin).toBe(false)
    expect(duplicated.created.designTokens).toBe(enterprise.designTokens)

    const updated = updateCustomLibrary(created.id, {
      name: '医疗浅绿 V2',
      summary: '升级版诊所工作站',
      tags: ['医疗'],
      palette: ['#10B981', '#FFFFFF'],
      designTokens: 'primary: #10B981',
      componentGuidelines: '1. 圆角 12px',
      previewHtml: '<!doctype html><html><body><nav>n</nav><h1>v2</h1></body></html>',
    })
    expect(resolvePrototypeLibrary(created.id, updated).name).toBe('医疗浅绿 V2')

    const switched = setDefaultPrototypeLibraryId(created.id)
    expect(switched).toBe(created.id)
    expect(loadPrototypeLibraryState().defaultLibraryId).toBe(created.id)

    // 删除内置库无效
    const afterDeleteBuiltin = deleteCustomLibrary('enterprise-admin')
    expect(afterDeleteBuiltin.libraries.some(lib => lib.id === 'enterprise-admin')).toBe(true)

    // 删除当前默认自定义库后自动回退到 heroui-glass
    const afterDeleteCustom = deleteCustomLibrary(created.id)
    expect(afterDeleteCustom.libraries.some(lib => lib.id === created.id)).toBe(false)
    expect(afterDeleteCustom.defaultLibraryId).toBe('heroui-glass')
  })
})

describe('buildPrototypePrompt 素材库注入与向后兼容', () => {
  it('未传 library 时向后兼容默认注入 heroui-glass 规范', () => {
    const prompt = buildPrototypePrompt({
      requirementId: 'REQ-01',
      requirementTitle: '工作台首页',
      requirementText: '需要展示指标卡与任务表格。',
      summary: undefined,
      refs: [],
    })
    expect(prompt).toContain('HeroUI + Glass')
    expect(prompt).toContain('prototype_draft')
    expect(prompt).toContain('自包含内联 `<script>`')
  })

  it('传入指定素材库时将名称、Tokens 与组件规范写入提示词，patch 模式同样携带 Token 约束', () => {
    const enterprise = BUILTIN_PROTOTYPE_LIBRARIES[1]
    expect(enterprise).toBeDefined()
    if (enterprise === undefined) return
    const fullPrompt = buildPrototypePrompt({
      requirementId: 'REQ-02',
      requirementTitle: '采购台账',
      requirementText: '筛选表单与审批表格。',
      summary: undefined,
      refs: [],
      library: enterprise,
    })
    expect(fullPrompt).toContain(enterprise.name)
    expect(fullPrompt).toContain(enterprise.designTokens)
    expect(fullPrompt).toContain(enterprise.componentGuidelines)
    expect(fullPrompt).toContain('prototype_draft')

    const patchPrompt = buildPrototypePrompt({
      requirementId: 'REQ-02',
      requirementTitle: '采购台账',
      requirementText: '筛选表单与审批表格。',
      summary: undefined,
      refs: [],
      library: enterprise,
      patch: {
        domPath: 'body > main > button',
        html: '<button>审批</button>',
        css: 'color: #fff',
        instruction: '改为企业蓝主按钮',
      },
    })
    expect(patchPrompt).toContain(enterprise.name)
    expect(patchPrompt).toContain(enterprise.designTokens)
    expect(patchPrompt).toContain('prototype_patch')
    expect(patchPrompt).not.toContain('prototype_draft')
  })
})
