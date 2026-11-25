/** 轻量 Markdown 渲染：只生成 React 元素，不注入 HTML。 */

import type { JSX, ReactNode } from 'react'

interface InlineToken {
  readonly kind: 'text' | 'code' | 'strong' | 'em' | 'link'
  readonly text: string
  readonly href?: string
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(?:__[^_]+__)|(\*[^*\n]+\*)|(?:_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/gu

function inlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index
    if (index > last) tokens.push({ kind: 'text', text: text.slice(last, index) })
    const value = match[0]
    if (value.startsWith('`')) {
      tokens.push({ kind: 'code', text: value.slice(1, -1) })
    } else if (value.startsWith('**') || value.startsWith('__')) {
      tokens.push({ kind: 'strong', text: value.slice(2, -2) })
    } else if (value.startsWith('[')) {
      const close = value.indexOf('](')
      tokens.push({ kind: 'link', text: value.slice(1, close), href: value.slice(close + 2, -1) })
    } else {
      tokens.push({ kind: 'em', text: value.slice(1, -1) })
    }
    last = index + value.length
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) })
  return tokens
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  return inlineTokens(text).map((token, index) => {
    const key = `${keyPrefix}-${String(index)}`
    switch (token.kind) {
      case 'code': return <code key={key}>{token.text}</code>
      case 'strong': return <strong key={key}>{token.text}</strong>
      case 'em': return <em key={key}>{token.text}</em>
      case 'link': return <a key={key} href={token.href} target="_blank" rel="noreferrer">{token.text}</a>
      case 'text': return <span key={key}>{token.text}</span>
    }
  })
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().endsWith('|')
}

function tableCells(line: string): string[] {
  return line.trim().slice(1, -1).split('|').map(cell => cell.trim())
}

function renderTable(lines: readonly string[], key: string): JSX.Element {
  const head = tableCells(lines[0] ?? '')
  const rows = lines.slice(2).filter(isTableRow).map(tableCells)
  return (
    <table key={key}>
      <thead><tr>{head.map((cell, index) => <th key={String(index)}>{inline(cell, `${key}-h${String(index)}`)}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={String(rowIndex)}>
            {row.map((cell, cellIndex) => <td key={String(cellIndex)}>{inline(cell, `${key}-${String(rowIndex)}-${String(cellIndex)}`)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function isListLine(line: string): boolean {
  return /^(?:[-*+]|\d{1,3}[.)])\s+\S/u.test(line.trim())
}

function listKind(line: string): 'ul' | 'ol' {
  return /^\d/u.test(line.trim()) ? 'ol' : 'ul'
}

/** 行首缩进宽度：制表符按一级（2 列）折算。 */
function listIndent(line: string): number {
  const prefix = /^[ \t]*/u.exec(line)?.[0] ?? ''
  let width = 0
  for (const ch of prefix) width += ch === '\t' ? 2 : 1
  return width
}

/** 去掉行首的列表符号，保留条目正文。 */
function listItemText(line: string): string {
  return line.trim().replace(/^(?:[-*+]|\d{1,3}[.)])\s+/u, '')
}

/** 一层列表：条目自带更深缩进的子列表。 */
interface ParsedList {
  readonly kind: 'ul' | 'ol'
  readonly items: readonly ParsedListItem[]
}

/** 一个列表条目与它下面的子列表。 */
interface ParsedListItem {
  readonly text: string
  readonly children: readonly ParsedList[]
}

/** 从 `start` 解析同缩进的一层列表，遇到更深的行就收成上一条目的子列表。 */
function parseList(lines: readonly string[], start: number, indent: number): [ParsedList, number] {
  const kind = listKind(lines[start] ?? '')
  const items: ParsedListItem[] = []
  let index = start
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!isListLine(line) || listIndent(line) !== indent || listKind(line) !== kind) break
    const text = listItemText(line)
    index += 1
    const children: ParsedList[] = []
    while (index < lines.length && isListLine(lines[index] ?? '') && listIndent(lines[index] ?? '') > indent) {
      const nested = listIndent(lines[index] ?? '')
      const [child, next] = parseList(lines, index, nested)
      children.push(child)
      index = next
    }
    items.push({ text, children })
  }
  return [{ kind, items }, index]
}

/** 把解析结果渲染成嵌套的无序或有序列表，条目正文继续走行内语法。 */
function renderList(list: ParsedList, key: string): JSX.Element {
  const children = list.items.map((item, itemIndex) => (
    <li key={String(itemIndex)}>
      {inline(item.text, `${key}-${String(itemIndex)}`)}
      {item.children.map((child, childIndex) => renderList(child, `${key}-${String(itemIndex)}-${String(childIndex)}`))}
    </li>
  ))
  return list.kind === 'ol' ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>
}

/**
 * 把 Markdown 文本渲染成块级元素。
 * @param text - 文档原文。
 * @returns 段落、标题、列表、表格与代码块。
 */
export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const key = `b-${String(index)}`
    if (line.trim() === '') { index += 1; continue }
    const fence = /^```(.*)$/u.exec(line.trim())
    if (fence !== null) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push(<pre key={key}><code>{body.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      const level = Math.min(heading[1]?.length ?? 1, 6)
      const content = inline(heading[2] ?? '', key)
      blocks.push(level === 1
        ? <h1 key={key}>{content}</h1>
        : level === 2 ? <h2 key={key}>{content}</h2> : <h3 key={key}>{content}</h3>)
      index += 1
      continue
    }
    if (/^>\s?/u.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^>\s?/u.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^>\s?/u, ''))
        index += 1
      }
      blocks.push(<blockquote key={key}>{inline(quoted.join(' '), key)}</blockquote>)
      continue
    }
    if (isTableRow(line) && index + 1 < lines.length && /^\|[\s:|-]+\|$/u.test((lines[index + 1] ?? '').trim())) {
      const table: string[] = [line, lines[index + 1] ?? '']
      index += 2
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        table.push(lines[index] ?? '')
        index += 1
      }
      blocks.push(renderTable(table, key))
      continue
    }
    if (isListLine(line)) {
      const [list, next] = parseList(lines, index, listIndent(line))
      blocks.push(renderList(list, key))
      index = next
      continue
    }
    if (/^(?:---+|\*\*\*+|___+)$/u.test(line.trim())) {
      blocks.push(<hr key={key} />)
      index += 1
      continue
    }
    const paragraph: string[] = [line.trim()]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (next.trim() === '' || /^```|^#{1,6}\s|^>\s?|^(?:[-*+]|\d{1,3}[.)])\s+|^\|/u.test(next.trim())) break
      paragraph.push(next.trim())
      index += 1
    }
    blocks.push(<p key={key}>{inline(paragraph.join(' '), key)}</p>)
  }
  return blocks
}
