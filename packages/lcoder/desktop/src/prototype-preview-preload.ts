/**
 * 独立原型预览窗口的极简 preload：向页面只暴露 `reportSelection`，不暴露
 * Node、cookie、文件系统、业务 IPC 或 window.lcoder。检查器挂在本 preload
 * 的隔离世界里，页面脚本拿不到它的函数引用，也读不到宿主能力。
 *
 * 原型默认完全可交互：普通点击、提交与悬停都不触发检查器，也不改变页面行为。
 * 按住 Alt 点击，或打开悬浮提示条上的「选择模式」开关后点击，才选中元素并
 * 上报；只有这类选择动作才拦截点击与随后的提交，原型自身的交互照常发生。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from './contract.ts'
import type { PrototypeSelectionInfo } from './contract.ts'

const MAX_HTML_CHARS = 8000
const MAX_CSS_CHARS = 4000
const MAX_LABEL_CHARS = 80
const LABEL_TEXT_CHARS = 24
/** 内层文字兜底只取首段前 18 字，够认元素又不把整段说明塞进胶囊。 */
const LABEL_FALLBACK_CHARS = 18
/** 元素自身没有直接文本时，先从这些标题/强调子节点里取可读名。 */
const LABEL_CHILD_SELECTOR = 'h1,h2,h3,h4,h5,h6,button,label,strong,th,td,span'
const HIGHLIGHT_OUTLINE = '2px solid #4f8cff'
const CHANGED_OUTLINE = '2px dashed rgba(245, 158, 11, .95)'
const HINT_TEXT = '按住 Alt 点击元素选中并交给 AI 修改 · 或直接点击操作原型'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 页面唯一可见的上报口；把元素信息单向交给主进程，不回读任何宿主数据。 */
const api = {
  reportSelection: (info: PrototypeSelectionInfo): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.prototypeSelectionReport, info) as Promise<void>,
}
contextBridge.exposeInMainWorld('lcoderPrototypePreview', api)

// 工作台下行控制只进隔离世界，不进 contextBridge：原型页面拿不到这些能力。
ipcRenderer.on(IPC_CHANNELS.prototypeStudioInspectControl, (_event, payload: unknown) => {
  if (!isRecord(payload)) return
  const interaction = payload.interactionMode
  if (interaction === 'select' || interaction === 'interact') {
    hideHintForStudio()
    setSelectionMode(interaction === 'select')
    return
  }
  if (!Array.isArray(payload.highlightDomPaths)) return
  const paths: string[] = []
  for (const path of payload.highlightDomPaths) {
    if (typeof path !== 'string') return
    paths.push(path.slice(0, 2000))
  }
  applyHighlightPaths(paths)
})

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '')
}

/** 元素的单段标识：标签、可选 id、首个 class 与在兄弟元素中的 nth-child。 */
function segmentOf(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const id = safeName(element.getAttribute('id') ?? '')
  const firstClass = safeName((element.getAttribute('class') ?? '').trim().split(/\s+/)[0] ?? '')
  const parent = element.parentElement
  const nth = parent === null ? 1 : Array.from(parent.children).indexOf(element) + 1
  return `${tag}${id === '' ? '' : `#${id}`}${firstClass === '' ? '' : `.${firstClass}`}:nth-child(${String(nth)})`
}

/** 从 body（不含 html）到元素的 DOM 路径。 */
function domPathOf(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current !== null) {
    const tag = current.tagName.toLowerCase()
    if (tag === 'html') break
    parts.unshift(segmentOf(current))
    if (tag === 'body') break
    current = current.parentElement
  }
  return parts.join(' > ')
}

/** 去掉脚本与事件属性再截断：上报给模型的只有元素标记与样式，不带可执行内容。 */
function safeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .slice(0, MAX_HTML_CHARS)
}

const CSS_PROPERTIES = [
  'display', 'position', 'color', 'background-color', 'font-size', 'font-family',
  'font-weight', 'border-radius', 'padding', 'margin', 'width', 'height',
  'box-shadow', 'text-align',
] as const

