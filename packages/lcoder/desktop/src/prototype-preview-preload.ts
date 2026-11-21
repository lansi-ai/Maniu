/**
 * 独立原型预览窗口的极简 preload：向页面只暴露 `reportSelection`，不暴露
 * Node、cookie、文件系统、业务 IPC 或 window.lcoder。点选检查器挂在本 preload
 * 的隔离世界里，页面脚本拿不到它的函数引用，也读不到宿主能力。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from './contract.ts'
import type { PrototypeSelectionInfo } from './contract.ts'

const MAX_HTML_CHARS = 8000
const MAX_CSS_CHARS = 4000
const HIGHLIGHT_OUTLINE = '2px solid #4f8cff'

/** 页面唯一可见的上报口；把元素信息单向交给主进程，不回读任何宿主数据。 */
const api = {
  reportSelection: (info: PrototypeSelectionInfo): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.prototypeSelectionReport, info) as Promise<void>,
}
contextBridge.exposeInMainWorld('lcoderPrototypePreview', api)

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

function report(element: Element): void {
  const info: PrototypeSelectionInfo = {
    domPath: domPathOf(element),
    html: safeHtml(element.outerHTML),
    css: cssOf(element),
  }
  void api.reportSelection(info).catch((error: unknown) => {
    // 上报失败只丢这次点选，不把未处理拒绝抛回原型页面。
    void error
  })
}

let highlighted: HTMLElement | undefined
let previousOutline = ''
let previousPriority = ''

function clearHighlight(): void {
  if (highlighted === undefined) return
  if (previousOutline === '') highlighted.style.removeProperty('outline')
  else highlighted.style.setProperty('outline', previousOutline, previousPriority)
  highlighted = undefined
}

function onOver(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof HTMLElement) || target === highlighted) return
  clearHighlight()
  highlighted = target
  previousOutline = target.style.getPropertyValue('outline')
  previousPriority = target.style.getPropertyPriority('outline')
  target.style.setProperty('outline', HIGHLIGHT_OUTLINE, 'important')
}

function onOut(event: MouseEvent): void {
  const next = event.relatedTarget
  if (highlighted !== undefined && next instanceof Node && highlighted.contains(next)) return
  clearHighlight()
}

function onClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  // 阻断原型自身的点击导航与表单提交，点选过程不触发页面行为。
  event.preventDefault()
  event.stopPropagation()
  clearHighlight()
  report(target)
}

function onSubmit(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

let installed = false
function install(): void {
  if (installed) return
  installed = true
  document.addEventListener('mouseover', onOver, true)
  document.addEventListener('mouseout', onOut, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('submit', onSubmit, true)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
else install()
