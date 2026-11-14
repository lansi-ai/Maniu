/** 运行中会话集合：主进程据此决定关窗是否需要确认。 */

/** 按 `api-session/status` 事件维护的在跑会话。 */
export class RunningTurns {
  private readonly sessions = new Set<string>()

  /**
   * 记录一条会话的运行状态；同一会话反复上报只保留最后状态。
   * @param sessionId - 会话标识。
   * @param running - 是否在跑回合。
   */
  update(sessionId: string, running: boolean): void {
    if (running) this.sessions.add(sessionId)
    else this.sessions.delete(sessionId)
  }

  /** 当前在跑的会话数。 */
  get count(): number {
    return this.sessions.size
  }
}
