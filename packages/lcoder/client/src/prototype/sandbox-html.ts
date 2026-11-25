/**
 * 原型页离线交互沙箱辅助：启用脚本与表单交互，同时禁止同源访问、弹窗与外网请求。
 */

/** 允许交互但保持隔离 `null` 源的 iframe sandbox 属性（严禁包含 `allow-same-origin`）。 */
export const PROTOTYPE_INTERACTIVE_SANDBOX = 'allow-scripts allow-forms'

/** 封死所有外网与导航的离线 CSP 策略。 */
export const PROTOTYPE_OFFLINE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'"

const CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="${PROTOTYPE_OFFLINE_CSP}">`

/**
 * 为原型 HTML 注入离线 Content-Security-Policy，用于 `sandbox="allow-scripts allow-forms"` 预览。
 * @param html - 原始原型 HTML 字符串。
 * @returns 注入离线 CSP 后的 HTML 字符串。
 */
export function withOfflineInteractiveCsp(html: string): string {
  const headMatch = /<head\b[^>]*>/i.exec(html)
  if (headMatch !== null) {
    const insertAt = headMatch.index + headMatch[0].length
    return `${html.slice(0, insertAt)}${CSP_META_TAG}${html.slice(insertAt)}`
  }
  const htmlMatch = /<html\b[^>]*>/i.exec(html)
  if (htmlMatch !== null) {
    const insertAt = htmlMatch.index + htmlMatch[0].length
    return `${html.slice(0, insertAt)}<head>${CSP_META_TAG}</head>${html.slice(insertAt)}`
  }
  const doctypeMatch = /<!doctype\b[^>]*>/i.exec(html)
  if (doctypeMatch !== null) {
    const insertAt = doctypeMatch.index + doctypeMatch[0].length
    return `${html.slice(0, insertAt)}<head>${CSP_META_TAG}</head>${html.slice(insertAt)}`
  }
  return `<head>${CSP_META_TAG}</head>${html}`
}
