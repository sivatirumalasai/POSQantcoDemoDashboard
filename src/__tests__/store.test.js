import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useStore } from '../store/useStore.js'

const snapshot = {
  venues: { 1: { id: 1, name: 'A', net: 100, txns: 5, voids: 0, refunds: 1, flag: null, hourly: [], items: {} } },
  order: [1],
  groupItems: { Beer: 3 },
  flags: [],
  kpis: { net: 100, rate: 10, tps: 2, totalTxns: 5, netTrend: 8 },
  history: { net: [100], rate: [10], tps: [2] },
  flashId: null,
  tick: 1,
}

beforeEach(() => {
  useStore.setState({
    venues: {}, order: [], groupItems: {}, flags: [],
    kpis: { net: 0, rate: 0, tps: 0, totalTxns: 0, netTrend: 0 },
    history: { net: [], rate: [], tps: [] }, flashId: null, tick: 0,
    view: 'live', backendMode: false,
    reports: { loading: false, params: null, groupBy: 'day', rows: [], summary: null },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('applySnapshot', () => {
  it('replaces the live slices', () => {
    useStore.getState().applySnapshot(snapshot)
    const s = useStore.getState()
    expect(s.order).toEqual([1])
    expect(s.venues[1].net).toBe(100)
    expect(s.kpis.net).toBe(100)
    expect(s.tick).toBe(1)
  })
})

describe('view + selection', () => {
  it('setView toggles the view', () => {
    useStore.getState().setView('history')
    expect(useStore.getState().view).toBe('history')
  })
  it('closeDrill clears selection and resets venue scope', () => {
    useStore.setState({ selectedVenueId: 5, itemScope: 'venue' })
    useStore.getState().closeDrill()
    expect(useStore.getState().selectedVenueId).toBeNull()
    expect(useStore.getState().itemScope).toBe('group')
  })
})

describe('runReport', () => {
  it('uses the backend response when fetch succeeds', async () => {
    const payload = { groupBy: 'day', rows: [{ key: 'd', label: 'd', net: 42 }], summary: { totalNet: 42 } }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })))

    await useStore.getState().runReport({ from: '2026-01-01', to: '2026-01-02', groupBy: 'day', venueId: null })
    const r = useStore.getState().reports
    expect(r.loading).toBe(false)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].net).toBe(42)
  })

  it('falls back to the local generator when fetch fails', async () => {
    useStore.getState().applySnapshot(snapshot) // gives the local generator a venue
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    await useStore.getState().runReport({ from: '2026-01-01', to: '2026-01-03', groupBy: 'day', venueId: null })
    const r = useStore.getState().reports
    expect(r.loading).toBe(false)
    expect(r.groupBy).toBe('day')
    expect(r.rows.length).toBeGreaterThan(0)   // produced locally, not from backend
  })
})
