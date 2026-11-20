/**
 * 网页样式摘要：把宿主抓到的 HTML 折成一段受长度上限约束的纯文本。
 *
 * 只返回结构化摘要（标题、正文节选、主色、字体、布局、按钮风格），
 * 绝不把原始 HTML、脚本或样式表原文回传给界面或模型。摘要总长有硬上限，
 * 单项也有上限，避免用一份大页面挤爆上下文。
 */
/** 摘要总字符上限。 */
export const MAX_SUMMARY_CHARS = 4000

/** 原型相关的结构化失败；`code` 供界面与 Remote 回执分支。 */
export class PrototypeError extends Error {
  override name = 'PrototypeError'

  /**
   * @param message - 人能读的原因。
   * @param code - 机器可读的分类。
   */
  constructor(message: string, readonly code: string) {
    super(message)
  }
}


/** 单项文本上限；总长仍受 `MAX_SUMMARY_CHARS` 约束。 */
const FIELD_CHARS = 400

/** 一段网页样式摘要；所有字段都是可信的纯文本展示材料。 */
export interface StyleSummary {
  readonly url: string
  readonly title: string
  readonly headings: readonly string[]
  readonly text: string
  readonly colors: readonly string[]
  /** 空串表示未识别；Remote 边界不接受 `undefined`。 */
  readonly font: string
  readonly layout: string
  readonly buttonStyle: string
  readonly truncated: boolean
}

/**
 * 判定抓取结果是否可用于摘要；非 HTML 正文没有样式可抽取。
 * @param body - 网页正文的判别联合。
 * @returns 正文是 HTML 时为 true。
 */
export function isHtmlBody(body: { readonly kind: string; readonly content: string }): body is { kind: 'html'; content: string } {
  return body.kind === 'html'
}

/**
 * 校验网页 URL：仅允许 http/https，拒绝文件、data 与本机/内网地址。
 * @param value - 界面输入的原始 URL。
 * @returns 解析后的 URL。
 * @throws `WEB_INVALID_URL`：协议、凭据或目标地址不在允许范围。
 */
export function assertFetchableUrl(value: string): URL {
  const trimmed = value.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new PrototypeError('网页地址无法解析', 'PROTOTYPE/INVALID_URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PrototypeError('只允许 http 或 https 网页地址', 'PROTOTYPE/INVALID_URL')
  }
  if (url.username !== '' || url.password !== '') {
    throw new PrototypeError('网页地址不能带用户名或密码', 'PROTOTYPE/INVALID_URL')
  }
  if (isPrivateHost(url.hostname)) {
    throw new PrototypeError('网页地址不能指向本机或内网', 'PROTOTYPE/INVALID_URL')
  }
  return url
}

/**
 * 内网地址判定：本机回环、链路本地、私有网段与常见的本地域名后缀。
 * @param hostname - URL 的 hostname（不含端口与方括号）。
 * @returns 命中禁区时为 true。
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '0.0.0.0' || host === '::' || host === '::1') return true
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localdomain')) return true
  const ipv4 = host.split('.').map(part => Number.parseInt(part, 10))
  if (ipv4.length === 4 && ipv4.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = ipv4 as [number, number, number, number]
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
  }
  // IPv6 唯一本地地址（fc00::/7）与回环。
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true
  return false
}

/**
 * 把 HTML 折成纯文本摘要；脚本、样式与注释一律不计入正文。
 * @param url - 抓取用的最终 URL，原样记入摘要。
 * @param html - 宿主抓到的 HTML 原文。
 * @returns 受长度上限约束的结构化摘要。
 */
