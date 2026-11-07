/**
 * Host-side helpers for the LCoder smoke: the product's own HTTP RPC transport
 * and the persisted Session header.
 *
 * The renderer talks to the Host by POSTing `client-request` envelopes to
 * `/api/<namespace>/<method>` with the browser-session cookie minted by the
 * `?token=` launch URL. This module performs the same exchange, so probes call
 * the real Remote surface instead of a hand-built protocol frame (PITFALLS W-07).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { zstdDecompressSync } from 'node:zlib'

/** One failed Remote call: either transport-level or a Host RemoteError. */
export class HostRpcError extends Error {
  /** @param {string} code - failure code. @param {string} message - human message. */
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'HostRpcError'
    this.code = code
  }
}

export class HostRpc {
  /** @param {string} origin - Host origin, e.g. `http://127.0.0.1:12345`. @param {string} cookie - browser-session cookie pair. */
  constructor(origin, cookie) {
    this.origin = origin
    this.cookie = cookie
  }

  /**
   * Exchange the launch URL's token for the browser-session cookie.
   * @param {string} readyUrl - `dsh web` ready line URL, including `?token=`.
   * @returns {Promise<HostRpc>} authenticated caller.
   */
  static async connect(readyUrl) {
    const url = new URL(readyUrl)
    const response = await fetch(readyUrl, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    if (response.status !== 303) {
      throw new HostRpcError('auth/rejected', `launch URL returned HTTP ${response.status}`)
    }
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? '']
    const cookie = (cookies[0] ?? '').split(';', 1)[0].trim()
    if (cookie === '') throw new HostRpcError('auth/rejected', 'launch URL set no session cookie')
    return new HostRpc(url.origin, cookie)
  }

  /**
   * Invoke one unary Remote method.
   * @param {string} method - `<namespace>/<method>`, e.g. `session/list`.
   * @param {Record<string, unknown>} args - named arguments.
   * @returns {Promise<unknown>} the Remote value.
   */
  async call(method, args = {}) {
    const rpcId = randomUUID()
    const response = await fetch(`${this.origin}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new HostRpcError('transport/failed', `${method} HTTP ${response.status}`)
    const envelope = await response.json()
    const result = envelope?.result
    if (envelope?.type !== 'server-response' || result === undefined || result === null) {
      throw new HostRpcError('transport/invalid', `${method} returned a malformed envelope`)
    }
    if (envelope.rpcId !== rpcId) throw new HostRpcError('transport/mismatch', `${method} rpcId mismatch`)
    if (result.ok !== true) {
      throw new HostRpcError(String(result.error?.code ?? 'remote/failed'), String(result.error?.message ?? 'unknown'))
    }
    return result.value
  }

  /** Clear any stored cloud tokens so the login-gate probe starts signed out. */
  async signOut() {
    try { await this.call('lcoderCloud/logout') } catch { /* already signed out */ }
  }

  /**
   * Register a disposable local account against the dev mock cloud.
   * @param {{phone: string, password: string}} account - credentials for this run.
   */
  async register(account) {
    await this.call('lcoderCloud/sendSms', { input: { phone: account.phone, purpose: 'register' } })
    const value = await this.call('lcoderCloud/register', {
      input: {
        phone: account.phone,
        code: '123456',
        password: account.password,
        displayName: 'smoke',
      },
    })
    if (value?.ok !== true) {
      throw new HostRpcError(String(value?.error?.code ?? 'cloud/register-failed'),
        String(value?.error?.message ?? 'register failed'))
    }
  }
}

/**
 * Read the newest persisted Session header written after `sinceMs`.
 *
 * Session files are independent zstd frames; the first frame is the header
 * (PITFALLS W-11). Only the header is read here.
 *
 * @param {string} homeDir - Desktop development home.
 * @param {number} sinceMs - ignore files older than this.
 * @param {(header: Record<string, unknown>) => boolean} accept - header filter.
 * @returns {{path: string, header: Record<string, unknown>} | undefined} match.
 */
export function newestSessionHeader(homeDir, sinceMs, accept) {
  const sessionsRoot = join(homeDir, 'sessions')
  let workspaces
  try { workspaces = readdirSync(sessionsRoot, { withFileTypes: true }) } catch { return undefined }
  const candidates = []
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    let sessions
    try { sessions = readdirSync(join(sessionsRoot, workspace.name), { withFileTypes: true }) } catch { continue }
    for (const session of sessions) {
      if (!session.isDirectory() || !session.name.startsWith('session-')) continue
      const path = join(sessionsRoot, workspace.name, session.name, 'session.v4.jsonl.zstd')
      try {
        const stat = statSync(path)
        if (stat.mtimeMs >= sinceMs) candidates.push({ path, mtimeMs: stat.mtimeMs })
      } catch { /* not flushed yet */ }
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  for (const candidate of candidates) {
    try {
      const text = zstdDecompressSync(readFileSync(candidate.path)).toString('utf8')
      const first = text.split('\n', 1)[0]
      const header = JSON.parse(first)
      if (header !== null && typeof header === 'object' && accept(header)) {
        return { path: candidate.path, header }
      }
    } catch { /* mid-write frame */ }
  }
  return undefined
}
