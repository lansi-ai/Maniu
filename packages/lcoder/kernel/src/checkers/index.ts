/**
 * 检查器：收口前的三道必过判定。
 *
 * 三条纪律，缺一条就会退化成"模型说自己做完了"：
 *   1. **只读事实。** 输入是规格快照、代码索引、契约、证据清单——没有一句模型自述。
 *   2. **纯函数。** 不读盘、不调模型、不看时间。同样的输入永远给同样的结论。
 *   3. **每条违规都要说下一步。** 只说"不通过"等于把问题退回到人身上。
 *
 * P1 判「有没有落点」，P3 判「不可逆项有没有合法签署、签的是不是当前正文」，P4 判「有没有证据」。
 * 三条合起来回答一个问句：**这个任务凭什么算做完了。**
 */
import type { CodeIndex, SpecSnapshot } from '../kernel/spec-store.js'
import { findBindingIssues } from '../kernel/spec-store.js'
import type { ContractFact } from '../kernel/contract.js'
import { hasReviewEvidence } from '../kernel/evidence-store.js'
import { describeSelfSignFailure, evaluateSelfSignGate } from '../kernel/sign-gate.js'
import type { AutomationPolicy, Task } from '../schema/spec.js'

export type CheckerId = 'P1' | 'P3' | 'P4'

export interface Violation {
  checker: CheckerId
  /** 人可读定位：规格条目 id 或任务 id */
  subject: string
  detail: string
  /** 下一步该干什么。空字符串表示确实没什么可做的。 */
  hint: string
}

export interface CheckResult {
  ok: boolean
  violations: Violation[]
}

function summarize(violations: Violation[]): CheckResult {
  return { ok: violations.length === 0, violations }
}

// ── P1 条目有落点 ───────────────────────────────────────────

/**
 * 生效条目必须至少有一个落点，且落点指向的文件与符号真实存在。
 *
 * 复用 K-01 的 `findBindingIssues`——同一套比对逻辑，不再写第二份。
 */
export function checkP1(snapshot: SpecSnapshot, index: CodeIndex): CheckResult {
  const violations = findBindingIssues(snapshot, index).map((issue): Violation => {
    switch (issue.kind) {
      case 'missing-binding':
        return {
          checker: 'P1',
          subject: issue.ruleId,
          detail: '已确认的规格条目没有任何代码落点',
          hint: `用 spec_bind 把 ${issue.ruleId} 绑到具体文件与符号`,
        }
      case 'missing-file':
        return {
          checker: 'P1',
          subject: issue.ruleId,
          detail: `落点文件不存在：${issue.detail}`,
          hint: '文件被改名或移动了？重新绑定，或把条目改回 draft',
        }
      case 'missing-symbol':
        return {
          checker: 'P1',
          subject: issue.ruleId,
          detail: `落点符号在文件内找不到：${issue.detail}`,
          hint: '符号被重命名了？重新绑定，别让落点指向空气',
        }
    }
  })

  return summarize(violations)
}

// ── P3 不可逆项需人签署 ─────────────────────────────────────

/** P3 判 AI 自签需要的策略事实；不给按「策略为手动、无复核证据」处理。 */
export interface P3Context {
  readonly policy: AutomationPolicy
  /** 任务的证据清单（`loadEvidence` 的结果）；评审复核证据由它识别。 */
  readonly evidence: Readonly<Record<string, number>>
}

/**
 * 触及不可逆对象（对外接口 / 数据结构 / 权限 / 金额计算）时，
 * 契约必须存在、已签署，签名必须覆盖**当前**正文，且签署方式合法：
 * 人签；或 AI 自签且三补偿闸（策略 auto、无可逆项、有评审复核证据）同时成立。
 *
 * 不可逆项非空时第三闸永远不成立，所以「不可逆项永远人签」不是一句提示，而是这条判据的结果。
 * 手写一个 `by: agent` 也拦——没有策略与复核依据的自签名看起来像签过了，比没签更危险。
 *
 * 哈希比对拦的是另一种情形：字签过了，正文随后被改。`sig.hash` 是签署那一刻
 * 正文的复算值，与传进来的 `bodyHash` 不一致，签名作废、必须重签。所以这里要的
 * 不是"文件里写着签过"，而是"按现在的文件重算出来签过"。
 */
export function checkP3(task: Task, fact: ContractFact | null, context?: P3Context): CheckResult {
  const irreversible = task.scope.irreversible
  if (irreversible.length === 0) return summarize([])

  const items = irreversible.join('、')
  const violations: Violation[] = []

  if (fact === null) {
    violations.push({
      checker: 'P3',
      subject: task.id,
      detail: `任务触及不可逆项（${items}），但还没有契约`,
      hint: '先起草契约并让人签署，再动这些对象',
    })
    return summarize(violations)
  }

  const contract = fact.contract
  if (contract.sig === null) {
    violations.push({
      checker: 'P3',
      subject: task.id,
      detail: `契约存在但未签署，任务却要动不可逆项（${items}）`,
      hint: '请在界面上用 /contract_sign 签署契约；模型不能自行签署',
    })
    return summarize(violations)
  }

  if (contract.sig.by === 'agent') {
    const gate = evaluateSelfSignGate({
      signAuto: context?.policy.actions.sign === 'auto',
      irreversible,
      reviewEvidence: context !== undefined && hasReviewEvidence(context.evidence),
    })
    if (!gate.allowed) {
      violations.push({
        checker: 'P3',
        subject: task.id,
        detail: `不可逆项（${items}）的契约由 agent 自签，三补偿闸未同时成立：${describeSelfSignFailure(gate)}`,
        hint: '不可逆项永远由人签署；AI 自签只在不触及不可逆项、策略签署为 auto 且有评审复核证据时成立',
      })
      return summarize(violations)
    }
  }

  if (contract.sig.hash !== fact.bodyHash) {
    violations.push({
      checker: 'P3',
      subject: task.id,
      detail: `契约在签署后正文被改过（签名覆盖 ${contract.sig.hash.slice(0, 19)}…，当前正文 ${fact.bodyHash.slice(0, 19)}…）`,
      hint: '改动未经确认，签名已作废；请人用 /contract_sign 重签',
    })
  }

  return summarize(violations)
}

// ── P4 条目有证据 ───────────────────────────────────────────

/**
 * `evidence_required` 里的每一项，都必须在证据目录里有非空记录。
 *
 * 传的是 `名字 → 字节数`，而不是名字列表：**存在但空白的证据等于没证据**，
 * 这个区别只有带上大小才能判出来。
 */
export function checkP4(task: Task, evidence: Readonly<Record<string, number>>): CheckResult {
  const violations: Violation[] = []

  for (const required of task.evidence_required) {
    const bytes = evidence[required]
    if (bytes === undefined) {
      violations.push({
        checker: 'P4',
        subject: task.id,
        detail: `缺少证据：${required}`,
        hint: `跑一次 ${required} 并用 evidence_attach 回填`,
      })
    } else if (bytes <= 0) {
      violations.push({
        checker: 'P4',
        subject: task.id,
        detail: `证据 ${required} 是空的`,
        hint: '空文件不算证据，重新跑一次并写入输出',
      })
    }
  }

  return summarize(violations)
}
