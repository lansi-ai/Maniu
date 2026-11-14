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
      const kind = listKind(line)
      const items: string[] = []
      while (index < lines.length && isListLine(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^(?:[-*+]|\d{1,3}[.)])\s+/u, ''))
        index += 1
      }
      const children = items.map((item, itemIndex) => <li key={String(itemIndex)}>{inline(item, `${key}-${String(itemIndex)}`)}</li>)
      blocks.push(kind === 'ol' ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>)
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
