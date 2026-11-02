/**
 * `lcoderWorkspace` 命名空间的两本词典，以及命名空间本身的声明。
 *
 * 文案与键集放在同一个文件里：任何模块只要命名 `TranslateNS<'lcoderWorkspace'>`，
 * 就只需要这一个 import，不管程序先加载哪个入口。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 工作台的页签名、引导卡片、三栏标题与占位说明。 */
    lcoderWorkspace: LcoderWorkspaceKey
  }
}

/** 简体中文词典，同时是键集的唯一来源。 */
export const zh = {
  'shortcut.noSession': '请先选择会话',
  'type.label': '工作台',
  'guide.title': 'LCoder 工作台',
  'guide.description': '任务、规格与对话三栏对照',
  noWorkspace: '这个会话没有工作区目录。',
  'column.tasks': '任务',
  'column.spec': '规格 / 代码',
  'column.conversation': '对话',
  'column.tasks.pending': '绑定会话工作区后，这里显示 .spec/tasks/ 下的任务文件。',
  'column.spec.pending': '绑定会话工作区后，这里显示 .spec/spec/rules.yaml 的规格条目。',
  'column.conversation.pending': '对话由会话自己渲染；这一栏留给逐条对齐。',
  'projection.loading': '读取规格文件…',
  'projection.error': '读取失败',
  'projection.problems': '部分文件没有读出来：',
  'tasks.empty': '这个工作区还没有 .spec/tasks/ 任务文件。',
  'rules.empty': '这个工作区还没有 .spec/spec/rules.yaml。',
} satisfies Record<string, string>

/** 工作台词典的键集。 */
export type LcoderWorkspaceKey = keyof typeof zh

/** 英文词典，按中文键集校验。 */
export const en = {
  'shortcut.noSession': 'Select a session first',
  'type.label': 'Workspace',
  'guide.title': 'LCoder workspace',
  'guide.description': 'Tasks, spec, and conversation side by side',
  noWorkspace: 'This session has no workspace directory.',
  'column.tasks': 'Tasks',
  'column.spec': 'Spec / code',
  'column.conversation': 'Conversation',
  'column.tasks.pending': 'Bind a session workspace to see .spec/tasks/ task files here.',
  'column.spec.pending': 'Bind a session workspace to see .spec/spec/rules.yaml entries here.',
  'column.conversation.pending': 'The session renders the conversation itself; this column is for aligning it row by row.',
  'projection.loading': 'Reading spec files…',
  'projection.error': 'Failed to read',
  'projection.problems': 'Some files could not be read:',
  'tasks.empty': 'This workspace has no .spec/tasks/ files yet.',
  'rules.empty': 'This workspace has no .spec/spec/rules.yaml yet.',
} satisfies Record<LcoderWorkspaceKey, string>
