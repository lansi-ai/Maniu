/**
 * 立项面工具集：把一个连 `.spec` 都没有的仓库变成有项目身份的仓库。
 *
 * 只有一件工具、一个动作：**首次登记** `.spec/project.yaml`。已存在的文件不覆盖——
 * 项目身份由人先登记，模型答错一次不该把人写的远端地址冲掉；要改就走人手编辑，
 * 与「状态流转仍是人手写 YAML」同一条口径。
 *
 * 输出统一用 `{ type: 'json' }` + JSON 渲染，理由见 docs/cookbook/adding-a-tool.md。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { ProjectInfo, ProjectKind } from '../schema/spec.js'
import type { ProjectKind as ProjectKindName } from '../schema/spec.js'
import { hasProject, loadProject, newProjectId, projectPath, saveProject } from '../kernel/project-store.js'
import { resolveRoot } from '../kernel/spec-root.js'
import type { RootInput } from '../kernel/spec-root.js'

const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
]

/** `ProjectKind` 的合法取值，取自 schema 本身，避免与枚举漂移。 */
const KINDS: readonly ProjectKindName[] = ProjectKind.options

/**
 * 把可选文档路径收成人话可判定的键值：空串按「没这条文档」处理，不写空字段。
 * @param product - 产品文档路径。
 * @param architecture - 架构文档路径。
 * @param tests - 测试用例路径。
 * @returns 只含非空路径的文档表；全空时是 `{}`。
 */
function docsOf(product?: string, architecture?: string, tests?: string): Record<string, string> {
  const entries: readonly (readonly [string, string | undefined])[] = [
    ['product', product],
    ['architecture', architecture],
    ['tests', tests],
  ]
  const out: Record<string, string> = {}
  for (const [key, value] of entries) {
    const text = value?.trim()
    if (text !== undefined && text !== '') out[key] = text
  }
  return out
}

/**
 * 建项目信息工具。
 * @param rootInput - 规格根解析（按会话工作区）。
 * @returns `project_draft` 工具定义。
 */
export function createProjectTools(rootInput: RootInput): ToolDefinition[] {
  return [
    defineTool({
      name: 'project_draft',
      description:
        '把问清的项目信息登记成 `.spec/project.yaml`。只在文件不存在时写；已存在只回读现值、绝不覆盖。kind 只能是 web、desktop、library；仓库还没有远端时就把计划中的地址与分支名如实填进来，不要留空。可以顺带登记项目追加的轨。',
      parameters: {
        kind: { type: 'string', required: true, description: `项目类型：${KINDS.join('、')}` },
        repo_url: { type: 'string', required: true, description: '仓库地址（还没有远端就填计划地址或仓库目录）' },
        repo_branch: { type: 'string', required: true, description: '主线分支名，如 main 或 master' },
        doc_product: { type: 'string', description: '产品文档的仓库内相对路径' },
        doc_architecture: { type: 'string', description: '架构文档的仓库内相对路径' },
        doc_tests: { type: 'string', description: '测试用例或验收脚本的仓库内相对路径' },
        tracks: {
          type: 'array',
          description: '项目追加的轨；内置 h5 / admin / api / desktop / host / general 已存在，这里只写额外交付面。每项是 { id, name }：id 小写字母开头，不得与内置轨重名或重复',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true, description: '轨 id，如 payment' },
              name: { type: 'string', required: true, description: '显示名，如「支付端」' },
            },
          },
        },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      // oxlint-disable-next-line typescript/require-await -- execute 的契约要求返回 Promise（ToolDefinition.execute），这里是同步实现。
      async execute(args, exec) {
        const root = resolveRoot(rootInput, exec)
        const kind = ProjectKind.safeParse(args.kind.trim())
        if (!kind.success) {
          throw new Error(`project_draft 的 kind 只能是 ${KINDS.join('、')}，收到：${args.kind}`)
        }
        const repoUrl = args.repo_url.trim()
        const repoBranch = args.repo_branch.trim()
        if (repoUrl === '' || repoBranch === '') {
          throw new Error('project_draft 需要非空的 repo_url 与 repo_branch：项目身份不能靠占位符落盘')
        }

        const path = projectPath(root)
        if (hasProject(root)) {
          const current = loadProject(root)
          if (current === null) throw new Error(`读不到已存在的 ${path}`)
          return {
            created: false,
            path,
            kind: current.kind,
            repo_url: current.repo.url,
            repo_branch: current.repo.branch,
            docs: docsOf(current.docs.product, current.docs.architecture, current.docs.tests),
            tracks: current.tracks,
            note: 'project.yaml 已存在，没有覆盖。要改项目信息（含追加轨）请人手编辑该文件；要继续引导就只问缺的文档路径。',
          }
        }

        const docs = docsOf(args.doc_product, args.doc_architecture, args.doc_tests)
        const tracks = (args.tracks ?? []).map(track => ({ id: track.id.trim(), name: track.name.trim() }))
        const projectId = newProjectId()
        const info = ProjectInfo.parse({
          kind: kind.data,
          repo: { url: repoUrl, branch: repoBranch },
          projectId,
          docs,
          tracks,
        })
        const written = saveProject(root, info)

        return {
          created: true,
          path: written,
          kind: info.kind,
          project_id: projectId,
          repo_url: info.repo.url,
          repo_branch: info.repo.branch,
          docs,
          tracks: info.tracks,
          note: '项目信息已登记（projectId 随仓提交，云端项目人才库按它隔离）。规格条目用 spec_draft 逐条落，第一条任务用 task_draft；本工具不采集部署环境，需要 env 就人手补 .spec/project.yaml 的 environments。',
        }
      },
    }),
  ]
}
