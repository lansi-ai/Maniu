/**
 * T-186 实验探针：订阅 $events 后新开一条会话，验 api-session/added 真实投递。
 *
 * 每次自取新 cookie（一个 API socket 拥有其 Peer，旧 socket 关闭后旧 cookie 失效）。
 * 用法：node lcoder/scripts/t186-events-probe.mjs <port> <launchToken> <scratchCwd>
 */
const [port, token, scratch] = process.argv.slice(2)
if (port === undefined || token === undefined || scratch === undefined) {
  console.error('usage: node t186-events-probe.mjs <port> <launchToken> <scratchCwd>')
  process.exit(2)
}

const result = { cookie: false, ready: false, created: null, events: [], reason: 'timeout' }
const finish = (reason) => {
  result.reason = reason
  console.log(JSON.stringify(result, null, 2))
  try { ws.close() } catch {}
  setTimeout(() => process.exit(0), 150)
}

const login = await fetch(`http://127.0.0.1:${port}/connect?token=${token}&interactions=answer`, { redirect: 'manual' })
const setCookie = login.headers.getSetCookie?.() ?? []
const cookie = (setCookie[0] ?? '').split(';', 1)[0]
result.cookie = cookie !== ''

const ws = new WebSocket(`ws://127.0.0.1:${port}/api/remote.mux`, { headers: { cookie } })
setTimeout(() => finish('timeout'), 8000)

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'open', streamId: 'ev', endpoint: '$events', payload: { args: {} } }))
})

ws.addEventListener('message', async (event) => {
  let parsed
  try { parsed = JSON.parse(String(event.data)) } catch { return }
  if (parsed.type !== 'item' || parsed.streamId !== 'ev') return
  const value = parsed.value
  if (value?.type === 'ready') {
    result.ready = true
    const body = {
      type: 'client-request',
      rpcId: `t186-ev-${String(Date.now())}`,
      method: 'session/create',
      payload: { args: { request: { cwd: scratch } } },
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/session/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    })
    result.created = await response.json()
    return
  }
  const name = value?.event?.name ?? value?.event ?? value?.name
  result.events.push({ keys: Object.keys(value ?? {}), name: String(name) })
  if (String(name).includes('api-session/added')) finish('got-api-session-added')
})

ws.addEventListener('error', (event) => {
  result.events.push({ error: String(event?.message ?? 'ws-error') })
  finish('ws-error')
})
ws.addEventListener('close', (event) => {
  result.events.push({ close: `${String(event.code)}:${String(event.reason)}` })
  finish('ws-closed')
})
