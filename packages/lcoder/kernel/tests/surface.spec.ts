import { describe, expect, it, vi } from 'vitest'

import { ROLE_TOOLS, ROLES, SURFACE, UNSCOPEED_SURFACE, SurfaceSwitcher, allowedTools, allToolNames, checkSurface, parseRole } from '../src/kernel/surface.js'
import type { TaskState } from '../src/schema/spec.js'

const STATES: TaskState[] = ['drafting', 'contracted', 'implementing', 'verifying', 'closed']

function makeGate() {
  const lifts: Array<ReturnType<typeof vi.fn>> = []
  const restrict = vi.fn(() => {
    const lift = vi.fn()
    lifts.push(lift)
    return lift
  })
  return { gate: { restrict }, restrict, lifts }
}

describe('工具面', () => {
  it('起草态没有写代码与跑命令的能力', () => {
    const t = SURFACE.drafting
    expect(t).toContain('contract_draft')
    expect(t).not.toContain('file_edit')
    expect(t).not.toContain('cmd_run')
    expect(t).not.toContain('task_close')
  })

  it('签约后解锁编辑与命令，但还不能收口', () => {
    expect(SURFACE.contracted).toContain('file_edit')
    expect(SURFACE.contracted).toContain('cmd_run')
    expect(SURFACE.contracted).not.toContain('task_close')
  })

  it('验证态才多出收口', () => {
    expect(SURFACE.verifying).toContain('task_close')
  })

  it('终态只读', () => {
    expect(SURFACE.closed).toEqual(['file_read', 'file_list', 'spec_query', 'task_read', 'git_status', 'git_diff'])
    expect(SURFACE.closed).not.toContain('file_edit')
    expect(SURFACE.closed).not.toContain('task_close')
  })

  it('能力只增不减：每往后一个状态都包含前一个的全部工具', () => {
    const chain: TaskState[] = ['drafting', 'contracted', 'implementing', 'verifying']
    for (let i = 1; i < chain.length; i++) {
      const prev = new Set(SURFACE[chain[i - 1]!])
      const cur = SURFACE[chain[i]!]
      for (const tool of prev) expect(cur).toContain(tool)
    }
  })
})

describe('SurfaceSwitcher', () => {
  it('切状态时先解除旧掩码，再挂新掩码', () => {
    const { gate, restrict, lifts } = makeGate()
    const sw = new SurfaceSwitcher(gate)

    sw.apply('drafting')
    expect(restrict).toHaveBeenCalledTimes(1)
    expect(restrict).toHaveBeenLastCalledWith({ allow: SURFACE.drafting })

    sw.apply('contracted')
    expect(restrict).toHaveBeenCalledTimes(2)
    expect(lifts[0]).toHaveBeenCalledTimes(1)
    expect(sw.current).toBe('contracted')
  })

  it('同状态重复 apply 是空操作（换掩码要付缓存代价）', () => {
    const { gate, restrict } = makeGate()
    const sw = new SurfaceSwitcher(gate)

    sw.apply('implementing')
    sw.apply('implementing')
    sw.apply('implementing')

    expect(restrict).toHaveBeenCalledTimes(1)
  })

  it('dispose 解除当前掩码，之后不能再切', () => {
    const { gate, lifts } = makeGate()
    const sw = new SurfaceSwitcher(gate)

    sw.apply('verifying')
    sw.dispose()

    expect(lifts[0]).toHaveBeenCalledTimes(1)
    expect(() =>{  sw.apply('closed') }).toThrow(/已销毁/)
  })

  it('没挂过掩码时 dispose 不炸', () => {
    const { gate } = makeGate()
    expect(() =>{  new SurfaceSwitcher(gate).dispose() }).not.toThrow()
  })
})

