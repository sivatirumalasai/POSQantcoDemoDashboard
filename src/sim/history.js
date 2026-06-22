/**
 * Historical "rollup" data source — stands in for the README's reporting read path:
 *
 *   GET /api/reports/sales?from=&to=&group_by=venue|day|item
 *   served from pre-aggregated daily rollup tables (daily_venue_sales,
 *   daily_venue_item_sales), unioning today's partial from the live read model.
 *
 * Numbers are generated deterministically (seeded by venue+date) so the same
 * query always returns the same figures — re-renders never shuffle the data.
 * Swap queryReports() for a real fetch() and the UI is unchanged.
 */
import { ITEMS } from './simulator.js'

// ── deterministic PRNG (seeded by a string) ──
function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = (seed) => mulberry32(hashStr(seed))

// ── date helpers (local-time, no UTC drift) ──
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }
export function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d) }
export function enumerateDays(from, to) {
  const out = []; let cur = from; let guard = 0
  while (cur <= to && guard < 500) { out.push(cur); cur = addDays(cur, 1); guard++ }
  return out
}
export function fmtDay(iso) {
  return parseISO(iso).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
}

// Sun..Sat trade weighting — weekends run hot
const DOW = [0.95, 0.82, 0.85, 0.9, 1.0, 1.35, 1.5]

const _base = {}
function baseFor(vid) {
  if (_base[vid] != null) return _base[vid]
  const b = 1500 + rng('base-' + vid)() * 7000
  _base[vid] = b
  return b
}

function dayMetrics(vid, iso) {
  const base = baseFor(vid)
  const dow = DOW[parseISO(iso).getDay()]
  const r = rng(vid + '|' + iso)
  const net = base * dow * (0.78 + r() * 0.5)
  const avgTicket = 20 + r() * 18
  const txns = Math.max(1, Math.round(net / avgTicket))
  const voids = Math.round(txns * (0.004 + r() * 0.02))
  const refunds = Math.round(txns * (0.008 + r() * 0.03))
  return { net, txns, voids, refunds }
}

const itemPrice = (item) => 7 + rng('p-' + item)() * 33
const _w = {}
function normWeights(vid) {
  if (_w[vid]) return _w[vid]
  const raw = {}; let sum = 0
  ITEMS.forEach((it) => { raw[it] = 0.3 + rng('w-' + vid + '-' + it)(); sum += raw[it] })
  const out = {}; ITEMS.forEach((it) => { out[it] = raw[it] / sum })
  _w[vid] = out
  return out
}

function finalize(rows, groupBy, dayCount) {
  const totalNet = rows.reduce((s, r) => s + r.net, 0)
  const totalTxns = rows.reduce((s, r) => s + (r.txns || 0), 0)
  const totalVoids = rows.reduce((s, r) => s + (r.voids || 0), 0)
  const totalRefunds = rows.reduce((s, r) => s + (r.refunds || 0), 0)
  const bestDay = groupBy === 'day'
    ? rows.reduce((b, r) => (!b || r.net > b.net ? r : b), null)
    : null
  return {
    rows, groupBy,
    summary: { totalNet, totalTxns, totalVoids, totalRefunds, dayCount, avgPerDay: dayCount ? totalNet / dayCount : 0, bestDay },
  }
}

/**
 * @param allVenues [{id,name}]
 * @param params { from, to, venueId|null, groupBy:'day'|'venue'|'item', todayISO, live }
 *   live: { perVenue: { [id]: {net,txns,voids,refunds} } } — today's partial from the read model
 */
export function queryReports(allVenues, params) {
  const { from, to, venueId, groupBy, live, todayISO } = params
  const venues = venueId ? allVenues.filter((v) => v.id === venueId) : allVenues
  const days = enumerateDays(from, to)
  const useLiveToday = !!live && !!todayISO && days.includes(todayISO)
  const genDays = useLiveToday ? days.filter((d) => d !== todayISO) : days

  if (groupBy === 'day') {
    const rows = days.map((iso) => {
      let net = 0, txns = 0, voids = 0, refunds = 0
      if (useLiveToday && iso === todayISO) {
        venues.forEach((v) => { const l = live.perVenue[v.id]; if (l) { net += l.net; txns += l.txns; voids += l.voids; refunds += l.refunds } })
        return { key: iso, label: iso, net, txns, voids, refunds, live: true }
      }
      venues.forEach((v) => { const m = dayMetrics(v.id, iso); net += m.net; txns += m.txns; voids += m.voids; refunds += m.refunds })
      return { key: iso, label: iso, net, txns, voids, refunds }
    })
    return finalize(rows, groupBy, days.length)
  }

  if (groupBy === 'venue') {
    const rows = venues.map((v) => {
      let net = 0, txns = 0, voids = 0, refunds = 0
      genDays.forEach((iso) => { const m = dayMetrics(v.id, iso); net += m.net; txns += m.txns; voids += m.voids; refunds += m.refunds })
      if (useLiveToday) { const l = live.perVenue[v.id]; if (l) { net += l.net; txns += l.txns; voids += l.voids; refunds += l.refunds } }
      return { key: v.id, label: v.name, net, txns, voids, refunds }
    }).sort((a, b) => b.net - a.net)
    return finalize(rows, groupBy, days.length)
  }

  // group_by === 'item'
  const acc = {}; ITEMS.forEach((it) => { acc[it] = { net: 0, qty: 0 } })
  venues.forEach((v) => {
    const weights = normWeights(v.id)
    genDays.forEach((iso) => {
      const m = dayMetrics(v.id, iso)
      const r = rng('di-' + v.id + '-' + iso)
      ITEMS.forEach((it) => {
        const rev = m.net * weights[it] * (0.85 + r() * 0.3)
        acc[it].net += rev
        acc[it].qty += rev / itemPrice(it)
      })
    })
  })
  const rows = ITEMS.map((it) => ({ key: it, label: it, net: acc[it].net, qty: Math.round(acc[it].qty) }))
    .sort((a, b) => b.net - a.net)
  return finalize(rows, groupBy, days.length)
}

// preset date ranges relative to a given "today"
export function presetRange(name, todayISO) {
  const t = parseISO(todayISO)
  const firstOfMonth = (d) => isoDate(new Date(d.getFullYear(), d.getMonth(), 1))
  switch (name) {
    case '7d': return { from: addDays(todayISO, -6), to: todayISO }
    case '30d': return { from: addDays(todayISO, -29), to: todayISO }
    case '90d': return { from: addDays(todayISO, -89), to: todayISO }
    case 'thisMonth': return { from: firstOfMonth(t), to: todayISO }
    case 'lastMonth': {
      const lm = new Date(t.getFullYear(), t.getMonth() - 1, 1)
      const lastDay = new Date(t.getFullYear(), t.getMonth(), 0)
      return { from: isoDate(lm), to: isoDate(lastDay) }
    }
    default: return { from: addDays(todayISO, -29), to: todayISO }
  }
}
