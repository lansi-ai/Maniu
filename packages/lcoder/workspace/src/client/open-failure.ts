/**
 * 「打开仓库」的失败分类。
 *
 * 独立成模块的原因：`client/index.ts` 与 `shell/shell-data.ts` 都要用它，
 * 而 Shell 由 index 注册——若把错误类放进 index，shell 侧反向 import 就成环。
 *
 * 两种失败必须分开：超时说明调用还挂着（上游队列被永不 settle 的操作占住的
 * 表现，见台账 T-16），被拒绝说明对方明确回了错误。把两者都写成「打开失败」
 * 等于把可诊断信息丢掉。
 */

/** 等待超过 `openTimeoutMs` 时抛出；调用本身仍未返回。 */
export class WorkspaceOpenTimeoutError extends Error {
  /**
   * @param step - 卡住的步骤标识，如 `workspace/create`。
   * @param timeoutMs - 生效的等待上限。
   */
  constructor(readonly step: string, readonly timeoutMs: number) {
    super(`等待 ${step} 超过 ${String(timeoutMs)}ms 未返回`)
    this.name = 'WorkspaceOpenTimeoutError'
  }
}

/** 判断一次失败是不是超时。 */
export function isOpenTimeout(error: unknown): error is WorkspaceOpenTimeoutError {
  return error instanceof WorkspaceOpenTimeoutError
}

/** 失败分类结果：词典键 + 技术细节（步骤名或对方给的错误文本）。 */
export interface OpenFailure {
  readonly key: 'shell.openTimeout' | 'shell.openRejected'
  readonly detail: string
}

/**
 * 把一次打开仓库的失败归到「超时」或「被拒绝」两类。
 * @param error - 捕获到的失败值；非 Error 也要能给出可读细节。
 * @returns 供外壳取词典文案的键，以及附在后面的技术细节。
 */
export function describeOpenFailure(error: unknown): OpenFailure {
  if (isOpenTimeout(error)) return { key: 'shell.openTimeout', detail: error.step }
  if (error instanceof Error) return { key: 'shell.openRejected', detail: error.message }
  return { key: 'shell.openRejected', detail: String(error) }
}

/**
 * 给一步等待加上限。超时只让调用方脱身，底层 Promise 仍在挂——上游队列没有
 * 取消语义，这不是本包能修的（见台账 T-16）。
 * @param step - 步骤标识，进超时错误与错误文案。
 * @param work - 已经在跑的 Promise。
 * @param timeoutMs - 等待上限。
 * @returns work 的结果，或在超时后抛 `WorkspaceOpenTimeoutError`。
 */
export async function withOpenDeadline<T>(step: string, work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new WorkspaceOpenTimeoutError(step, timeoutMs))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