describe('掩码自检', () => {
  it('清单齐全时无告警', () => {
    const check = checkSurface(allToolNames())
    expect(check).toEqual({ missing: [], orphan: [] })
  })

  it('掩码里写了但没注册 → missing；注册了但哪都看不到 → orphan', () => {
    const registered = allToolNames().filter(n => n !== 'file_edit').concat('debug_dump')
    const check = checkSurface(registered)
    expect(check.missing).toEqual(['file_edit'])
    expect(check.orphan).toEqual(['debug_dump'])
  })

  it('每个状态至少提供一个工具（空掩码会被 DSH 拒绝）', () => {
    for (const s of STATES) expect(SURFACE[s].length).toBeGreaterThan(0)
    expect(UNSCOPEED_SURFACE.length).toBeGreaterThan(0)
  })

  it('自检把空看板面的工具也算作已声明，不报 orphan', () => {
    expect(checkSurface(allToolNames())).toEqual({ missing: [], orphan: [] })
  })
})

describe('空看板工具面', () => {
  it('只放开立项需要的读取、建任务与立项落盘能力，外加出方案、起草与改写需求', () => {
    expect(UNSCOPEED_SURFACE).toEqual(['file_read', 'file_list', 'project_draft', 'spec_query', 'spec_draft', 'task_read', 'task_draft', 'proposal_draft', 'requirement_draft', 'requirement_revise', 'requirement_propose', 'requirement_patch_propose', 'requirement_review_draft', 'requirement_split_plan', 'git_status', 'git_diff'])
    expect(UNSCOPEED_SURFACE).not.toContain('file_edit')
    expect(UNSCOPEED_SURFACE).not.toContain('cmd_run')
    expect(UNSCOPEED_SURFACE).not.toContain('spec_bind')
    expect(UNSCOPEED_SURFACE).not.toContain('contract_draft')
    expect(UNSCOPEED_SURFACE).not.toContain('task_close')
  })

  it('allowedTools 无任务时给空看板面，有任务时按状态表', () => {
    expect(allowedTools(null)).toEqual(UNSCOPEED_SURFACE)
    expect(allowedTools('drafting')).toEqual(SURFACE.drafting)
  })

  it('空看板面是起草面的子集：立完项能力只增不减', () => {
    for (const tool of UNSCOPEED_SURFACE) expect(SURFACE.drafting).toContain(tool)
  })

  it('task_draft 在起草到验证的每个状态都可见，终态 closed 不放', () => {
    for (const s of ['drafting', 'contracted', 'implementing', 'verifying'] as TaskState[]) {
      expect(SURFACE[s]).toContain('task_draft')
    }
    expect(SURFACE.closed).not.toContain('task_draft')
  })

  it('project_draft 与 spec_draft 跟着 task_draft 一起放开，终态 closed 不放', () => {
    for (const s of ['drafting', 'contracted', 'implementing', 'verifying'] as TaskState[]) {
      expect(SURFACE[s]).toContain('project_draft')
      expect(SURFACE[s]).toContain('spec_draft')
    }
    expect(SURFACE.closed).not.toContain('project_draft')
    expect(SURFACE.closed).not.toContain('spec_draft')
  })
})

