/**
 * 规格库：把 `.spec/` 读成结构化快照，并在快照与代码事实之间算差异。
 *
 * 一条分工：
 *   `loadSpec` 读盘（有副作用）；`diffSpec` / `findBindingIssues` **纯函数**，
 *   只吃快照和代码索引，不碰磁盘、不调模型。这样差异计算可以在测试里
 *   拿内存数据反复跑，也是后面 P1 / P6 / P7 复用同一套比对的理由。
 *
 * 读取失败直接抛：调用方应先跑 `validateSpec` 拿到人能读的错误清单，
 * 而不是在这里猜哪里坏了。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { RulesFile, RuleEntry, StateMachine } from '../schema/spec.js'
import { listFiles, matchPattern } from '../schema/validate.js'

export interface SpecSnapshot {
  root: string
  rules: RuleEntry[]
  states: StateMachine[]
}

/** 读一个 `.spec` 目录。只收规则与状态机——契约/任务/环境由各自模块读。 */
export function loadSpec(root: string): SpecSnapshot {
  const rules: RuleEntry[] = []
  const states: StateMachine[] = []

  for (const file of listFiles(root)) {
    const full = join(root, file)
    if (matchPattern('spec/rules.yaml', file)) {
      rules.push(...RulesFile.parse(parseYaml(readFileSync(full, 'utf8'))).rules)
    } else if (matchPattern('spec/states/*.yaml', file)) {
      states.push(StateMachine.parse(parseYaml(readFileSync(full, 'utf8'))))
    }
  }

  return { root, rules, states }
}

/** 把规则写回 `spec/rules.yaml`。写前过一遍 schema，避免写出坏文件。 */
export function saveRules(root: string, rules: RuleEntry[]): string {
  const path = join(root, 'spec', 'rules.yaml')
  const data = RulesFile.parse({ rules })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringifyYaml(data), 'utf8')
  return path
}

/**
 * 下一个可用条目编号：取现有 `R-<数字>` 里的最大号往后一位。
 * 其它前缀（如 `DR-01`）不参与取最大——登记新条目统一给 `R-`，
 * 前缀本身要跟着既有约定走时由调用方显式指定。
 * @param rules - 规格里已有的条目。
 * @returns 形如 `R-03` 的编号。
 */
export function nextRuleId(rules: readonly RuleEntry[]): string {
  let max = 0
  for (const rule of rules) {
    const digits = /^R-(\d+)$/.exec(rule.id)?.[1]
    if (digits !== undefined) max = Math.max(max, Number.parseInt(digits, 10))
  }
  return `R-${String(max + 1).padStart(2, '0')}`
}

/**
 * 正文查重键：空白与大小写不算差异，口径与 `task-store` 的标题查重一致。
 * @param rules - 规格里已有的条目。
 * @param text - 准备新增的正文。
 * @returns 命中同正文的既有条目；没有则 undefined。
 */
export function findByText(rules: readonly RuleEntry[], text: string): RuleEntry | undefined {
  const key = text.toLowerCase().replace(/\s+/g, '')
  return rules.find(rule => rule.text.toLowerCase().replace(/\s+/g, '') === key)
}

// ── 代码事实 ────────────────────────────────────────────────

/**
 * 判断落点是否成立的抽象。真正接代码时换成 AST 索引；
 * MVP-0 先给文本实现，够用，但有明确局限（见下面注释）。
 */
