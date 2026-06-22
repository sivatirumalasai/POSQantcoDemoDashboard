/**
 * Live backend client — replaces the in-browser simulator with the real
 * Django Channels feed.
 *
 *   1. auto-login (POST /api/auth/token) to get a JWT
 *   2. open WebSocket /ws/dashboard/ with the token as a subprotocol
 *   3. request snapshot-on-connect, then apply every broadcast snapshot
 *   4. reconnect with exponential backoff + jitter
 *
 * If the backend can't be reached (e.g. `npm run dev` with no backend), it
 * falls back to the in-browser simulator so the UI still works.
 */
import { useStore } from '../store/useStore.js'
import { startSimulator } from '../sim/simulator.js'

const OPS_USER = { username: 'ops', password: 'ops12345' }

async function getToken() {
  try {
    const res = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(OPS_USER),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.access || null
  } catch {
    return null
  }
}

export function startLive() {
  let ws = null
  let stopped = false
  let attempts = 0
  let fellBack = null // simulator stop fn if we fall back

  const wsUrl = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}/ws/dashboard/`
  }

  const fallback = () => {
    if (fellBack || stopped) return
    console.warn('[live] backend unreachable — falling back to in-browser simulator')
    useStore.setState({ backendMode: false })
    fellBack = startSimulator()
  }

  const connect = async () => {
    if (stopped) return
    const token = await getToken()
    // subprotocols: ['access_token', '<jwt>'] — token rides the handshake, not the URL
    const protocols = token ? ['access_token', token] : undefined
    try {
      ws = protocols ? new WebSocket(wsUrl(), protocols) : new WebSocket(wsUrl())
    } catch {
      return scheduleReconnect()
    }

    ws.onopen = () => {
      attempts = 0
      useStore.setState({ backendMode: true })
      ws.send(JSON.stringify({ action: 'snapshot' })) // catch up immediately
    }
    ws.onmessage = (ev) => {
      try {
        const snap = JSON.parse(ev.data)
        if (snap && snap.venues) useStore.getState().applySnapshot(snap)
      } catch { /* ignore malformed frame */ }
    }
    ws.onclose = () => { if (!stopped) scheduleReconnect() }
    ws.onerror = () => { try { ws.close() } catch { /* noop */ } }
  }

  const scheduleReconnect = () => {
    attempts += 1
    if (attempts >= 4 && !fellBack) { fallback(); return } // give the backend a few tries, then fall back
    const backoff = Math.min(1000 * 2 ** attempts, 15000)
    const jitter = backoff * 0.3 * Math.random()
    setTimeout(connect, backoff + jitter)
  }

  connect()

  return () => {
    stopped = true
    if (ws) { try { ws.close() } catch { /* noop */ } }
    if (fellBack) fellBack()
  }
}