describe('角色天花板', () => {
  it('实施角色等于全集去掉只对特定角色开放的工具', () => {
    const roleOnly = ['role_draft', 'requirement_draft', 'requirement_revise', 'requirement_propose', 'requirement_patch_propose', 'requirement_review_draft', 'requirement_split_plan']
    expect([...ROLE_TOOLS.dev].sort()).toEqual(
      allToolNames().filter(name => !roleOnly.includes(name)),
    )
  })

  it('requirement_draft 只进需求分析师，终态不可见，三条需求命令永远不在工具面', () => {
    expect(ROLE_TOOLS.intake).toContain('requirement_draft')
    for (const role of ROLES) {
      if (role === 'intake') continue
      expect(ROLE_TOOLS[role]).not.toContain('requirement_draft')
    }
    expect(allowedTools('drafting', 'intake')).toContain('requirement_draft')
    expect(allowedTools('closed', 'intake')).not.toContain('requirement_draft')
    for (const state of [...STATES, null] as const) {
      for (const name of ['requirement_approve', 'requirement_release', 'requirement_close', 'requirement_review_decide']) {
        expect(allowedTools(state, null)).not.toContain(name)
      }
    }
    for (const tools of Object.values(ROLE_TOOLS)) expect(tools).not.toContain('requirement_approve')
  })

  it('改稿只进需求分析师，评审只进项目经理与研发经理，两者都不含过审能力', () => {
    expect(ROLE_TOOLS.intake).toContain('requirement_revise')
    expect(ROLE_TOOLS.pm).toContain('requirement_review_draft')
    expect(ROLE_TOOLS.manager).toContain('requirement_review_draft')
    for (const role of ROLES) {
      if (role !== 'intake') expect(ROLE_TOOLS[role]).not.toContain('requirement_revise')
      if (role !== 'pm' && role !== 'manager') expect(ROLE_TOOLS[role]).not.toContain('requirement_review_draft')
    }
    expect(allowedTools('drafting', 'intake')).toContain('requirement_revise')
    expect(allowedTools(null, 'intake')).toContain('requirement_revise')
    expect(allowedTools('drafting', 'pm')).toContain('requirement_review_draft')
    expect(allowedTools(null, 'pm')).toContain('requirement_review_draft')
    expect(allowedTools('drafting', 'manager')).toContain('requirement_review_draft')
    expect(allowedTools(null, 'manager')).toContain('requirement_review_draft')
    expect(allowedTools('closed', 'intake')).not.toContain('requirement_revise')
    expect(allowedTools('closed', 'pm')).not.toContain('requirement_review_draft')
    expect(allowedTools('closed', 'manager')).not.toContain('requirement_review_draft')

    for (const state of [...STATES, null] as const) {
      for (const role of ROLES) {
        expect(allowedTools(state, role)).not.toContain('requirement_approve')
        expect(allowedTools(state, role)).not.toContain('requirement_review_decide')
      }
    }
  })

  it('需求变更提案只进需求分析师，终态不可见', () => {
    expect(ROLE_TOOLS.intake).toContain('requirement_propose')
    for (const role of ROLES) {
      if (role !== 'intake') expect(ROLE_TOOLS[role]).not.toContain('requirement_propose')
    }
    expect(allowedTools('drafting', 'intake')).toContain('requirement_propose')
    expect(allowedTools(null, 'intake')).toContain('requirement_propose')
    expect(allowedTools('closed', 'intake')).not.toContain('requirement_propose')
    for (const state of [...STATES, null] as const) {
      for (const role of ROLES) {
        if (role === 'intake' && state !== 'closed') continue
        expect(allowedTools(state, role)).not.toContain('requirement_propose')
      }
    }
  })

  it('草稿修改提案只进需求修改角色，该角色拿不到直接写正文的工具', () => {
    expect(ROLE_TOOLS['requirement-editor']).toEqual(['file_read', 'file_list', 'spec_query', 'task_read', 'requirement_patch_propose'])
    for (const role of ROLES) {
      if (role === 'requirement-editor') continue
      expect(ROLE_TOOLS[role]).not.toContain('requirement_patch_propose')
    }
    for (const state of [...STATES, null] as const) {
      const tools = allowedTools(state, 'requirement-editor')
      if (state !== 'closed') expect(tools).toContain('requirement_patch_propose')
      for (const write of ['requirement_revise', 'requirement_draft', 'requirement_propose', 'file_edit', 'cmd_run', 'spec_draft', 'task_draft', 'proposal_draft', 'proposal_approve', 'requirement_approve']) {
        expect(tools).not.toContain(write)
      }
    }
    expect(allowedTools('closed', 'requirement-editor')).toEqual(['file_read', 'file_list', 'spec_query', 'task_read'])
  })

  it('方案批准与驳回永远不在模型工具面：任何状态任何角色都拿不到', () => {
    for (const state of [...STATES, null] as const) {
      expect(allowedTools(state, null)).not.toContain('proposal_approve')
      expect(allowedTools(state, null)).not.toContain('proposal_reject')
      for (const role of ROLES) {
        expect(allowedTools(state, role)).not.toContain('proposal_approve')
        expect(allowedTools(state, role)).not.toContain('proposal_reject')
      }
    }
    for (const tools of Object.values(ROLE_TOOLS)) {
      expect(tools).not.toContain('proposal_approve')
      expect(tools).not.toContain('proposal_reject')
    }
    expect(allToolNames()).not.toContain('proposal_approve')
    expect(allToolNames()).not.toContain('proposal_reject')
  })

  it('拆分岗位建议只进研发经理，终态不可见，分配仍是人机命令', () => {
    expect(ROLE_TOOLS.manager).toContain('requirement_split_plan')
    for (const role of ROLES) {
      if (role !== 'manager') expect(ROLE_TOOLS[role]).not.toContain('requirement_split_plan')
    }
    expect(allowedTools('drafting', 'manager')).toContain('requirement_split_plan')
    expect(allowedTools(null, 'manager')).toContain('requirement_split_plan')
    expect(allowedTools('closed', 'manager')).not.toContain('requirement_split_plan')
    for (const state of [...STATES, null] as const) {
      for (const role of ROLES) expect(allowedTools(state, role)).not.toContain('task_assign')
    }
  })

  it('立项、架构、产品、评审四个角色都动不了代码与命令', () => {
    for (const role of ['intake', 'architect', 'pm', 'review'] as const) {
      expect(ROLE_TOOLS[role]).not.toContain('file_edit')
      expect(ROLE_TOOLS[role]).not.toContain('cmd_run')
    }
  })

  it('只有产品角色能出方案；方案批准是人机命令，不在任何角色的工具面里', () => {
    expect(ROLE_TOOLS.pm).toContain('proposal_draft')
    for (const role of ['intake', 'architect', 'review'] as const) {
      expect(ROLE_TOOLS[role]).not.toContain('proposal_draft')
    }
    // 终态只读：连产品也不能在 closed 上继续出方案。
    expect(allowedTools('closed', 'pm')).not.toContain('proposal_draft')
    expect(allowedTools('drafting', 'pm')).toContain('proposal_draft')
    for (const state of STATES) expect(SURFACE[state]).not.toContain('proposal_approve')
  })

  it('只有架构能起草契约与绑落点，只有评审能收口与挂证据', () => {
    expect(ROLE_TOOLS.architect).toContain('contract_draft')
    expect(ROLE_TOOLS.architect).toContain('spec_bind')
    expect(ROLE_TOOLS.intake).not.toContain('contract_draft')
    expect(ROLE_TOOLS.intake).not.toContain('spec_bind')
    expect(ROLE_TOOLS.review).toContain('task_close')
    expect(ROLE_TOOLS.review).toContain('evidence_attach')
    expect(ROLE_TOOLS.architect).not.toContain('task_close')
  })

  it('求交只减不加：任何角色在任何状态都不越出状态表', () => {
    for (const role of ROLES) {
      for (const state of STATES) {
        for (const tool of allowedTools(state, role)) expect(SURFACE[state]).toContain(tool)
      }
      for (const tool of allowedTools(null, role)) expect(UNSCOPEED_SURFACE).toContain(tool)
    }
  })

  it('Git 角色只能提交，不能改文件、不能跑任意命令，终态也提不了', () => {
    expect(ROLE_TOOLS.git).toContain('git_commit')
    expect(ROLE_TOOLS.git).not.toContain('file_edit')
    expect(ROLE_TOOLS.git).not.toContain('cmd_run')
    expect(allowedTools('closed', 'git')).not.toContain('git_commit')
    expect(allowedTools('closed', 'git')).toContain('git_status')
    expect(allowedTools('implementing', 'git')).toEqual(['file_read', 'file_list', 'spec_query', 'task_read', 'git_status', 'git_diff', 'git_commit'])
  })

  it('运维能写脚本与跑登记过的命令，但不能收口、不能提交；deploy 永远不在工具面', () => {
    expect(ROLE_TOOLS.ops).toContain('file_edit')
    expect(ROLE_TOOLS.ops).toContain('cmd_run')
    expect(ROLE_TOOLS.ops).not.toContain('task_close')
    expect(ROLE_TOOLS.ops).not.toContain('git_commit')
    for (const state of [...STATES, null] as const) {
      expect(allowedTools(state, 'ops')).not.toContain('deploy')
    }
  })

  it('每个角色都能列目录：立项不需要额外工具就能看清仓库结构', () => {
    for (const role of ROLES) expect(ROLE_TOOLS[role]).toContain('file_list')
  })

  it('role_draft 只对研发经理可见，且研发经理没有任何代码或命令工具', () => {
    expect(ROLE_TOOLS.manager).toEqual(['file_read', 'file_list', 'spec_query', 'task_read', 'task_draft', 'role_draft', 'requirement_split_plan', 'requirement_review_draft'])
    for (const tool of ['file_edit', 'cmd_run', 'git_commit', 'contract_draft', 'task_close', 'evidence_attach']) {
      expect(ROLE_TOOLS.manager).not.toContain(tool)
    }
    for (const role of ROLES) {
      if (role === 'manager') continue
      expect(ROLE_TOOLS[role]).not.toContain('role_draft')
    }
    // 状态维也不能替研发经理把岗位工具漏出去：这张表里只有它的角色行带 role_draft。
    for (const state of [...STATES, null] as const) {
      expect(allowedTools(state, 'manager')).not.toContain('file_edit')
      expect(allowedTools(state, 'manager')).not.toContain('cmd_run')
    }
  })

  it('智能调度与流程控制只有四件只读工具，任何状态都拿不到编辑、命令、契约与收口', () => {
    const readOnly = ['file_list', 'file_read', 'spec_query', 'task_read']
    for (const role of ['scheduler', 'flow'] as const) {
      expect([...ROLE_TOOLS[role]].sort()).toEqual(readOnly)
      for (const state of [...STATES, null] as const) {
        const tools = allowedTools(state, role)
        expect(tools).not.toContain('file_edit')
        expect(tools).not.toContain('cmd_run')
        expect(tools).not.toContain('contract_draft')
        expect(tools).not.toContain('contract_sign')
        expect(tools).not.toContain('task_close')
        expect(tools).not.toContain('evidence_attach')
      }
      // 空看板下也只给读：这两个角色不能在还没立项时写项目或任务。
      expect([...allowedTools(null, role)].sort()).toEqual(readOnly)
    }
  })

  it('签了约的评审拿不到编辑，验证态的评审能收口', () => {
    expect(allowedTools('contracted', 'review')).not.toContain('file_edit')
    expect(allowedTools('verifying', 'review')).toEqual(['file_read', 'file_list', 'spec_query', 'task_read', 'evidence_attach', 'task_close'])
  })

  it('不配角色时保持只有状态一维的旧行为', () => {
    expect(allowedTools('drafting')).toEqual(SURFACE.drafting)
    expect(allowedTools('drafting', null)).toEqual(SURFACE.drafting)
  })

  it('parseRole 认全部内置角色，未设给 null，配错当场响', () => {
    expect(parseRole(undefined)).toBeNull()
    for (const role of ROLES) expect(parseRole(role)).toBe(role)
    expect(() => parseRole('qa')).toThrow(TypeError)
    expect(() => parseRole('qa')).toThrow('未知角色')
    expect(() => parseRole(7)).toThrow('未知角色')
  })
})

