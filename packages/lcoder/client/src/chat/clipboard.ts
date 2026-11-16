/** 复制一段文本：优先走剪贴板 API，沙箱或权限不足时退回选区复制。 */

/**
 * 把文本写进系统剪贴板。
 * @param text - 要复制的原文。
 * @returns 写入是否成功。
 */
export async function copyText(text: string): Promise<boolean> {
  // 类型上 clipboard 总有值，但 file:// 沙箱里可能整个缺失，这里按运行时放宽。
  const clipboard = navigator.clipboard as Clipboard | undefined
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // 剪贴板 API 在无权限或非安全上下文会拒绝；继续走选区兜底。
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    // oxlint-disable-next-line typescript/no-deprecated -- 剪贴板 API 不可用时只剩这一条兜底。
    return document.execCommand('copy')
  } finally {
    area.remove()
  }
}
