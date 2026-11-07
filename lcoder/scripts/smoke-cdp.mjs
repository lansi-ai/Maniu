/**
 * Minimal Chrome DevTools Protocol client for the Electron renderer.
 *
 * The smoke attaches to the page target Electron exposes on its
 * `--remote-debugging-port` and evaluates probe expressions there. Only the
 * unary `Runtime.evaluate` path is needed, so this stays a small WebSocket
 * client instead of a full CDP library.
 */

const OPEN_TIMEOUT_MS = 10_000
const CALL_TIMEOUT_MS = 15_000

/**
 * Attach to the first `page` target whose URL starts with `origin`.
 * @param {number} port - Electron renderer debugging port.
 * @param {string} origin - Advertised host origin, e.g. `http://127.0.0.1:12345`.
 * @param {(message: string) => void} log - Progress sink.
 * @returns {Promise<CdpConnection>} connected client.
 */
export async function attachRenderer(port, origin, log) {
  let deadline = Date.now() + 20_000
  let lastError = 'no page target yet'
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets(port)
      const page = targets.find(target => target.type === 'page' && target.url.startsWith(origin))
        ?? targets.find(target => target.type === 'page' && target.url.startsWith('dsh-app://'))
        ?? targets.find(target => target.type === 'page' && !target.url.startsWith('devtools://'))
      if (page !== undefined && page.webSocketDebuggerUrl !== undefined) {
        const connection = await CdpConnection.open(page.webSocketDebuggerUrl)
        log(`cdp: attached ${page.url}`)
        return connection
      }
      lastError = `no matching page target (${targets.length} target(s))`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(250)
  }
  throw new Error(`cdp: renderer debugging port ${port} never exposed a page (${lastError})`)
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) })
  if (!response.ok) throw new Error(`target list HTTP ${response.status}`)
  const value = await response.json()
  if (!Array.isArray(value)) throw new Error('target list is not an array')
  return value.filter(item => item !== null && typeof item === 'object')
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export class CdpConnection {
  #socket
  #nextId = 1
  #pending = new Map()

  constructor(socket) {
    this.#socket = socket
    socket.addEventListener('message', event => {
      const message = parseMessage(event.data)
      if (message === undefined || typeof message.id !== 'number') return
      const entry = this.#pending.get(message.id)
      if (entry === undefined) return
      this.#pending.delete(message.id)
      if (message.error !== undefined) {
        entry.reject(new Error(`cdp: ${message.error.message ?? 'protocol error'}`))
        return
      }
      entry.resolve(message.result)
    })
  }

  /** @param {string} webSocketDebuggerUrl - target socket. */
  static open(webSocketDebuggerUrl) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketDebuggerUrl)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('cdp: websocket open timed out'))
      }, OPEN_TIMEOUT_MS)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve(new CdpConnection(socket))
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('cdp: websocket failed to open'))
      }, { once: true })
    })
  }

  /**
   * Send one protocol command.
   * @param {string} method - CDP method.
   * @param {Record<string, unknown>} params - method parameters.
   * @returns {Promise<Record<string, unknown>>} result payload.
   */
  send(method, params = {}) {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`cdp: ${method} timed out`))
      }, CALL_TIMEOUT_MS)
      this.#pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) },
      })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /**
   * Evaluate one expression in the page and return its JSON value.
   * @param {string} expression - JavaScript source.
   * @returns {Promise<unknown>} evaluated value.
   */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })
    const details = result?.exceptionDetails
    if (details !== undefined) {
      throw new Error(`renderer exception: ${details.text ?? details.exception?.description ?? 'unknown'}`)
    }
    return result?.result?.value
  }

  /**
   * Poll an expression until it returns a truthy value.
   * @param {string} expression - JavaScript expression.
   * @param {number} timeoutMs - total wait budget.
   * @param {string} label - failure description.
   * @returns {Promise<unknown>} the first truthy value.
   */
  async waitFor(expression, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs
    let last
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression)
        if (last) return last
      } catch {
        // The renderer may be mid-navigation; the next poll retries.
      }
      await sleep(150)
    }
    throw new Error(`renderer: ${label} not satisfied after ${timeoutMs} ms (last=${JSON.stringify(last)})`)
  }

  close() {
    try { this.#socket.close() } catch { /* already closed */ }
  }
}

function parseMessage(data) {
  try {
    const value = JSON.parse(String(data))
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

/** Shared DOM helpers used by the probes. */
export const dom = {
  /** Click the first element matching a selector; reports whether one existed. */
  click: selector => `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (element === null) return false;
    element.click();
    return true;
  })()`,
  /** Set a React-controlled input's value through the native setter and fire `input`. */
  fill: (selector, value) => `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (element === null) return 'missing';
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter === undefined) return 'no-setter';
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return element.value === ${JSON.stringify(value)} ? 'ok' : 'mismatch';
  })()`,
  /** Short visible text of every element matching a selector. */
  texts: selector => `[...document.querySelectorAll(${JSON.stringify(selector)})]
    .map(element => (element.innerText ?? element.textContent ?? '').replace(/\\s+/g, ' ').trim())
    .filter(text => text !== '')`,
  /** Click the first element whose visible text contains a needle. */
  clickText: (selector, needle) => `(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(candidate => ((candidate.innerText ?? candidate.textContent ?? '').includes(${JSON.stringify(needle)})));
    if (element === undefined) return false;
    element.click();
    return true;
  })()`,
}