export interface CodeIndex {
  hasFile(path: string): boolean
  hasSymbol(path: string, symbol: string): boolean
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 文本索引：按词边界找符号名。
 *
 * **已知局限，不要假装没有**：注释和字符串里提到同名标识符也会命中。
 * 所以它只能证明「这个符号名出现在文件里」，不能证明「这里实现了它」。
 * 换 AST 之前，P1 的失败要人工复核，通过则可以直接信。
 */
export function textCodeIndex(files: Readonly<Record<string, string>>): CodeIndex {
  return {
    hasFile: path => Object.hasOwn(files, path),
    hasSymbol: (path, symbol) => {
      const content = files[path]
      if (content === undefined) return false
      return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(symbol)}(?![A-Za-z0-9_])`).test(content)
    },
  }
}

/** 从真实目录建文本索引。跳过 `.spec` 与依赖/产物目录。 */
export function textCodeIndexFromDir(repoRoot: string, skipDirs: readonly string[] = []): CodeIndex {
  const skip = new Set(['node_modules', 'dist', '.git', '.spec', 'coverage', ...skipDirs])
  const files: Record<string, string> = {}

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(full)
      } else if (entry.isFile()) {
        try {
          files[relative(repoRoot, full).split(sep).join('/')] = readFileSync(full, 'utf8')
        } catch {
          // 二进制或不可读：跳过，不影响其余文件的索引
        }
      }
    }
  }

  walk(repoRoot)
  return textCodeIndex(files)
}

// ── 差异计算（纯函数）──────────────────────────────────────
export type BindingIssueKind = 'missing-binding' | 'missing-file' | 'missing-symbol'

export interface BindingIssue {
  ruleId: string
  kind: BindingIssueKind
  /** 人可读的定位：`file#symbol` 或空 */
  detail: string
}

/** 落点清单，`file#symbol` 形式。symbol 缺省时只给文件名。 */
export function bindingMap(snapshot: SpecSnapshot): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const rule of snapshot.rules) {
    out.set(
      rule.id,
      rule.found_at.map(loc => (loc.symbol ? `${loc.file}#${loc.symbol}` : loc.file)),
    )
  }
  return out
}

/**
 * 找落点问题。只看 `confirmed` 条目——`draft` 本来就没打算当实现依据。
 */
export function findBindingIssues(snapshot: SpecSnapshot, index: CodeIndex): BindingIssue[] {
  const issues: BindingIssue[] = []

  for (const rule of snapshot.rules) {
    if (rule.status !== 'confirmed') continue

    if (rule.found_at.length === 0) {
      issues.push({ ruleId: rule.id, kind: 'missing-binding', detail: '' })
      continue
    }

    for (const loc of rule.found_at) {
      const detail = loc.symbol ? `${loc.file}#${loc.symbol}` : loc.file
      if (!index.hasFile(loc.file)) {
        issues.push({ ruleId: rule.id, kind: 'missing-file', detail })
        continue
      }
      if (loc.symbol && !index.hasSymbol(loc.file, loc.symbol)) {
        issues.push({ ruleId: rule.id, kind: 'missing-symbol', detail })
      }
    }
  }

  return issues
}

export interface SpecDiff {
  ok: boolean
  /** 参与判定的条目数（confirmed） */
  confirmed: number
  /** 落点全部成立的条目数 */
  bound: number
  /** 完全没有落点的条目 */
  unbound: RuleEntry[]
  broken: BindingIssue[]
}

/**
 * 规格 ↔ 代码的差异。
 *
 * `unbound` 与 `broken` **互斥**：前者是「根本没声明落点」，后者是
 * 「声明了但指向失效」。合成一类会让同一条目被数两次，看板上就失真了。
 */
export function diffSpec(snapshot: SpecSnapshot, index: CodeIndex): SpecDiff {
  const confirmed = snapshot.rules.filter(r => r.status === 'confirmed')
  const issues = findBindingIssues(snapshot, index)
  const unbound = confirmed.filter(r => r.found_at.length === 0)
  const broken = issues.filter(i => i.kind !== 'missing-binding')
  const brokenIds = new Set(broken.map(b => b.ruleId))

  return {
    ok: broken.length === 0 && unbound.length === 0,
    confirmed: confirmed.length,
    bound: confirmed.filter(r => r.found_at.length > 0 && !brokenIds.has(r.id)).length,
    unbound,
    broken,
  }
}
