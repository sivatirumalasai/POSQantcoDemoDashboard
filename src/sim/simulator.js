/**
 * Transaction simulator — stands in for the live WebSocket feed.
 *
 * In production this module is replaced by a WebSocket client: the `onmessage`
 * handler would call `store.applySnapshot(snapshot)` exactly as the 1s ticker
 * below does. Everything downstream (store → selectors → memoised components)
 * stays identical, which is the whole point of the README's CQRS-lite design.
 */
import { useStore } from '../store/useStore.js'

const CITIES = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Newcastle', 'Canberra', 'Hobart', 'Darwin']
const TYPES = ['Taphouse', 'Rooftop Bar', 'Bistro', 'Grill', 'Wine Room', 'Brewhouse', 'Kitchen', 'Lounge', 'Cantina', 'Smokehouse']
export const ITEMS = [
  'Pale Ale Schooner', 'Margherita Pizza', 'Wagyu Burger', 'House Negroni', 'Loaded Fries',
  'Espresso Martini', 'Garlic Bread', 'Chicken Parma', 'Pinot Noir', 'Calamari',
  'Aperol Spritz', 'Tasting Plate', 'Pulled Pork Roll', 'Frozen Margarita', 'Truffle Pasta',
  'Salt & Pepper Squid', 'Sparkling Water', 'Flat White', 'Cheese Board', 'Sticky Date Pudding',
]

const pick = (a) => a[Math.floor(Math.random() * a.length)]

// authoritative mutable model (the "real" world the POS terminals act on)
const model = []
const groupItems = {}
const flags = []
let totalTxns = 0
let tpsWindow = []
const history = { net: [], rate: [], tps: [] }
let lastNetSnapshot = 0
let booted = false

function build() {
  if (booted) return
  booted = true
  const seen = {}
  for (let i = 0; i < 40; i++) {
    let name = `${pick(CITIES)} ${pick(TYPES)}`
    while (seen[name]) name += ' II'
    seen[name] = 1
    model.push({
      id: i + 1,
      name,
      net: Math.random() * 4000 + 800,
      txns: Math.floor(Math.random() * 400 + 60),
      voids: Math.floor(Math.random() * 8),
      refunds: Math.floor(Math.random() * 12),
      rate: 0.4 + Math.random() * 1.6,
      flag: null,
      hourly: Array.from({ length: 18 }, () => Math.random() * 600 + 100),
      items: {},
      lastNet: 0,
      _dirty: true,
    })
  }
  model.forEach((v) => { totalTxns += v.txns })
  ITEMS.forEach((it) => { groupItems[it] = Math.floor(Math.random() * 300 + 50) })
  lastNetSnapshot = model.reduce((s, v) => s + v.net, 0)
}

function emitTxn() {
  const v = model.find((x) => Math.random() < x.rate / 2 + 0.15) || pick(model)
  const isRefund = Math.random() < 0.04
  const isVoid = Math.random() < 0.03
  const amt = Math.random() * 70 + 8
  if (isRefund) { v.net -= amt; v.refunds++ }
  else if (isVoid) { v.voids++ }
  else {
    v.net += amt; v.txns++; totalTxns++
    const item = pick(ITEMS)
    groupItems[item] = (groupItems[item] || 0) + 1
    v.items[item] = (v.items[item] || 0) + 1
    v.hourly[v.hourly.length - 1] += amt
  }
  v._dirty = true                 // mark venue dirty (README: aggregators mark dirty, ticker coalesces)
  tpsWindow.push(performance.now())
}

function pad(n) { return String(n).padStart(2, '0') }

function maybeAnomaly() {
  if (Math.random() > 0.5) return
  const v = pick(model)
  if (v.flag) return
  const r = Math.random()
  const now = new Date()
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  let type, why
  if (r < 0.4) {
    type = 'drop'
    why = `Run-rate fell to ${Math.floor(Math.random() * 15 + 45)}% of trailing baseline for 2 consecutive windows.`
  } else if (r < 0.75) {
    type = 'spike'
    why = `(voids + refunds) / sales hit ${Math.floor(Math.random() * 12 + 9)}% over the rolling 30-min window — above this venue's threshold.`
  } else {
    type = 'hot'
    why = `Trading ${Math.floor(Math.random() * 40 + 30)}% above baseline — positive signal. Consider routing support to this venue.`
  }
  v.flag = type
  v._dirty = true
  flags.push({ id: `${v.id}-${now.getTime()}`, venue: v.name, type, why, time, active: true, born: performance.now() })
}

function clearOldAnomalies() {
  flags.forEach((f) => {
    if (f.active && performance.now() - f.born > 16000) {
      f.active = false
      const v = model.find((x) => x.name === f.venue)
      if (v) { v.flag = null; v._dirty = true }
    }
  })
}

// the 1-second batched ticker: coalesce dirty venues into ONE immutable snapshot
function tick() {
  const cut = performance.now() - 1000
  tpsWindow = tpsWindow.filter((t) => t > cut)

  const net = model.reduce((s, v) => s + v.net, 0)
  const rate = Math.max(0, net - lastNetSnapshot) * 60
  lastNetSnapshot = net
  history.net.push(net); if (history.net.length > 60) history.net.shift()
  history.rate.push(rate); if (history.rate.length > 60) history.rate.shift()
  history.tps.push(tpsWindow.length); if (history.tps.length > 60) history.tps.shift()

  // biggest mover this tick → flash target
  let flashId = null, best = 30
  model.forEach((v) => {
    const d = v.net - (v.lastNet ?? v.net)
    if (d > best) { best = d; flashId = v.id }
    v.lastNet = v.net
  })

  clearOldAnomalies()

  // build snapshot: new object ONLY for dirty venues (identity preserved otherwise
  // → memoised rows for unchanged venues don't re-render)
  const prev = useStore.getState().venues
  const venues = {}
  for (const v of model) {
    if (v._dirty || !prev[v.id]) {
      venues[v.id] = {
        id: v.id, name: v.name, net: v.net, txns: v.txns,
        voids: v.voids, refunds: v.refunds, flag: v.flag,
        hourly: v.hourly.slice(), items: { ...v.items },
      }
      v._dirty = false
    } else {
      venues[v.id] = prev[v.id]
    }
  }

  const order = Object.values(venues).sort((a, b) => b.net - a.net).map((v) => v.id)
  const active = flags.filter((f) => f.active)
  const netTrend = +(Math.sin(performance.now() / 9000) * 6 + 8).toFixed(1)

  useStore.getState().applySnapshot({
    venues,
    order,
    groupItems: { ...groupItems },
    flags: active.slice(-12).reverse(),
    kpis: { net, rate, tps: tpsWindow.length, totalTxns, netTrend },
    history: { net: history.net.slice(), rate: history.rate.slice(), tps: history.tps.slice() },
    flashId,
    tick: useStore.getState().tick + 1,
  })
}

let timers = []
export function startSimulator() {
  build()
  tick() // prime the store immediately so first paint has data
  timers.push(setInterval(() => {
    const n = Math.floor(Math.random() * 22 + 8)
    for (let i = 0; i < n; i++) emitTxn()
  }, 120))
  timers.push(setInterval(maybeAnomaly, 3500))
  timers.push(setInterval(tick, 1000)) // the 1s batching tick
  return () => { timers.forEach(clearInterval); timers = [] }
}
