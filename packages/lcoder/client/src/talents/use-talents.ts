/** 人才库运行面：读云端两库、维护本机清单、按摘要下发/撤回，并把失败逐条留下。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyRowOf, attemptOf, needsProjectIdFix, planSync, presetIdOf, type TalentApplyFailure,
  type TalentCatalogView, type TalentProjectView, type TalentRow,
} from './model.ts'
import {
  applyTalent, createTalent as createCloudTalent, deleteTalent as deleteCloudTalent, ensureProjectIdentity,
  listTalents, loadCatalog, loadProjectIdentity, removeTalent, talentSessionRefs, updateTalent as updateCloudTalent,
  type CreateTalentInput, type UpdateTalentInput,
} from './api.ts'

/** 挂载人才库运行面的输入。 */
export interface TalentsOptions {
  /** 云端是否已登录；未登录时不下发也不读取。 */
  readonly signedIn: boolean
  /** 当前项目根目录；没有项目时只有全局库。 */
  readonly projectPath: string | null
}

/** 页面拿到的运行面。 */
export interface TalentsHandle {
  readonly catalog: TalentCatalogView | null
  readonly catalogError: string | null
  readonly project: TalentProjectView | null
  readonly projectError: string | null
  readonly global: readonly TalentRow[]
  readonly projectTalents: readonly TalentRow[]
  readonly loading: boolean
  readonly error: string | null
  /** 单条人才的下发或撤回失败；按人才 id 分组。 */
  readonly applyErrors: Readonly<Record<string, string>>
  /** 已成功下发、可以发起会话的人才 id。 */
  readonly applied: ReadonlySet<string>
  readonly busy: boolean
  /** 人才 preset id → 显示名；会话列表用它标注归属。 */
  readonly presetNames: Readonly<Record<string, string>>
  reload(): void
  create(input: CreateTalentInput): Promise<string | null>
  update(input: UpdateTalentInput): Promise<string | null>
  remove(id: string): Promise<string | null>
  checkRefs(id: string): Promise<TalentSessionRefs>
}

/** 删除前查引用的结果。 */
export type TalentSessionRefs =
  | { readonly ok: true; readonly sessionIds: readonly string[] }
  | { readonly ok: false; readonly message: string }

/**
 * 订阅云端人才并按摘要下发到宿主。
 *
 * 摘要不变的人才不会重复下发；单条人才用单独一次调用，任何一条失败都只
 * 记在这条人才上。退出登录时尝试撤回全部已下发人才，仍有会话引用的由宿主
 * 拒绝，保留到下个会话结束后再清。
 * @param options - 登录态与当前项目路径。
 * @returns 页面使用的数据与动作。
 */