/** 抽取关键计算样式，作为元素级修改的视觉上下文。 */
function cssOf(element: Element): string {
  const style = window.getComputedStyle(element)
  const lines: string[] = []
  for (const property of CSS_PROPERTIES) {
    const value = style.getPropertyValue(property).trim()
    if (value !== '') lines.push(`${property}: ${value}`)
  }
  return lines.join('; ').slice(0, MAX_CSS_CHARS)
}

/** 元素的可读短名：优先 aria-label/placeholder/alt，其次直接可见文本与内层标题，最后退回标签/id/类标识。 */
function labelOf(element: Element): string {
  const attributes = ['aria-label', 'placeholder', 'alt'] as const
  for (const name of attributes) {
    const value = (element.getAttribute(name) ?? '').trim().replace(/\s+/g, ' ')
    if (value !== '') return value.slice(0, MAX_LABEL_CHARS)
  }
  const textNode = Array.from(element.childNodes).find(
    node => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  )
  if (textNode !== undefined) {
    const text = (textNode.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, LABEL_TEXT_CHARS)
    if (text !== '') return text
  }
  // 卡片容器常把文案放在内层标题里，自身只有空白文本；取首个标题/强调子节点的首段。
  const nested = element.querySelector(LABEL_CHILD_SELECTOR)
  if (nested !== null) {
    const text = firstSegmentOf(nested.textContent, LABEL_TEXT_CHARS)
    if (text !== '') return text
  }
  const own = firstSegmentOf(element.textContent, LABEL_FALLBACK_CHARS)
  if (own !== '') return own
  const tag = element.tagName.toLowerCase()
  const id = safeName(element.getAttribute('id') ?? '')
  const firstClass = safeName((element.getAttribute('class') ?? '').trim().split(/\s+/)[0] ?? '')
  return `${tag}${id === '' ? '' : `#${id}`}${firstClass === '' ? '' : `.${firstClass}`}`.slice(0, MAX_LABEL_CHARS)
}

/** 按换行与空白切出首段非空可见文本，再截到给定字数。 */
function firstSegmentOf(text: string, chars: number): string {
  for (const segment of text.split(/\s+/)) {
    const value = segment.trim()
    if (value !== '') return value.slice(0, chars)
  }
  return ''
}

function report(element: Element): void {
  const info: PrototypeSelectionInfo = {
    domPath: domPathOf(element),
    html: safeHtml(element.outerHTML),
    css: cssOf(element),
    label: labelOf(element),
  }
  void api.reportSelection(info).catch((error: unknown) => {
    // 上报失败只丢这次点选，不把未处理拒绝抛回原型页面。
    void error
  })
}

let highlighted: HTMLElement | undefined
let previousOutline = ''
let previousPriority = ''
let altHeld = false
let selectionMode = false
let suppressSubmit = false
let hintBar: HTMLElement | undefined
/** 提示条顶部说明行；工作台画布有自己的交互条，这一行要收起。 */
let hintTopRow: HTMLElement | undefined
let selectModeToggle: HTMLButtonElement | undefined
let errorBanner: HTMLElement | undefined
let errorText: HTMLElement | undefined
let errorCount = 0
/** 当前是否露出一条运行时报错；有错误时提示条整体不能收起。 */
let errorVisible = false
let lastErrorPaintAt = 0
const ERROR_THROTTLE_MS = 200

function clearHighlight(): void {
  if (highlighted === undefined) return
  if (previousOutline === '') highlighted.style.removeProperty('outline')
  else highlighted.style.setProperty('outline', previousOutline, previousPriority)
  highlighted = undefined
}

function setHighlight(target: HTMLElement): void {
  if (target === highlighted) return
  clearHighlight()
  highlighted = target
  previousOutline = target.style.getPropertyValue('outline')
  previousPriority = target.style.getPropertyPriority('outline')
  target.style.setProperty('outline', HIGHLIGHT_OUTLINE, 'important')
}

interface ChangedMark {
  readonly element: HTMLElement
  readonly hadAttribute: boolean
  readonly outline: string
  readonly priority: string
}
let changedMarks: ChangedMark[] = []

