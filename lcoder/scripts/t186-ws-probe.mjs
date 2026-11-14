const [port, token, sessionId, interactions = 'answer'] = process.argv.slice(2)
if (port === undefined || token === undefined) {
  console.error('usage: node t186-ws-probe.mjs <port> <launchToken> <sessionId>')
  process.exit(2)
}

const login = await fetch(`http://127.0.0.1:${port}/connect?token=${token}&interactions=${interactions}`, { redirect: 'manual' })
const setCookie = login.headers.getSetCookie?.() ?? []
const cookie = (setCookie[0] ?? '').split(';', 1)[0]
const url = `ws://127.0.0.1:${port}/api/remote.mux`
const frames = []
const opened = []
let ws

const summary = (value) => {
  if (typeof value !== 'object' || value === null) return typeof value
  const keys = Object.keys(value)
  return `${keys.join(',')}${keys.includes('type') ? ` type=${String(value.type)}` : ''}`
}

const timer = setTimeout(() => finish('timeout'), 6000)

function finish(reason) {
  clearTimeout(timer)
  console.log(JSON.stringify({ cookie: cookie !== '', reason, opened, frames: frames.slice(0, 40) }, null, 2))
  try { ws?.close() } catch {}
  setTimeout(() => process.exit(0), 200)
}

try {
  ws = new WebSocket(url, { headers: { cookie } })
} catch (error) {
  console.log(JSON.stringify({ handshake: 'constructor-failed', message: String(error) }))
  process.exit(1)
}

ws.addEventListener('open', () => {
  opened.push('open')
  ws.send(JSON.stringify({ type: 'open', streamId: 'ev', endpoint: '$events', payload: { args: {} } }))
  ws.send(JSON.stringify({
    type: 'open',
    streamId: 'fol',
    endpoint: 'session/follow',
    payload: { args: { request: { address: { kind: 'session', sessionId }, activate: false, maxMessages: 20 } } },
  }))
})

ws.addEventListener('message', (event) => {
  let parsed
  try { parsed = JSON.parse(String(event.data)) } catch { parsed = String(event.data).slice(0, 80) }
  frames.push({
    streamId: typeof parsed === 'object' && parsed !== null ? parsed.streamId : undefined,
    type: typeof parsed === 'object' && parsed !== null ? parsed.type : undefined,
    summary: summary(typeof parsed === 'object' && parsed !== null && 'value' in parsed ? parsed.value : parsed),
    error: typeof parsed === 'object' && parsed !== null && 'error' in parsed ? parsed.error : undefined,
  })
  if (frames.some((frame) => frame.streamId === 'ev' && frame.type === 'error')) finish('events-error')
  if (frames.some((frame) => frame.streamId === 'ev' && frame.type === 'item')
    && frames.some((frame) => frame.streamId === 'fol' && frame.type === 'item')) {
    finish('both-first-items')
  }
})

ws.addEventListener('error', (event) => {
  console.log(JSON.stringify({ handshake: 'error', message: String(event?.message ?? ''), cause: String(event?.error?.cause ?? '') }))
  finish('error')
})

ws.addEventListener('close', (event) => {
  opened.push(`close:${String(event.code)}:${String(event.reason)}`)
  finish('closed')
})
