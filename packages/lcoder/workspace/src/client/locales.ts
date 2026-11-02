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
  'column.tasks.pending': '任务列表接入 @lcoder/kernel 的任务状态机后显示。',
  'column.spec.pending': '规格条目与它对应的代码位置，接入规格库后显示。',
  'column.conversation.pending': '对话由会话自己渲染；这一栏留给逐条对齐。',
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
  'column.tasks.pending': 'The task list appears once the @lcoder/kernel task state machine is wired in.',
  'column.spec.pending': 'Spec entries and the code they point at appear once the spec library is wired in.',
  'column.conversation.pending': 'The session renders the conversation itself; this column is for aligning it row by row.',
} satisfies Record<LcoderWorkspaceKey, string>
