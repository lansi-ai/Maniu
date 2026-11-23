// @vitest-environment node
/** T-305：四维 S / M / L 变更分流纯函数与双语词典覆盖测试。 */
import { describe, expect, it } from 'vitest'
import {
  actionKindForLevel,
  docImpactForLevel,
  isTriageLevelAllowed,
  triageRequirementChange,
} from '../src/intake/change-triage.ts'
import { EN } from '../src/locale-en.ts'
import { ZH } from '../src/locale-zh.ts'
import type { RequirementDocRow } from '../src/spec/rows.ts'

const DRAFT_REQ: Pick<RequirementDocRow, 'id' | 'state' | 'title'> = {
  id: 'REQ-01',
  title: '报销管理',
  state: 'draft',
}

const CONFIRMED_REQ: Pick<RequirementDocRow, 'id' | 'state' | 'title'> = {
  id: 'REQ-01',
  title: '报销管理',
  state: 'confirmed',
}

const RELEASED_REQ: Pick<RequirementDocRow, 'id' | 'state' | 'title'> = {
  id: 'REQ-01',
  title: '报销管理',
  state: 'released',
}

const CLOSED_REQ: Pick<RequirementDocRow, 'id' | 'state' | 'title'> = {
  id: 'REQ-01',
  title: '报销管理',
  state: 'closed',
}