/** 清掉工作台高亮标记，恢复元素原有的属性与 outline。 */
function clearChangedMarks(): void {
  for (const mark of changedMarks) {
    if (!mark.hadAttribute) mark.element.removeAttribute('data-lcoder-changed')
    if (mark.outline === '') mark.element.style.removeProperty('outline')
    else mark.element.style.setProperty('outline', mark.outline, mark.priority)
  }
  changedMarks = []
}

/** 给单个匹配元素加修改标识；先存原样以便还原。 */
function markChanged(element: HTMLElement): void {
  if (changedMarks.some(mark => mark.element === element)) return
  changedMarks.push({
    element,
    hadAttribute: element.hasAttribute('data-lcoder-changed'),
    outline: element.style.getPropertyValue('outline'),
    priority: element.style.getPropertyPriority('outline'),
  })
  element.setAttribute('data-lcoder-changed', 'true')
  element.style.setProperty('outline', CHANGED_OUTLINE, 'important')
}

/** 按 DOM 路径集合标记待修改元素；空集合只清旧标记。 */
function applyHighlightPaths(paths: readonly string[]): void {
  clearChangedMarks()
  if (paths.length === 0) return
  const wanted = new Set(paths)
  for (const element of document.querySelectorAll('*')) {
    if (!(element instanceof HTMLElement)) continue
    if (wanted.has(domPathOf(element))) markChanged(element)
  }
}

function onOver(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof HTMLElement) || target === highlighted) return
  if (!altHeld && !selectionMode) return
  setHighlight(target)
}

function onOut(event: MouseEvent): void {
  const next = event.relatedTarget
  if (highlighted !== undefined && next instanceof Node && highlighted.contains(next)) return
  clearHighlight()
}

/** Alt 键或持久选择模式下点击算一次选中；普通点击放行给原型。 */
function isSelectionClick(event: MouseEvent): boolean {
  return event.altKey || altHeld || selectionMode
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Alt') return
  altHeld = true
  // Alt 是选择元素的修饰键：按键本身不交给窗口，避免弹出原生菜单栏抢走焦点。
  event.preventDefault()
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key !== 'Alt') return
  event.preventDefault()
  altHeld = false
  if (!selectionMode) clearHighlight()
}

/** Alt+Tab 等切换窗口可能收不到 keyup，失焦时重置按键态与高亮。 */
function onBlur(): void {
  altHeld = false
  if (!selectionMode) clearHighlight()
}

function onClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  // 提示条自身的点击由按钮监听处理，不参与元素选中，也不影响原型交互。
  if (hintBar !== undefined && hintBar.contains(target)) return
  // 每次点击先复位提交抑制，只有本次被判定为选中才重新置位。
  suppressSubmit = false
  if (!isSelectionClick(event)) return
  event.preventDefault()
  event.stopPropagation()
  suppressSubmit = true
  // 短生命周期：未被 submit 消费时也要复位，不抑制之后的普通提交。
  setTimeout(() => { suppressSubmit = false }, 0)
  clearHighlight()
  report(target)
  if (target instanceof HTMLElement) setHighlight(target)
}

function onSubmit(event: Event): void {
  if (!suppressSubmit) return
  suppressSubmit = false
  event.preventDefault()
  event.stopPropagation()
}

function selectModeLabel(): string {
  return selectionMode ? '选择模式：开' : '选择模式：关'
}

/** 提示条按钮与工作台下行控制共用的选择模式切换；退出选择模式时清掉悬停高亮。 */
function setSelectionMode(next: boolean): void {
  selectionMode = next
  if (selectModeToggle !== undefined) {
    selectModeToggle.textContent = selectModeLabel()
    selectModeToggle.setAttribute('aria-pressed', String(next))
  }
  if (!next) clearHighlight()
}

/**
 * 工作台画布自带交互条：收到下行控制后收起提示条，只在运行时报错时保留红色错误条。
 * DOM 节点保留，独立预览窗口没有下行控制时照常显示提示。
 */
