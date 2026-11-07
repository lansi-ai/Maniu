/**
 * 登录状态的 React 读取面：首次装载、窗口获得焦点时复查、登录后主动刷新。
 *
 * 只缓存展示值；匿名剩余量仍以服务端返回为准。
 */
import { useEffect, useRef, useState } from 'react'
import type { CloudErrorInfo, CloudState } from '@lcoder/kernel/src/cloud/types.ts'
import type { CloudFace } from './face.ts'

/** 外壳读到的登录会话。 */
export interface CloudSession {
  readonly state: CloudState | null
  readonly loading: boolean
  readonly error: CloudErrorInfo | null
  /** 重新读一次；并发调用共享同一个在途请求。 */
  readonly refresh: () => Promise<void>
}

/**
 * 订阅云端登录状态。
 * @param face - 云端数据面；未挂载时为 undefined。
 * @returns 状态、加载位与刷新函数。
 */
export function useCloudSession(face: CloudFace | undefined): CloudSession {
  const [state, setState] = useState<CloudState | null>(null)
  const [loading, setLoading] = useState(face !== undefined)
  const [error, setError] = useState<CloudErrorInfo | null>(null)
  const flight = useRef<Promise<void> | null>(null)
  const alive = useRef(true)

  const refresh = async (): Promise<void> => {
    if (face === undefined || !face.available) {
      setLoading(false)
      setError({ code: 'cloud_unavailable', message: 'cloud remote is not mounted' })
      return
    }
    if (flight.current !== null) return flight.current
    setLoading(true)
    const run = (async () => {
      try {
        const answer = await face.state()
        if (!alive.current) return
        if (answer.ok) {
          setState(answer.value)
          setError(answer.value.lastError)
        } else {
          setError(answer.error)
        }
      } catch (failure: unknown) {
        if (alive.current) {
          setError({ code: 'cloud_unavailable', message: failure instanceof Error ? failure.message : String(failure) })
        }
      } finally {
        if (alive.current) setLoading(false)
      }
    })().finally(() => { flight.current = null })
    flight.current = run
    return run
  }

  useEffect(() => {
    alive.current = true
    void refresh()
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      alive.current = false
      window.removeEventListener('focus', onFocus)
    }
    // `refresh` 是每次渲染的新闭包；这里只跟着数据面身份重挂。
  }, [face])

  return { state, loading, error, refresh }
}
