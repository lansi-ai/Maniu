/** 人机命令执行：只走 `commands.execute` 白名单。 */

/** 一次命令回执。 */
export interface CommandOutcome {
  readonly ok: boolean
  readonly text: string
}

/**
 * 执行一条人机命令。
 * @param agentId - 承载命令的工作台作用域会话。
 * @param line - 完整命令行，例如 `/requirement_approve REQ-01`。
 * @returns 成功与回执原文；未识别的命令按失败返回。
 */
export async function runCommand(agentId: string, line: string): Promise<CommandOutcome> {
  const answer = await window.lcoder.call('commands', 'execute', {
    agentId,
    line,
    submittedAttachments: [],
  })
  if (!answer.ok) return { ok: false, text: `${answer.error.code}: ${answer.error.message}` }
  const value = answer.value
  if (typeof value !== 'object' || value === null || !('result' in value)) {
    return { ok: false, text: `宿主没有识别命令 ${line}` }
  }
  const result = value.result
  if (typeof result !== 'object' || result === null || !('kind' in result)) {
    return { ok: false, text: '命令回执不合法' }
  }
  const text = 'text' in result && typeof result.text === 'string' ? result.text : ''
  return { ok: result.kind === 'success', text: text === '' ? '命令已完成' : text }
}
