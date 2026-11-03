/**
 * 立项咒语的纯模板测：文档来源声明与缺失两种写法都要有下一步。
 *
 * 外壳按钮的行为证据走桌面端启动（`lcoder/RUN.md`）；这里钉住进模型的那段文本，
 * 因为它是模型可见输入，措辞变化会直接改变 agent 的调研路径。
 */
import { describe, expect, it } from 'vitest'

import { buildOnboardingPrompt } from '../src/client/shell/shell-data.ts'
import type { ShellOnboardingDocs } from '../src/client/shell/shell-data.ts'

const PROJECT = { name: 'Demo 商城', path: 'E:/Projects/demo', branch: 'main' }

describe('立项咒语', () => {
  it('声明了交付文档时逐条给出路径，并要求先读再立项', () => {
    const docs: ShellOnboardingDocs = { product: 'docs/prd.md', architecture: 'docs/arch.md', tests: '' }
    const text = buildOnboardingPrompt(PROJECT, docs)

    expect(text).toContain('@task-flow 立项分析：Demo 商城（E:/Projects/demo）')
    expect(text).toContain('- 规格根：E:/Projects/demo/.spec')
    expect(text).toContain('- 项目：Demo 商城（E:/Projects/demo，main）')
    expect(text).toContain('- 产品文档：docs/prd.md')
    expect(text).toContain('- 架构文档：docs/arch.md')
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
    const text = buildOnboardingPrompt(PROJECT, { product: 'docs/prd.md', architecture: '', tests: '' })

    expect(text).toContain('不要改业务代码，不要给自己签契约')
    expect(text).not.toContain('file_edit')
    expect(text).not.toContain('cmd_run')
  })
})