export function summarizeHtml(url: string, html: string): StyleSummary {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map(match => plainText(match[1] ?? ''))
    .filter(text => text !== '')
    .slice(0, 12)
  const colors = collectColors(html)
  const font = firstMatch(html, /font-family\s*:\s*([^;}]+)/i)
  const layout = detectLayout(html)
  const buttonStyle = detectButtonStyle(html)
  const text = readableText(html)

  const summary: StyleSummary = {
    url,
    title: cap(title ?? '', FIELD_CHARS),
    headings: capEach(headings, 60, 12),
    text: cap(text, MAX_SUMMARY_CHARS),
    colors: capEach(colors, 24, 8),
    font: font === undefined ? '' : cap(plainText(font), FIELD_CHARS),
    layout: layout ?? '',
    buttonStyle: buttonStyle === undefined ? '' : cap(plainText(buttonStyle), FIELD_CHARS),
    truncated: false,
  }
  return boundSummary(summary)
}

/** 截取首个捕获组并去实体与空白；没有匹配返回 undefined。 */
function firstMatch(html: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(html)
  return match?.[1] === undefined ? undefined : plainText(match[1])
}

/** 去掉标签、解码常见实体、折叠空白，确保输出是可读纯文本而非 HTML。 */
function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/\s+/g, ' ')
    .trim()
}

/** 可读正文：移除脚本、样式与注释后取纯文本。 */
function readableText(html: string): string {
  const stripped = html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  return plainText(stripped)
}

/** 从内联样式里挑出出现次数最多、足够具体的颜色值。 */
function collectColors(html: string): string[] {
  const found = [...html.matchAll(/#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi)]
    .map(match => (match[0] ?? '').toLowerCase())
    .concat([...html.matchAll(/\b(?:rgb|rgba|hsl)\([^)]*\)/gi)].map(match => (match[0] ?? '').toLowerCase()))
  const counts = new Map<string, number>()
  for (const color of found) counts.set(color, (counts.get(color) ?? 0) + 1)
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([color]) => color)
    .filter((color, index, all) => all.indexOf(color) === index)
}

/** 从布局相关声明里给出一句可读描述。 */
function detectLayout(html: string): string | undefined {
  const hints: string[] = []
  if (/display\s*:\s*(flex|inline-flex)/i.test(html)) hints.push('flex')
  if (/display\s*:\s*grid/i.test(html)) hints.push('grid')
  if (/grid-template-columns\s*:/i.test(html)) hints.push('多列网格')
  if (/max-width\s*:\s*\d{3,4}px/i.test(html)) hints.push('定宽居中')
  return hints.length === 0 ? undefined : hints.join('、')
}

/** 从按钮样式声明里给出一句可读描述。 */
function detectButtonStyle(html: string): string | undefined {
  const hints: string[] = []
  if (/\bborder-radius\s*:\s*(9\d|1\d{2}|\d+px)/i.test(html)) hints.push('圆角')
  if (/border-radius\s*:\s*50%/i.test(html)) hints.push('胶囊形')
  if (/\bbox-shadow\s*:/i.test(html)) hints.push('带阴影')
  if (/text-transform\s*:\s*uppercase/i.test(html)) hints.push('大写字母')
  return hints.length === 0 ? undefined : hints.join('、')
}

/** 限制单段文本长度，超长加省略号。 */
function cap(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** 逐项限制数组长度。 */
function capEach(values: readonly string[], perItem: number, maxItems: number): string[] {
  return values.slice(0, maxItems).map(value => cap(value, perItem))
}

/**
 * 按总字符上限裁剪摘要：先砍正文，再砍标题与列表，最后标出被截断。
 * @param summary - 已按单项裁剪的摘要。
 * @returns 总长不超过 `MAX_SUMMARY_CHARS` 的摘要。
 */
function boundSummary(summary: StyleSummary): StyleSummary {
  const fixed = [
    summary.url,
    summary.title,
    summary.font ?? '',
    summary.layout ?? '',
    summary.buttonStyle ?? '',
    ...summary.headings,
    ...summary.colors,
  ].join('')
  let text = summary.text
  let truncated = false
  let total = fixed.length + text.length
  if (total > MAX_SUMMARY_CHARS) {
    text = text.slice(0, Math.max(0, MAX_SUMMARY_CHARS - fixed.length))
    truncated = true
    total = fixed.length + text.length
  }
  return { ...summary, text, truncated: truncated || summary.text.length > text.length }
}
