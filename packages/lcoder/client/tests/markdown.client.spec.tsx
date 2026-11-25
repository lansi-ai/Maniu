// @vitest-environment node
/** Markdown 渲染器：缩进嵌套列表、列表项行内语法与段落收尾。 */
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/markdown/markdown.tsx'

/** 渲染成静态 HTML，并去掉行内文本包裹的 span 便于比对结构。 */
function render(text: string): string {
  const html = renderToStaticMarkup(createElement(Fragment, null, ...renderMarkdown(text)))
  return html.replaceAll('<span>', '').replaceAll('</span>', '')
}

describe('列表缩进嵌套', () => {
  it('两个空格一级缩进渲染成嵌套 ul', () => {
    expect(render('- 第一项\n  - 子项一\n  - 子项二\n- 第二项'))
      .toBe('<ul><li>第一项<ul><li>子项一</li><li>子项二</li></ul></li><li>第二项</li></ul>')
  })

  it('制表符按一级缩进处理，支持三级嵌套', () => {
    expect(render('- 一级\n\t- 二级\n\t\t- 三级'))
      .toBe('<ul><li>一级<ul><li>二级<ul><li>三级</li></ul></li></ul></li></ul>')
  })

  it('有序列表作为子列表时生成 ol，外层仍保持 ul', () => {
    expect(render('- 步骤\n  1. 第一步\n  2. 第二步'))
      .toBe('<ul><li>步骤<ol><li>第一步</li><li>第二步</li></ol></li></ul>')
  })

  it('嵌套结束后同层条目继续落在本层列表', () => {
    expect(render('- 一\n  - 一甲\n- 二'))
      .toBe('<ul><li>一<ul><li>一甲</li></ul></li><li>二</li></ul>')
  })
})

describe('列表项行内语法', () => {
  it('列表项内粗体、代码与链接继续走行内渲染', () => {
    expect(render('- **粗体**与`代码`和[文档](https://example.com/a)'))
      .toBe('<ul><li><strong>粗体</strong>与<code>代码</code>和<a href="https://example.com/a" target="_blank" rel="noreferrer">文档</a></li></ul>')
  })

  it('列表结束后普通段落单独成块', () => {
    expect(render('- 一项\n\n正文说明'))
      .toBe('<ul><li>一项</li></ul><p>正文说明</p>')
  })
})
