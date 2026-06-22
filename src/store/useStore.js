import { create } from 'zustand'
import { queryReports } from '../sim/history.js'

/**
 * Read-model store, mirroring the README's design:
 *   "a Zustand store keyed by venue_id. Components subscribe selectively —
 *    one venue's update re-renders one row, not all 40."
 *
 * Data flow:  WS/sim snapshot → applySnapshot() → selector → memoised component → DOM
 *
 * The `reports` slice is kept deliberately separate from the live slices (per the
 * README: "held in a separate Zustand reports slice so it never churns the live
 * store"). The 1s live tick only writes the live keys; runReport() only writes
 * `reports` — so the History view never re-renders on a live tick, and vice-versa.
 */
export const useStore = create((set, get) => ({
  // ── live read model ──
  venues: {},          // { [id]: { id, name, net, txns, voids, refunds, flag, hourly, items } }
  order: [],           // venue ids, ranked by net sales desc
  groupItems: {},      // { itemName: qtySold } across the whole group
  flags: [],           // active anomaly flags (flags:active)
  kpis: { net: 0, rate: 0, tps: 0, totalTxns: 0, netTrend: 0 },
  history: { net: [], rate: [], tps: [] },
  flashId: null,       // venue id to flash this tick (biggest mover)
  tick: 0,             // increments every batched snapshot
  selectedVenueId: null,
  itemScope: 'group',  // 'group' | 'venue'

  // ── view + reporting (separate read path) ──
  view: 'live',        // 'live' | 'history'
  backendMode: false,  // true once the live WebSocket is connected
  reports: { loading: false, params: null, groupBy: 'day', rows: [], summary: null },

  // one batched snapshot replaces the live slices (the 1s ticker fan-out)
  applySnapshot: (snap) => set(() => ({
    venues: snap.venues,
    order: snap.order,
    groupItems: snap.groupItems,
    flags: snap.flags,
    kpis: snap.kpis,
    history: snap.history,
    flashId: snap.flashId,
    tick: snap.tick,
  })),

  selectVenue: (id) => set({ selectedVenueId: id }),
  closeDrill: () => set((s) => ({
    selectedVenueId: null,
    itemScope: s.itemScope === 'venue' ? 'group' : s.itemScope,
  })),
  setItemScope: (scope) => set({ itemScope: scope }),

  setView: (view) => set({ view }),

  // GET /api/reports/sales — backend rollups when connected, else local fallback
  runReport: async (params) => {
    set((s) => ({ reports: { ...s.reports, loading: true } }))

    // try the real reporting endpoint first
    try {
      const q = new URLSearchParams({ from: params.from, to: params.to, group_by: params.groupBy })
      if (params.venueId) q.set('venue', String(params.venueId))
      const res = await fetch(`/api/reports/sales?${q.toString()}`)
      if (res.ok) {
        const data = await res.json()
        set({ reports: { loading: false, params, groupBy: data.groupBy, rows: data.rows, summary: data.summary } })
        return
      }
    } catch { /* backend not reachable — fall through to local */ }

    // local fallback (in-browser rollup generator)
    const venues = Object.values(get().venues).map((v) => ({ id: v.id, name: v.name }))
    const perVenue = {}
    Object.values(get().venues).forEach((v) => {
      perVenue[v.id] = { net: v.net, txns: v.txns, voids: v.voids, refunds: v.refunds }
    })
    const r = queryReports(venues, { ...params, live: { perVenue } })
    set({ reports: { loading: false, params, groupBy: r.groupBy, rows: r.rows, summary: r.summary } })
  },
}))
