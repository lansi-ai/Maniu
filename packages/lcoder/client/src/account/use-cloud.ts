/** 登录状态的 React 读取面：首次装载、窗口聚焦复查与手动刷新。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cloudFace, type CloudErrorInfo, type CloudState } from './cloud.ts'

/** 外壳读到的登录会话。 */
export interface CloudSession {
  readonly state: CloudState | null
  readonly loading: boolean
  /** 读不到登录状态的阻断性错误；与「未登录」分开。 */
  readonly error: CloudErrorInfo | null
  /** 重新读一次；并发调用共享同一个在途请求。 */
  readonly refresh: () => Promise<void>
}

/**
 * 订阅云端登录状态。
 * @param enabled - 宿主就绪后为 true；false 时不发请求。
 * @returns 状态、加载位、阻断错误与刷新函数。
 */
export function useCloudSession(enabled: boolean): CloudSession {
  const [state, setState] = useState<CloudState | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<CloudErrorInfo | null>(null)
  const flight = useRef<Promise<void> | null>(null)
  const alive = useRef(true)

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve()
    if (flight.current !== null) return flight.current
    setLoading(true)
    const run = (async () => {
      let failure: CloudErrorInfo | undefined
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const answer = await cloudFace.state()
        if (!alive.current) return
        if (answer.ok) {
          setState(answer.value)
          setError(null)
          setLoading(false)
          return
        }
        failure = answer.error
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300))
      }
      // 两次都失败才算「云端不可用」；一次抖动不该把用户赶到错误页。
      if (!alive.current) return
      setError(failure ?? { code: 'cloud_unavailable', message: '云端调用失败' })
      setLoading(false)
    })().finally(() => { flight.current = null })
    flight.current = run
    return run
  }, [enabled])

  useEffect(() => {
    alive.current = true
    if (!enabled) {
      setLoading(false)
      return
    }
    void refresh()
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      alive.current = false
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled, refresh])

  return { state, loading, error, refresh }
}