describe('四维 S / M / L 变更分流纯函数', () => {
  it('生命周期维度：draft 目标直接走草稿修改通道', () => {
    const result = triageRequirementChange({
      description: '报销表单加个发票号字段',
      target: DRAFT_REQ,
      projectKind: 'web',
    })
    expect(result.level).toBe('draft')
    expect(result.actionKind).toBe('draft_patch')
    expect(result.reasons).toEqual(['triage.reason.draftTarget'])
    expect(result.docImpact).toEqual(docImpactForLevel('draft'))
  })

  it('技术轨与架构维度：未启用桌面端时提出加入桌面版直接判 L 级', () => {
    const result = triageRequirementChange({
      description: '开发到一半，我想加入 Windows 桌面版',
      target: CONFIRMED_REQ,
      projectKind: 'web',
      tasks: [{ track: 'h5' }, { track: 'api' }],
    })
    expect(result.level).toBe('L')
    expect(result.actionKind).toBe('milestone')
    expect(result.reasons).toContain('triage.reason.newTrack')
  })

  it('技术轨维度：桌面端已启用时，桌面端表单微调不误判为新轨 L 级', () => {
    const result = triageRequirementChange({
      description: '桌面端报销表单加个发票号字段',
      target: CONFIRMED_REQ,
      projectKind: 'desktop',
      tasks: [{ track: 'desktop' }],
    })
    expect(result.level).toBe('S')
    expect(result.actionKind).toBe('amend')
  })

  it('技术轨与架构维度：接入第三方支付或外部数据库判 L 级', () => {
    const result = triageRequirementChange({
      description: '接入微信支付与外部数据库同步',
      target: CONFIRMED_REQ,
      projectKind: 'web',
    })
    expect(result.level).toBe('L')
    expect(result.actionKind).toBe('milestone')
    expect(result.reasons).toContain('triage.reason.architectureScope')
  })

  it('未绑定目标需求时路由为独立里程碑 L 级', () => {
    const result = triageRequirementChange({
      description: '新增一个独立的发票验真模块',
      target: null,
      projectKind: 'web',
    })
    expect(result.level).toBe('L')
    expect(result.actionKind).toBe('milestone')
    expect(result.reasons).toContain('triage.reason.noTarget')
  })

  it('验收契约与不可逆维度：核心业务规则、计费、权限或表结构/不可逆判 M 级', () => {
    const ruleResult = triageRequirementChange({
      description: '修改已确认的退款冲减计费口径与权限控制',
      target: CONFIRMED_REQ,
      projectKind: 'web',
    })
    expect(ruleResult.level).toBe('M')
    expect(ruleResult.actionKind).toBe('delta')
    expect(ruleResult.reasons).toContain('triage.reason.coreRuleOrSchema')

    const irreversibleResult = triageRequirementChange({
      description: '修改数据库表结构并做不可逆数据迁移',
      target: CONFIRMED_REQ,
      projectKind: 'web',
    })
    expect(irreversibleResult.level).toBe('M')
    expect(irreversibleResult.reasons).toContain('triage.reason.irreversibleRisk')
  })

  it('生命周期维度：已上线或已关闭需求不走 S 级免审补丁，至少判 M 级', () => {
    for (const target of [RELEASED_REQ, CLOSED_REQ]) {
      const result = triageRequirementChange({
        description: '调整列表按钮文案与排序',
        target,
        projectKind: 'web',
      })
      expect(result.level).toBe('M')
      expect(result.actionKind).toBe('delta')
      expect(result.reasons).toContain('triage.reason.sealedTarget')
    }
  })

  it('影响范围维度：已确认需求上的局部字段/文案/排序微调判 S 级', () => {
    const result = triageRequirementChange({
      description: '报销表单加个发票号字段，调整提交按钮文案',
      target: CONFIRMED_REQ,
      projectKind: 'web',
      tracks: [{ id: 'billing', name: '账务' }],
    })
    expect(result.level).toBe('S')
    expect(result.actionKind).toBe('amend')
    expect(result.reasons).toEqual(['triage.reason.localScope'])
    expect(result.docImpact).toEqual(docImpactForLevel('S'))
  })

  it('所有返回的 reasons 与 docImpact 键均在中英文双语词典中完整存在', () => {
    for (const level of ['draft', 'S', 'M', 'L'] as const) {
      const impact = docImpactForLevel(level)
      expect(actionKindForLevel(level)).toBeDefined()
      for (const key of [...impact.willUpdate, ...impact.willKeep]) {
        expect(ZH[key]).toBeTruthy()
        expect(EN[key]).toBeTruthy()
      }
    }
    const samples = [
      triageRequirementChange({ description: '改草稿', target: DRAFT_REQ }),
      triageRequirementChange({ description: '加个字段', target: CONFIRMED_REQ }),
      triageRequirementChange({ description: '改计费权限与不可逆删表', target: CONFIRMED_REQ }),
      triageRequirementChange({ description: '已上线调整', target: RELEASED_REQ }),
      triageRequirementChange({ description: '加入桌面版与微信支付', target: CONFIRMED_REQ }),
      triageRequirementChange({ description: '独立需求', target: null }),
    ]
    for (const sample of samples) {
      for (const key of sample.reasons) {
        expect(ZH[key]).toBeTruthy()
        expect(EN[key]).toBeTruthy()
      }
    }
  })

  it('手动改选级别准入判定：S 仅限 confirmed，M 需已确认或终态需求，L 始终允许', () => {
    expect(isTriageLevelAllowed('S', CONFIRMED_REQ).allowed).toBe(true)
    expect(isTriageLevelAllowed('S', RELEASED_REQ)).toEqual({ allowed: false, reasonKey: 'triage.sDisabledReason' })
    expect(isTriageLevelAllowed('S', DRAFT_REQ).allowed).toBe(false)
    expect(isTriageLevelAllowed('S', null).allowed).toBe(false)

    expect(isTriageLevelAllowed('M', CONFIRMED_REQ).allowed).toBe(true)
    expect(isTriageLevelAllowed('M', RELEASED_REQ).allowed).toBe(true)
    expect(isTriageLevelAllowed('M', DRAFT_REQ).allowed).toBe(false)
    expect(isTriageLevelAllowed('M', null)).toEqual({ allowed: false, reasonKey: 'triage.mDisabledReason' })

    expect(isTriageLevelAllowed('L', null).allowed).toBe(true)
    expect(isTriageLevelAllowed('L', DRAFT_REQ).allowed).toBe(true)
  })

  it('评审锁定草稿：带未决评审的 draft 禁止原地改稿，返回锁定原因且 L 级仍允许独立立项', () => {
    const lockedDraft = {
      id: 'REQ-01',
      title: '评审中的草稿',
      state: 'draft' as const,
      versions: [{ n: 1, at: '2026-11-20T09:00:00+08:00' }],
      reviews: [{ round: 1, at: '2026-11-20T10:00:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', decision: 'pending' as const }],
    }
    const result = triageRequirementChange({
      description: '补充一个表单字段',
      target: lockedDraft,
      projectKind: 'web',
    })
    expect(result.level).toBe('draft')
    expect(result.reasons).toEqual(['triage.reason.draftLocked'])
    expect(isTriageLevelAllowed('draft', lockedDraft)).toEqual({
      allowed: false,
      reasonKey: 'triage.draftLockedReason',
    })
    expect(isTriageLevelAllowed('S', lockedDraft).allowed).toBe(false)
    expect(isTriageLevelAllowed('M', lockedDraft).allowed).toBe(false)
    expect(isTriageLevelAllowed('L', lockedDraft).allowed).toBe(true)

    const unlockedAfterRevise = {
      ...lockedDraft,
      versions: [
        { n: 1, at: '2026-11-20T09:00:00+08:00' },
        { n: 2, at: '2026-11-20T12:00:00+08:00' },
      ],
      reviews: [{ round: 1, at: '2026-11-20T10:00:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', decision: 'accepted' as const }],
    }
    expect(isTriageLevelAllowed('draft', unlockedAfterRevise).allowed).toBe(true)
  })
})
