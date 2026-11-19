// @vitest-environment node
/** 立项提示词与人才库人设同源：向导只发项目事实，纪律只在 maniu-intake 人设里。 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildIntakePrompt, buildManagerSplitPrompt, buildRequirementCreatePrompt, buildReviewPrompt, buildRevisePrompt, type IntakeProject } from '../src/intake/prompts.ts'

const PROJECT: IntakeProject = {
  name: '仓库 A',
  path: 'E:/repo-a',
  branch: 'main',
  docs: { product: '产品说明', architecture: '架构说明', tests: '' },
}

const PROFILE = readFileSync(new URL('../../../../lcoder/desktop-profile.patch.yml', import.meta.url), 'utf8')

describe('立项提示词', () => {
  it('全新项目只给项目事实与第 0 步，不重复人设纪律', () => {
    const prompt = buildIntakePrompt(PROJECT, 'fresh')
    expect(prompt).toContain('全新项目立项：')
    expect(prompt).toContain('仓库 A（E:/repo-a，main）')
    expect(prompt).toContain('第 0 步 先看清仓库')
    expect(prompt).not.toContain('七个问题依次覆盖')
    expect(prompt).not.toContain('每个问题都用 ask_user_question 弹出选择框')
    expect(prompt).not.toContain('问完先出《项目需求概要 V0.1》')
    expect(prompt).not.toContain('project_draft 登记')
    expect(prompt).not.toContain('输出完停下，等用户回复「确认需求」')
  })

  it('已有资料档带上声明的文档来源，仍不重复纪律', () => {
    const prompt = buildIntakePrompt(PROJECT, 'onboarding')
    expect(prompt).toContain('已有资料立项：')
    expect(prompt).toContain('- 产品文档：产品说明')
    expect(prompt).toContain('- 架构文档：架构说明')
    expect(prompt).not.toContain('测试用例：')
    expect(prompt).not.toContain('七个问题依次覆盖')
  })

  it('全新项目附初步想法时带上想法原文并跳过第 1 问，不盲猜', () => {
    const prompt = buildIntakePrompt(PROJECT, 'fresh', '做一个团队人员名单维护工具')
    expect(prompt).toContain('全新项目立项：')
    expect(prompt).toContain('第 0 步 先看清仓库')
    expect(prompt).toContain('用户已说明的项目初步想法（第 1 问已答）')
    expect(prompt).toContain('做一个团队人员名单维护工具')
    expect(prompt).toContain('跳过第 1 问')
    expect(prompt).toContain('不要盲猜')
    expect(prompt).toContain('第 2 问（主要给谁使用）')
    expect(prompt).toContain('验收标准')
    expect(prompt).toContain('生成贴合该业务的选项逐题追问')
  })

  it('不传想法或想法为空白时输出与旧版二参调用一致，不附想法段落', () => {
    const withoutIdea = buildIntakePrompt(PROJECT, 'fresh')
    const blankIdea = buildIntakePrompt(PROJECT, 'fresh', '   ')
    expect(blankIdea).toBe(withoutIdea)
    expect(withoutIdea).toContain('第 0 步 先看清仓库')
    expect(withoutIdea).not.toContain('用户已说明的项目初步想法')
    expect(withoutIdea).not.toContain('跳过第 1 问')
  })
})

describe('研发经理拆分提示词', () => {
  it('先按技术维度建任务，再写逐条岗位建议，明确不分配不改状态', () => {
    const prompt = buildManagerSplitPrompt({ id: 'REQ-02', title: '待拆分需求' }, '# 正文\n\n内容', ['api（接口）', 'h5（H5 前端）'])
    expect(prompt).toContain('需求拆分：请把需求 REQ-02（待拆分需求）')
    expect(prompt).toContain('task_draft')
    expect(prompt).toContain('requirement: REQ-02')
    expect(prompt).toContain('api（接口）')
    expect(prompt).toContain('requirement_split_plan')
    expect(prompt).toContain('.spec/requirements/REQ-02/split-plan.yaml')
    expect(prompt).toContain('不分配岗位')
    expect(prompt).toContain('不改任务状态')
    expect(prompt).toContain('# 正文')
  })
})

describe('需求评审提示词', () => {
  it('身份岗位中性：pm 与 manager 会话都收同一份，不写死项目经理', () => {
    const prompt = buildReviewPrompt({ id: 'REQ-01', title: '待评审需求' }, '# 正文\n\n内容')
    expect(prompt).toContain('需求评审：请对需求 REQ-01（待评审需求）')
    expect(prompt).toContain('执行身份：你是这条需求的评审岗位')
    expect(prompt).not.toContain('项目经理')
    expect(prompt).toContain('requirement_review_draft')
    expect(prompt).toContain('不改需求正文、不改状态')
    expect(prompt).toContain('不自行改稿，也不自行过审')
    expect(prompt).toContain('# 正文')
  })

  it('四角度要求完整保留，不能合并或省略', () => {
    const prompt = buildReviewPrompt({ id: 'REQ-01', title: '待评审需求' }, '# 正文\n\n内容')
    expect(prompt).toContain('四个角度都要写到，不能合并或省略')
    expect(prompt).toContain('1. 文档完备性：')
    expect(prompt).toContain('2. 合理性：')
    expect(prompt).toContain('3. 需求角度：')
    expect(prompt).toContain('4. 技术实现角度：')
  })

  it('报告固定摘要/结论/待改项三段，待改项写明位置、建议与优先级', () => {
    const prompt = buildReviewPrompt({ id: 'REQ-01', title: '待评审需求' }, '# 正文\n\n内容')
    expect(prompt).toContain('## 摘要')
    expect(prompt).toContain('## 结论')
    expect(prompt).toContain('## 待改项')
    expect(prompt).toContain('可执行的修改建议与优先级（高/中/低）')
    expect(prompt).toContain('不改名、不合并')
  })
})

describe('新建需求提示词', () => {
  it('用户描述随首条消息，四步限定指令齐全', () => {
    const prompt = buildRequirementCreatePrompt('希望支持订单导出')
    expect(prompt).toContain('希望支持订单导出')
    expect(prompt).toContain('只登记这一条')
    expect(prompt).toContain('一句话业务目标')
    expect(prompt).toContain('不超过 16 字的短业务短语')
    expect(prompt).toContain('场景加手段长句')
    expect(prompt).toContain('不用文档名')
    expect(prompt).toContain('冲突/重复')
    expect(prompt).toContain('影响面')
    expect(prompt).toContain('优先级')
    expect(prompt).toContain('明确禁止代码层判断')
    expect(prompt).toContain('小需求出短文档')
    expect(prompt).toContain('大需求出完整文档')
    expect(prompt).toContain('ask_user_question')
    expect(prompt).toContain('一次只问一个问题')
    expect(prompt).toContain('requirement_propose')
    expect(prompt).toContain('mode 为 new')
    expect(prompt).toContain('不调用 requirement_draft')
    expect(prompt).toContain('不做整项目立项')
    expect(prompt).toContain('不写 .spec/project.yaml')
    expect(prompt).toContain('不动其他需求')
  })

  it('描述可空：空时先问用户，仍走提案通道', () => {
    const prompt = buildRequirementCreatePrompt('   ')
    expect(prompt).toContain('用户没有提供描述')
    expect(prompt).toContain('ask_user_question')
    expect(prompt).toContain('requirement_propose')
  })

  it('确认态需求只能作为 new 的依据，不能改稿', () => {
    const prompt = buildRequirementCreatePrompt('基于已确认需求扩展')
    expect(prompt).toContain('target 与 base_version')
    expect(prompt).toContain('确认态需求只能这样作为新需求的依据，不能改稿')
  })

  it('基于此版本新建：提示词钉住依据需求与版本号，描述可空先问用户', () => {
    const prompt = buildRequirementCreatePrompt('', { id: 'REQ-01', title: '佣金改造', version: 2 })
    expect(prompt).toContain('用户没有提供描述')
    expect(prompt).toContain('基于已确认需求 REQ-01（佣金改造）v2')
    expect(prompt).toContain('mode 为 new')
    expect(prompt).toContain('target 为 REQ-01')
    expect(prompt).toContain('base_version 为 2')
    expect(prompt).toContain('确认态需求只能这样作为新需求的依据，不能改稿')
    expect(prompt).not.toContain('mode 为 revise')
  })
})

describe('需求改稿提示词（直出新版本）', () => {
  it('四步走直接落版：基线是当前正文与最近评审报告，改稿写 requirement_revise 新版本', () => {
    const prompt = buildRevisePrompt(
      { id: 'REQ-01', title: '待改稿需求' },
      '# 当前正文\n\n内容',
      'requirements/REQ-01/reviews/R2.md',
      3,
    )
    expect(prompt).toContain('需求改稿：请修订需求 REQ-01（待改稿需求）')
    expect(prompt).toContain('.spec/requirements/REQ-01/reviews/R2.md')
    expect(prompt).toContain('当前正文版本号是 v3')
    expect(prompt).toContain('直接写入新版本 v4')
    expect(prompt).toContain('冲突/重复')
    expect(prompt).toContain('影响面')
    expect(prompt).toContain('优先级')
    expect(prompt).toContain('明确禁止代码层判断')
    expect(prompt).toContain('ask_user_question')
    expect(prompt).toContain('一次只问一个问题')
    expect(prompt).toContain('requirement_revise')
    expect(prompt).toContain('id 为 REQ-01')
    expect(prompt).toContain('内核会把正文记为下一个版本，自动保留历史快照并闭环未决评审')
    expect(prompt).toContain('不调用 requirement_propose 出提案')
    expect(prompt).not.toContain('mode 为 revise')
    expect(prompt).not.toContain('待确认提案')
    expect(prompt).toContain('不改其他需求')
    expect(prompt).toContain('# 当前正文')
  })

  it('没有评审报告时不编造意见；旧需求没有版本表按 v1 出 v2', () => {
    const prompt = buildRevisePrompt({ id: 'REQ-02', title: '旧需求' }, '正文')
    expect(prompt).toContain('还没有评审报告')
    expect(prompt).toContain('不要编造评审意见')
    expect(prompt).toContain('当前正文版本号是 v1')
    expect(prompt).toContain('直接写入新版本 v2')
    expect(prompt).not.toContain('mode 为 revise')
  })
})

describe('内置角色人设源', () => {
  it('角色名去掉慢牛前缀，立项改叫需求分析师', () => {
    expect(PROFILE).toContain('name: 需求分析师')
    expect(PROFILE).toContain('name: 实施')
    expect(PROFILE).toContain('name: 项目经理')
    expect(PROFILE).toContain('name: 架构')
    expect(PROFILE).toContain('name: 评审')
    expect(PROFILE).toContain('name: Git')
    expect(PROFILE).toContain('name: 运维')
    expect(PROFILE).toContain('name: 研发经理')
    expect(PROFILE).toContain('name: 智能调度')
    expect(PROFILE).toContain('name: 流程控制')
    expect(PROFILE).not.toMatch(/^ {8}name: 慢牛/mu)
    expect(PROFILE).not.toContain('You are 慢牛')
  })

  it('需求分析师人设承载七问纪律与落盘顺序', () => {
    expect(PROFILE).toContain('You are 需求分析师.')
    expect(PROFILE).toContain('修改草稿态需求时，先读最近的评审报告逐条处理')
    expect(PROFILE).toContain('内核自动保留历史版本快照并闭环未决评审')
    expect(PROFILE).toContain('新正文直接落成新版本 v(N+1)')
    expect(PROFILE).toContain('基于已确认需求新建时')
    expect(PROFILE).toContain('已确认需求只能作为新需求依据不改稿')
    expect(PROFILE).toContain('访谈规则：')
    expect(PROFILE).toContain('七个问题依次覆盖：')
    expect(PROFILE).toContain('1. 你想做一个什么软件？')
    expect(PROFILE).toContain('7. 准备在哪里使用，有没有参考产品或别的硬要求？')
    expect(PROFILE).toContain('问完先出《项目需求概要 V0.1》，不要立刻登记：')
    expect(PROFILE).toContain('用户确认后按顺序落盘，只用专用工具，不用通用写文件能力：')
    expect(PROFILE).toContain('project_draft 登记 .spec/project.yaml')
    expect(PROFILE).toContain('requirement_draft 登记需求')
    expect(PROFILE).toContain('title 用不超过 16 字的短业务短语')
    expect(PROFILE).toContain('失败就照实报四件事')
    expect(PROFILE).toContain('不签契约、不推进任务状态、不改业务代码、不跑命令、不提交、不推送、不部署。')
  })

  it('首条消息带初步想法时第 1 问视为已答，不按目录名盲猜重问', () => {
    expect(PROFILE).toContain('首条立项消息若附带「用户已说明的项目初步想法（第 1 问已答）」，第 1 问视为已答')
    expect(PROFILE).toContain('严禁按仓库文件夹名盲猜软件类别重问第 1 问')
    expect(PROFILE).toContain('直接围绕用户想法从第 2 问起生成贴合业务的选项')
  })
})
