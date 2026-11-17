/** 立项与拆分的提示词模板；正文由模型执行，界面只负责发送。 */

/** 立项项目事实。 */
export interface IntakeProject {
  readonly name: string
  readonly path: string
  readonly branch: string
  readonly docs: { readonly product: string; readonly architecture: string; readonly tests: string }
}

/** 立项档位。 */
export type IntakeMode = 'fresh' | 'onboarding'

/**
 * 生成立项提示词。
 *
 * 访谈纪律（七问、需求概要、确认后落盘顺序、失败口径与边界）只由
 * `maniu-intake` 人设承载；这里只给项目事实与第 0 步的读法，避免两处口径漂移。
 * @param project - 当前项目。
 * @param mode - 全新项目或已有资料。
 * @returns 可直接发送的提示词。
 */
export function buildIntakePrompt(project: IntakeProject, mode: IntakeMode): string {
  const head = mode === 'fresh' ? '全新项目立项：' : '已有资料立项：'
  const facts = `${project.name}（${project.path}，${project.branch}）`
  if (mode === 'fresh') {
    return `${head}${facts}

第 0 步 先看清仓库：
- 用 file_list 看根目录与 .spec 是否存在，用 file_read 读实际存在的说明文档；不猜路径，不把不存在的文件说成已存在。
- 能自己查到的技术信息（目录、仓库名、分支、现有文档）自己查，不要问不懂技术的用户。
- 仓库是空的、没有远端、没有文档或测试，都不中止访谈：缺的项标「尚未提供」。`
  }
  const declared = [
    { label: '产品文档', path: project.docs.product },
    { label: '架构文档', path: project.docs.architecture },
    { label: '测试用例', path: project.docs.tests },
  ].filter(entry => entry.path !== '')
  const sources = declared.length === 0
    ? '- 文档来源：.spec/project.yaml 没有声明交付文档；先用 file_list 看仓库里有没有文档，再向用户确认产品文档在哪，不要猜路径。'
    : declared.map(entry => `- ${entry.label}：${entry.path}`).join('\n')
  return `${head}${facts}

第 0 步 先读资料，再来问：
- 用 file_list 看清结构，用 file_read 逐个读下面的文档与关键代码入口；路径必须是实际读到的，不要猜。
${sources}
- 先列出「从仓库已确认的事实」：项目类型、技术栈、目录结构、已完成的功能线索；这些不要再拿去问用户。
- 只问文档回答不了的：业务目标、第一版范围、验收口径、约束与待确认项。
- 需要确认文档位置时，用 ask_user_question 把 file_list 实际列出的候选做成选项，不要让人手打路径。`
}

/**
 * 生成需求拆分提示词。
 * @param requirement - 需求编号与标题。
 * @param document - 需求正文。
 * @param tracks - 可用轨的显示文本。
 * @returns 可直接发送给项目经理会话的提示词。
 */
export function buildSplitPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  tracks: readonly string[],
): string {
  const body = document.trim() === '' ? '（读不到需求正文；请先读取 .spec/requirements 下的同名文档）' : document.trim()
  return `需求拆分：请把需求 ${requirement.id}（${requirement.title}）拆分成可执行的开发任务，写入 .spec/tasks。

依据：以末尾附上的《项目需求概要》（.spec/requirements/${requirement.id}.md）为唯一范围依据；文档里暂不开发的范围不要拆成任务。

执行身份：你是这条需求的项目经理，负责把已确认的需求拆成开发任务。
- 用户已在界面上确认需求并亲自点击「拆分任务」，这就是明确的拆分授权；不要重复追问。
- 只产出 .spec/tasks 下的任务文件，state 一律 drafting；只做只读查看，不开始实现，不调用编辑与命令工具。
- 不改需求文档、.spec/project.yaml、已有方案与规格条目，不推进任何任务状态。
- 拆完只回报新建任务的编号、标题、轨与依赖，然后停下；岗位分配给实施阶段的人。

要求：
- 每条任务对应一个可独立验收的业务结果，不按纯技术步骤堆叠。
- 写清 description（范围与验收标准）、grade、rules、depends_on、scope.allowed_paths 与 track，并写 requirement: ${requirement.id}。
- 每条任务必须标一条轨，只能取：${tracks.join('、')}。
- 空仓时第一条任务必须是「项目基础框架与脚手架」，所有功能任务在 depends_on 里依赖它；已有可运行框架只补实际缺口。
- 完成后列出新建任务的编号、标题、轨与依赖关系。

《项目需求概要》正文：
"""
${body}
"""`
}