describe('交付索引工具面', () => {
  it('deliverable_draft 在签约后到验证态可见，起草态与终态不可见', () => {
    expect(SURFACE.drafting).not.toContain('deliverable_draft')
    for (const state of ['contracted', 'implementing', 'verifying'] as TaskState[]) {
      expect(SURFACE[state]).toContain('deliverable_draft')
    }
    expect(SURFACE.closed).not.toContain('deliverable_draft')
    expect(UNSCOPEED_SURFACE).not.toContain('deliverable_draft')
  })

  it('只有实施、架构与运维角色能登记交付索引', () => {
    for (const role of ['dev', 'architect', 'ops'] as const) {
      expect(ROLE_TOOLS[role]).toContain('deliverable_draft')
    }
    for (const role of ['intake', 'pm', 'git', 'review', 'scheduler', 'flow', 'manager'] as const) {
      expect(ROLE_TOOLS[role]).not.toContain('deliverable_draft')
    }
    expect(allowedTools('implementing', 'dev')).toContain('deliverable_draft')
    expect(allowedTools('implementing', 'architect')).toContain('deliverable_draft')
    expect(allowedTools('implementing', 'ops')).toContain('deliverable_draft')
    expect(allowedTools('verifying', 'review')).not.toContain('deliverable_draft')
    expect(allowedTools('drafting', 'architect')).not.toContain('deliverable_draft')
  })
})
