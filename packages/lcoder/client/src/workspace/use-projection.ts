/** 工作台投影的加载状态：按作用域会话读 `.spec`。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { specFilesOf } from '../spec/files.ts'
import { emptyProjection, loadSpecProjection, type SpecProjection } from '../spec/load.ts'

/** 首读失败后的退避间隔；用尽后停在错误上，由手动刷新接管。 */
const RETRY_DELAYS_MS: readonly number[] = [400, 1200, 3000]

/** 一次投影读取的状态。 */
export interface ProjectionState {
  readonly projection: SpecProjection
  readonly loading: boolean
  readonly error: string | null
  readonly reload: () => void
}

/**
 * 读一个作用域会话的投影。宿主就绪前不读，避免冷启动首读撞上 `host-not-ready`；
 * 读取失败按退避重试有限次，期间 `loading` 保持为真，不并发重复请求。
 * @param scopeSessionId - 提供 `.spec` 相对基准的会话；null 表示还没选项目。
 * @param ready - 宿主是否已就绪；false 时挂起读取并在就绪后自动加载。
 * @returns 投影、加载态与重读方法。
 */
export function useProjection(scopeSessionId: string | null, ready: boolean): ProjectionState {
  const [projection, setProjection] = useState<SpecProjection>(emptyProjection)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    if (scopeSessionId === null || !ready) {
      if (scopeSessionId === null) {
        setProjection(emptyProjection)
        setError(null)
      }
      setLoading(false)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const scope = scopeSessionId
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    function load(): void {
      setLoading(true)
      void loadSpecProjection(specFilesOf(scope), controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return
          setProjection(next)
          if (next.problems.length === 0) {
            setError(null)
            setLoading(false)
            return
          }
          setError(next.problems.join('\n'))
          scheduleRetry()
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return
          setError(cause instanceof Error ? cause.message : String(cause))
          scheduleRetry()
        })
    }

    function scheduleRetry(): void {
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined) {
        setLoading(false)
        return
      }
      attempt += 1
      timer = setTimeout(() => { timer = null; load() }, delay)
    }

    load()
    return () => {
      controller.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [generation, ready, scopeSessionId])

  const reload = useCallback(() => { setGeneration(current => current + 1) }, [])
  return { projection, loading, error, reload }
}
