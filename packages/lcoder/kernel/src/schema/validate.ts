/**
 * `.spec/` 校验器：按目录约定逐文件解析，把所有问题汇总成一张清单。
 *
 * 两条刻意的设计：
 *   1. **一次报全，不是遇错即停。** 手写 .spec 时最烦的是修一个报一个。
 *   2. **未被任何 schema 覆盖的文件是警告，不是错误。** 用户可能在里面放备注；
 *      但必须让人知道它没被校验过，否则会误以为检查通过了。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { parse as parseYaml } from 'yaml'
import type { ZodType } from 'zod'

import { SpecLayout } from './spec.js'

export type Severity = 'error' | 'warn'

export interface ValidationIssue {
  /** 相对 .spec 根的 posix 路径 */
  file: string
  /** 数据路径，如 `rules[2].source.doc`；文件级问题为空串 */
  path: string
  message: string
  severity: Severity
}

export interface LoadedFile {
  file: string
  /** 命中的 layout glob */
  pattern: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
  loaded: LoadedFile[]
}

/** 缺失即失败的文件；其余按需要存在。 */
const REQUIRED = ['env.yaml', 'spec/rules.yaml'] as const

type LayoutEntry = { glob: string; schema: ZodType }

const LAYOUT: readonly LayoutEntry[] = SpecLayout.map(e => ({
  glob: e.glob,
  schema: e.schema as unknown as ZodType,
}))

/**
 * 最小 glob：`*` 匹配任意非 `/` 字符（可嵌在段内，如 `*.yaml`）。
 * 不引依赖；`**` 与 `?` 不支持的场景本项目用不到。
 */
const globCache = new Map<string, RegExp>()

function globToRegExp(pattern: string): RegExp {
  const hit = globCache.get(pattern)
  if (hit) return hit
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  const re = new RegExp(`^${escaped}$`)
  globCache.set(pattern, re)
  return re
}

function matchPattern(pattern: string, relPath: string): boolean {
  return globToRegExp(pattern).test(relPath)
}

/** 递归列出目录下全部文件，返回相对根的 posix 路径，已排序。 */
export function listFiles(root: string, dir = root): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFiles(root, full))
    } else if (entry.isFile()) {
      out.push(relative(root, full).split(sep).join('/'))
    }
  }
  return out.sort()
}

export { matchPattern }

function joinPath(base: ReadonlyArray<PropertyKey>): string {
  let out = ''
  for (const seg of base) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out === '' ? String(seg) : `.${String(seg)}`
  }
  return out
}

/**
 * 校验一个 `.spec` 目录。
 * @param root `.spec` 的绝对或相对路径
 */
export function validateSpec(root: string): ValidationResult {
  const issues: ValidationIssue[] = []
  const loaded: LoadedFile[] = []

  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return {
      ok: false,
      loaded: [],
      issues: [{ file: '', path: '', message: `不是目录或不存在：${root}`, severity: 'error' }],
    }
  }

  const files = listFiles(root)

  for (const required of REQUIRED) {
    if (!files.includes(required)) {
      issues.push({
        file: required,
        path: '',
        message: '缺少必需文件',
        severity: 'error',
      })
    }
  }

  for (const file of files) {
    const entry = LAYOUT.find(e => matchPattern(e.glob, file))

    if (!entry) {
      issues.push({
        file,
        path: '',
        message: '未被任何 schema 覆盖，不会被校验',
        severity: 'warn',
      })
      continue
    }

    let data: unknown
    try {
      data = parseYaml(readFileSync(join(root, file), 'utf8'))
    } catch (err) {
      issues.push({
        file,
        path: '',
        message: `YAML 解析失败：${(err as Error).message.split('\n')[0] ?? '未知错误'}`,
        severity: 'error',
      })
      continue
    }

    const parsed = entry.schema.safeParse(data)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          file,
          path: joinPath(issue.path),
          message: issue.message,
          severity: 'error',
        })
      }
      continue
    }

    loaded.push({ file, pattern: entry.glob })
  }

  issues.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.path.localeCompare(b.path) ||
      a.message.localeCompare(b.message),
  )

  return {
    ok: issues.every(i => i.severity !== 'error'),
    issues,
    loaded,
  }
}

/** 给人看的清单。空清单返回一句“通过”。 */
export function formatIssues(result: ValidationResult): string {
  if (result.issues.length === 0) {
    return `OK: ${result.loaded.length} 个文件通过校验`
  }
  const lines = result.issues.map((i) => {
    const where = i.path ? `${i.file} → ${i.path}` : i.file
    return `${i.severity === 'error' ? '✗' : '·'} ${where}: ${i.message}`
  })
  const errors = result.issues.filter(i => i.severity === 'error').length
  const warns = result.issues.length - errors
  lines.push(`共 ${errors} 个错误、${warns} 个警告`)
  return lines.join('\n')
}