export function useTalents(options: TalentsOptions): TalentsHandle {
  const { signedIn, projectPath } = options
  const [catalog, setCatalog] = useState<TalentCatalogView | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [project, setProject] = useState<TalentProjectView | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [global, setGlobal] = useState<readonly TalentRow[]>([])
  const [projectTalents, setProjectTalents] = useState<readonly TalentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applyErrors, setApplyErrors] = useState<Readonly<Record<string, string>>>({})
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [reloadSeq, setReloadSeq] = useState(0)
  const appliedRef = useRef(new Map<string, string>())
  const failedRef = useRef(new Map<string, TalentApplyFailure>())
  const syncingRef = useRef(false)
  const queuedRef = useRef<readonly TalentRow[] | null>(null)
  const signedInRef = useRef(signedIn)
  const fixedPathsRef = useRef(new Set<string>())

  const reload = useCallback(() => { setReloadSeq(current => current + 1) }, [])

  useEffect(() => {
    if (!signedIn) {
      setCatalog(null)
      setCatalogError(null)
      return
    }
    let disposed = false
    void loadCatalog().then((answer) => {
      if (disposed) return
      if (answer.ok) {
        setCatalog(answer.value)
        setCatalogError(null)
      } else {
        setCatalog(null)
        setCatalogError(`${answer.code}: ${answer.message}`)
      }
    })
    return () => { disposed = true }
  }, [signedIn, reloadSeq])

  useEffect(() => {
    if (!signedIn || projectPath === null) {
      setProject(null)
      setProjectError(null)
      return
    }
    let disposed = false
    const isDisposed = (): boolean => disposed
    void loadProjectIdentity(projectPath).then(async (answer) => {
      if (isDisposed()) return
      if (!answer.ok) {
        setProject(null)
        setProjectError(`${answer.code}: ${answer.message}`)
        return
      }
      if (needsProjectIdFix(answer.value, fixedPathsRef.current)) {
        // 老项目缺字段：读到即补一次，同一路径在本进程内不重复尝试；缺文件仍由只读结果报错。
        fixedPathsRef.current.add(projectPath)
        const fixed = await ensureProjectIdentity(projectPath)
        if (isDisposed()) return
        if (!fixed.ok) {
          setProject(answer.value)
          setProjectError(`${fixed.code}: ${fixed.message}`)
          return
        }
        setProject(fixed.value)
        setProjectError(null)
        return
      }
      setProject(answer.value)
      setProjectError(null)
    })
    return () => { disposed = true }
  }, [signedIn, projectPath, reloadSeq])

  const identityPending = projectPath !== null && (project === null || project.path !== projectPath)

  useEffect(() => {
    if (!signedIn) {
      setGlobal([])
      setProjectTalents([])
      setLoading(false)
      setError(null)
      return
    }
    if (identityPending) return
    let disposed = false
    const isDisposed = (): boolean => disposed
    setLoading(true)
    setError(null)
    void (async () => {
      const globalAnswer = await listTalents('global')
      if (isDisposed()) return
      if (!globalAnswer.ok) {
        setGlobal([])
        setProjectTalents([])
        setError(`${globalAnswer.code}: ${globalAnswer.message}`)
        setLoading(false)
        return
      }
      let projectRows: readonly TalentRow[] = []
      let projectFailure: string | null = null
      if (project !== null && project.state === 'ready' && project.projectId !== null) {
        const projectAnswer = await listTalents('project', project.projectId)
        if (isDisposed()) return
        if (projectAnswer.ok) projectRows = projectAnswer.value
        else projectFailure = `${projectAnswer.code}: ${projectAnswer.message}`
      }
      setGlobal(globalAnswer.value)
      setProjectTalents(projectRows)
      setError(projectFailure)
      setLoading(false)
    })()
    return () => { disposed = true }
  }, [signedIn, identityPending, project, reloadSeq])

  const reconcile = useCallback(async (rows: readonly TalentRow[]): Promise<void> => {
    const plan = planSync(appliedRef.current, rows)
    const nextErrors: Record<string, string> = {}
    const nextApplied = new Set<string>(plan.unchanged)
    for (const row of plan.apply) {
      const attempt = attemptOf(row, failedRef.current)
      if (attempt.kind === 'skip') {
        // 同一份配置已经失败过：保留可读原因，不每轮重试同一份定义。
        nextErrors[row.id] = attempt.message
        continue
      }
      const answer = await applyTalent(applyRowOf(row))
      if (answer.ok) {
        appliedRef.current.set(row.id, attempt.digest)
        failedRef.current.delete(row.id)
        nextApplied.add(row.id)
      } else {
        const message = `${answer.code}: ${answer.message}`
        failedRef.current.set(row.id, { digest: attempt.digest, message })
        nextErrors[row.id] = message
      }
    }
    for (const id of plan.remove) {
      const answer = await removeTalent(id)
      if (answer.ok || answer.code === 'agent-talent/not-found') {
        appliedRef.current.delete(id)
        failedRef.current.delete(id)
      } else {
        // 仍有本机会话引用时宿主拒绝撤回；保留登记，等会话结束后的下一次同步再试。
        nextErrors[id] = `${answer.code}: ${answer.message}`
      }
    }
    setApplied(nextApplied)
    setApplyErrors(nextErrors)
  }, [])

  const runSync = useCallback(async (rows: readonly TalentRow[]): Promise<void> => {
    if (syncingRef.current) {
      queuedRef.current = rows
      return
    }
    syncingRef.current = true
    try {
      let current = rows
      for (;;) {
        await reconcile(current)
        const queued = queuedRef.current
        if (queued === null) break
        queuedRef.current = null
        current = queued
      }
    } finally {
      syncingRef.current = false
    }
  }, [reconcile])

  useEffect(() => {
    if (!signedIn || loading || error !== null) return
    void runSync([...global, ...projectTalents])
  }, [signedIn, loading, error, global, projectTalents, runSync])

  useEffect(() => {
    const was = signedInRef.current
    signedInRef.current = signedIn
    if (!was || signedIn) return
    const ids = [...appliedRef.current.keys()]
    appliedRef.current.clear()
    failedRef.current.clear()
    setApplied(new Set())
    setApplyErrors({})
    for (const id of ids) void removeTalent(id)
  }, [signedIn])

  const finishMutation = useCallback((answer: { ok: boolean; code?: string; message?: string }): string | null => {
    if (answer.ok) {
      reload()
      return null
    }
    return `${answer.code ?? 'error'}: ${answer.message ?? ''}`
  }, [reload])

  const create = useCallback(async (input: CreateTalentInput): Promise<string | null> => {
    setBusy(true)
    try {
      return finishMutation(await createCloudTalent(input))
    } finally {
      setBusy(false)
    }
  }, [finishMutation])

  const update = useCallback(async (input: UpdateTalentInput): Promise<string | null> => {
    setBusy(true)
    try {
      return finishMutation(await updateCloudTalent(input))
    } finally {
      setBusy(false)
    }
  }, [finishMutation])

  const remove = useCallback(async (id: string): Promise<string | null> => {
    setBusy(true)
    try {
      return finishMutation(await deleteCloudTalent(id))
    } finally {
      setBusy(false)
    }
  }, [finishMutation])

  const checkRefs = useCallback(async (id: string): Promise<TalentSessionRefs> => {
    const answer = await talentSessionRefs(id)
    return answer.ok ? { ok: true, sessionIds: answer.value } : { ok: false, message: `${answer.code}: ${answer.message}` }
  }, [])

  const presetNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const row of [...global, ...projectTalents]) names[presetIdOf(row.id)] = row.name
    return names
  }, [global, projectTalents])

  return {
    catalog, catalogError, project, projectError, global, projectTalents, loading, error,
    applyErrors, applied, busy, presetNames, reload, create, update, remove, checkRefs,
  }
}
