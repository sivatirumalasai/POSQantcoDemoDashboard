import { describe, it, expect, vi, afterEach } from 'vitest'
import { startLive } from '../live/connect.js'
import { useStore } from '../store/useStore.js'

afterEach(() => vi.unstubAllGlobals())

describe('startLive', () => {
  it('authenticates, opens a WebSocket and marks backendMode on open', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ access: 'jwt-token' }) })))

    const sent = []
    class FakeWS {
      constructor(url, protocols) { this.url = url; this.protocols = protocols; FakeWS.last = this }
      send(m) { sent.push(m) }
      close() { this.closed = true }
    }
    vi.stubGlobal('WebSocket', FakeWS)

    const stop = startLive()
    expect(typeof stop).toBe('function')

    // let getToken() + connect() microtasks resolve
    await vi.waitFor(() => expect(FakeWS.last).toBeTruthy())
    expect(FakeWS.last.protocols).toEqual(['access_token', 'jwt-token'])

    // simulate the socket opening
    FakeWS.last.onopen()
    expect(useStore.getState().backendMode).toBe(true)
    expect(sent[0]).toContain('snapshot') // snapshot-on-connect request

    stop()
    expect(FakeWS.last.closed).toBe(true)
  })
})