function hideHintForStudio(): void {
  if (hintTopRow !== undefined) hintTopRow.style.display = 'none'
  if (hintBar !== undefined && !errorVisible) hintBar.style.display = 'none'
}

/** 把原型脚本的运行时报错节流展示到顶部提示条，避免点击无反应却静默无提示。 */
function recordRuntimeError(message: string): void {
  errorCount += 1
  const now = Date.now()
  if (errorCount > 1 && now - lastErrorPaintAt < ERROR_THROTTLE_MS) return
  lastErrorPaintAt = now
  if (errorBanner === undefined || errorText === undefined) return
  const clean = message.trim() === '' ? '未知脚本错误' : message.trim().slice(0, 140)
  const suffix = errorCount > 1 ? `（已发生 ${String(errorCount)} 次）` : ''
  errorText.textContent = `原型脚本报错${suffix}：${clean}`
  errorVisible = true
  if (hintBar !== undefined) hintBar.style.display = 'flex'
  errorBanner.style.display = 'flex'
}

function onWindowError(event: ErrorEvent): void {
  const detail = event.message !== ''
    ? event.message
    : event.error instanceof Error
      ? event.error.message
      : '运行期异常'
  recordRuntimeError(detail)
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason: unknown = event.reason
  const detail = reason instanceof Error ? reason.message : String(reason)
  recordRuntimeError(detail)
}

/** 注入固定定位的提示条；挂在 documentElement 上，原型替换 body 内容也不会移除它。 */
function installHint(): HTMLElement {
  const bar = document.createElement('div')
  bar.setAttribute('data-testid', 'prototype-preview-hint')
  bar.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;padding:8px 12px;border-radius:8px;background:rgba(20,20,24,.92);color:#fff;font:13px/1.5 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:6px'
  const topRow = document.createElement('div')
  topRow.style.cssText = 'display:flex;align-items:center;gap:8px'
  const text = document.createElement('span')
  text.textContent = HINT_TEXT
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.setAttribute('data-testid', 'prototype-preview-select-mode')
  toggle.setAttribute('aria-pressed', 'false')
  toggle.textContent = selectModeLabel()
  toggle.style.cssText = 'flex:none;border:1px solid rgba(255,255,255,.35);border-radius:6px;background:transparent;color:inherit;font:inherit;padding:2px 8px;cursor:pointer'
  toggle.addEventListener('click', () => { setSelectionMode(!selectionMode) })
  selectModeToggle = toggle
  hintTopRow = topRow
  topRow.append(text, toggle)

  const errRow = document.createElement('div')
  errRow.setAttribute('data-testid', 'prototype-preview-error')
  errRow.style.cssText = 'display:none;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:6px;background:rgba(220,38,38,.25);border:1px solid rgba(248,113,113,.55);color:#fecaca;font-size:12px;word-break:break-word'
  const errMsg = document.createElement('span')
  errMsg.setAttribute('data-testid', 'prototype-preview-error-text')
  const errDismiss = document.createElement('button')
  errDismiss.type = 'button'
  errDismiss.setAttribute('data-testid', 'prototype-preview-error-dismiss')
  errDismiss.textContent = '×'
  errDismiss.style.cssText = 'flex:none;border:none;background:transparent;color:inherit;font-size:14px;line-height:1;padding:0 4px;cursor:pointer'
  errDismiss.addEventListener('click', () => {
    errorCount = 0
    errorVisible = false
    errRow.style.display = 'none'
    errMsg.textContent = ''
    // 错误条收起后，工作台画布仍不需要提示条；独立预览窗口保持原样。
    if (hintBar !== undefined && hintTopRow?.style.display === 'none') hintBar.style.display = 'none'
  })
  errRow.append(errMsg, errDismiss)
  errorBanner = errRow
  errorText = errMsg

  bar.append(topRow, errRow)
  const root = document.documentElement
  root.append(bar)
  return bar
}

let installed = false
function install(): void {
  if (installed) return
  installed = true
  hintBar = installHint()
  document.addEventListener('mouseover', onOver, true)
  document.addEventListener('mouseout', onOut, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('submit', onSubmit, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('blur', onBlur)
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
else install()
