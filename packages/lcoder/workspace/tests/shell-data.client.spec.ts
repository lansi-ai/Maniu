/**
 * 立项咒语的纯模板测：文档来源声明与缺失两种写法都要有下一步。
 *
 * 外壳按钮的行为证据走桌面端启动（`lcoder/RUN.md`）；这里钉住进模型的那段文本，
 * 因为它是模型可见输入，措辞变化会直接改变 agent 的调研路径。
 */
import { describe, expect, it } from 'vitest'

import { buildIntakePrompt, buildOnboardingPrompt } from '../src/client/shell/shell-data.ts'
import type { ShellOnboardingDocs } from '../src/client/shell/shell-data.ts'

const PROJECT = { name: 'Demo 商城', path: 'E:/Projects/demo', branch: 'main' }

describe('立项咒语', () => {
  it('声明了交付文档时逐条给出路径，并要求先读再立项', () => {
    const docs: ShellOnboardingDocs = { product: 'docs/prd-and-design.md', architecture: 'docs/architecture.md', tests: '' }
    const text = buildOnboardingPrompt(PROJECT, docs)

    expect(text).toContain('@task-flow 立项分析：Demo 商城（E:/Projects/demo）')
    expect(text).toContain('- 规格根：E:/Projects/demo/.spec')
    expect(text).toContain('- 项目：Demo 商城（E:/Projects/demo，main）')
    expect(text).toContain('- 产品文档：docs/prd-and-design.md')
    expect(text).toContain('- 架构文档：docs/architecture.md')
    expect(text).not.toContain('测试用例：')
    expect(text).toContain('先 task_read 确认空看板，再 file_read 逐个读上面的文档')
    expect(text).toContain('每个任务调一次 task_draft，状态固定 drafting')
    expect(text).toContain('rules 只填 spec_query 查得到的编号')
  })

  it('没有声明交付文档时要求先问用户，不编造路径', () => {
    const text = buildOnboardingPrompt(PROJECT, { product: '', architecture: '', tests: '' })

    expect(text).toContain('先向用户确认产品文档在哪')
    expect(text).not.toContain('产品文档：')
    expect(text).not.toContain('架构文档：')
    expect(text).not.toContain('测试用例：')
  })

  it('不承诺模型能改代码或自己签契约', () => {
    const text = buildOnboardingPrompt(PROJECT, { product: 'docs/prd-and-design.md', architecture: '', tests: '' })

    expect(text).toContain('不要改业务代码，不要给自己签契约')
    expect(text).not.toContain('file_edit')
    expect(text).not.toContain('cmd_run')
  })
})

describe('空文件夹的项目引导咒语', () => {
  const text = buildIntakePrompt(PROJECT)

  it('从项目身份问起，一次一问且硬上限 7 问', () => {
    expect(text).toContain('@task-flow 项目引导：Demo 商城（E:/Projects/demo）')
    expect(text).toContain('E:/Projects/demo/.spec 还不存在')
    expect(text).toContain('一次只问一问，拿到回答再问下一问，总数不超过 7 问')
    for (let n = 1; n <= 7; n++) expect(text).toContain(`${n}. `)
    expect(text).not.toContain('8. ')
  })

  it('按 project_draft、spec_draft、task_draft 的顺序落盘', () => {
    const project = text.indexOf('project_draft 登记 .spec/project.yaml')
    const rule = text.indexOf('spec_draft 登记一条 status 为 draft')
    const task = text.indexOf('task_draft 立一条 drafting 任务')
    expect(project).toBeGreaterThanOrEqual(0)
    expect(project).toBeLessThan(rule)
    expect(rule).toBeLessThan(task)
    expect(text).toContain('文件已存在就只回读现值，不覆盖')
    expect(text).toContain('绝不改已登记的条目')
  })

  it('列的是立项面的工具，不承诺改代码与签字', () => {
    expect(text).toContain('file_read、file_list、project_draft、spec_query、spec_draft、task_read、task_draft')
    expect(text).not.toContain('file_edit')
    expect(text).not.toContain('cmd_run')
    expect(text).toContain('不起草契约')
    expect(text).toContain('绝不给自己签字')
    expect(text).toContain('不要留半截文件')
  })
})
