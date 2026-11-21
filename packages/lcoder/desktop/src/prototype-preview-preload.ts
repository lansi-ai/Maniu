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
const HIGHLIGHT_OUTLINE = '2px solid #4f8cff'
const HINT_TEXT = '按住 Alt 点击元素选中并交给 AI 修改 · 或直接点击操作原型'

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
let altHeld = false
let selectionMode = false
let suppressSubmit = false
let hintBar: HTMLElement | undefined

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
  if (event.key === 'Alt') altHeld = true
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key !== 'Alt') return
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

/** 注入固定定位的提示条；挂在 documentElement 上，原型替换 body 内容也不会移除它。 */
function installHint(): HTMLElement {
  const bar = document.createElement('div')
  bar.setAttribute('data-testid', 'prototype-preview-hint')
  bar.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:360px;padding:8px 12px;border-radius:8px;background:rgba(20,20,24,.9);color:#fff;font:13px/1.5 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px'
  const text = document.createElement('span')
  text.textContent = HINT_TEXT
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.setAttribute('data-testid', 'prototype-preview-select-mode')
  toggle.setAttribute('aria-pressed', 'false')
  toggle.textContent = selectModeLabel()
  toggle.style.cssText = 'flex:none;border:1px solid rgba(255,255,255,.35);border-radius:6px;background:transparent;color:inherit;font:inherit;padding:2px 8px;cursor:pointer'
  toggle.addEventListener('click', () => {
    selectionMode = !selectionMode
    toggle.textContent = selectModeLabel()
    toggle.setAttribute('aria-pressed', String(selectionMode))
    if (!selectionMode) clearHighlight()
  })
  bar.append(text, toggle)
  ;(document.documentElement ?? document.body).append(bar)
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
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
else install()
