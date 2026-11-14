/** 工作台投影的加载状态：按作用域会话读 `.spec`。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { specFilesOf } from '../spec/files.ts'
import { emptyProjection, loadSpecProjection, type SpecProjection } from '../spec/load.ts'

/** 一次投影读取的状态。 */
export interface ProjectionState {
  readonly projection: SpecProjection
  readonly loading: boolean
  readonly error: string | null
  readonly reload: () => void
}

/**
 * 读一个作用域会话的投影。
 * @param scopeSessionId - 提供 `.spec` 相对基准的会话；null 表示还没选项目。
 * @returns 投影、加载态与重读方法。
 */
export function useProjection(scopeSessionId: string | null): ProjectionState {
  const [projection, setProjection] = useState<SpecProjection>(emptyProjection)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    if (scopeSessionId === null) {
      setProjection(emptyProjection)
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    void loadSpecProjection(specFilesOf(scopeSessionId), controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return
        setProjection(next)
        setError(next.problems.length === 0 ? null : next.problems.join('\n'))
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setLoading(false)
      })
    return () => { controller.abort() }
  }, [scopeSessionId, generation])

  const reload = useCallback(() => { setGeneration(current => current + 1) }, [])
  return { projection, loading, error, reload }
}
