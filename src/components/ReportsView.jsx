import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { fmt, money } from '../utils.js'
import { isoDate, parseISO, fmtDay, presetRange } from '../sim/history.js'
import AreaChart from './AreaChart.jsx'

const PRESETS = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
]
const GROUPS = [
  { key: 'day', label: 'By day' },
  { key: 'venue', label: 'By venue' },
  { key: 'item', label: 'By item' },
]

const compact = (iso) => { const d = parseISO(iso); return `${d.getDate()}/${d.getMonth() + 1}` }

export default function ReportsView() {
  const todayISO = useMemo(() => isoDate(new Date()), [])
  const runReport = useStore((s) => s.runReport)
  const reports = useStore((s) => s.reports)

  // venue options captured once — names are stable, so we don't subscribe to the
  // live venues map (that would re-render this view on every 1s tick).
  const venueOpts = useMemo(
    () => Object.values(useStore.getState().venues).map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  )

  const [preset, setPreset] = useState('30d')
  const init = useMemo(() => presetRange('30d', todayISO), [todayISO])
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [groupBy, setGroupBy] = useState('day')
  const [venueId, setVenueId] = useState('') // '' = all

  // fire the "REST call" whenever the query changes
  useEffect(() => {
    runReport({ from, to, groupBy, venueId: venueId ? Number(venueId) : null, todayISO })
  }, [from, to, groupBy, venueId, todayISO, runReport])

  const applyPreset = (key) => {
    const r = presetRange(key, todayISO)
    setPreset(key); setFrom(r.from); setTo(r.to)
  }

  const { rows, summary, loading } = reports
  const venueName = venueId ? venueOpts.find((v) => v.id === Number(venueId))?.name : 'All venues'

  // chart series
  const chart = useMemo(() => {
    if (!rows?.length) return []
    if (groupBy === 'day') return rows.map((r) => ({ label: compact(r.label), value: r.net, live: r.live }))
    return rows.slice(0, 14).map((r) => ({ label: r.label, value: r.net })) // for bar list
  }, [rows, groupBy])

  return (
    <div className="reports">
      {/* controls */}
      <div className="rep-controls">
        <div className="rep-presets">
          {PRESETS.map((p) => (
            <button key={p.key} className={preset === p.key ? 'on' : ''} onClick={() => applyPreset(p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="rep-spacer" />
        <div className="field">
          <label>From</label>
          <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset('') }} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} min={from} max={todayISO} onChange={(e) => { setTo(e.target.value); setPreset('') }} />
        </div>
        <div className="field">
          <label>Venue</label>
          <select className="rep-select" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            <option value="">All venues</option>
            {venueOpts.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Group by</label>
          <div className="seg">
            {GROUPS.map((g) => (
              <button key={g.key} className={groupBy === g.key ? 'on' : ''} onClick={() => setGroupBy(g.key)}>{g.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* summary KPIs */}
      <div className="rep-kpis">
        <div className="kpi" style={{ '--accent': 'var(--brand)' }}>
          <div className="label">Net Sales · range</div>
          <div className="val"><span className="cur">$</span>{summary ? fmt(summary.totalNet) : '0'}</div>
          <div className="sub">{venueName} · {summary?.dayCount ?? 0} days</div>
        </div>
        <div className="kpi" style={{ '--accent': 'var(--green)' }}>
          <div className="label">Avg / day</div>
          <div className="val"><span className="cur">$</span>{summary ? fmt(summary.avgPerDay) : '0'}</div>
          <div className="sub">across the selected range</div>
        </div>
        <div className="kpi" style={{ '--accent': 'var(--blue)' }}>
          <div className="label">Transactions</div>
          <div className="val">{summary ? fmt(summary.totalTxns) : '0'}</div>
          <div className="sub"><b>{summary ? fmt(summary.totalVoids) : 0}</b> voids · <b>{summary ? fmt(summary.totalRefunds) : 0}</b> refunds</div>
        </div>
        <div className="kpi" style={{ '--accent': 'var(--amber)' }}>
          <div className="label">Best day</div>
          <div className="val" style={{ fontSize: 19 }}>{summary?.bestDay ? money(summary.bestDay.net) : '—'}</div>
          <div className="sub">{summary?.bestDay ? fmtDay(summary.bestDay.label) : 'n/a for this grouping'}</div>
        </div>
      </div>

      {/* chart + table */}
      <div className="rep-grid">
        <div className="panel">
          <div className="head">
            <h2>{groupBy === 'day' ? 'Net sales by day' : groupBy === 'venue' ? 'Net sales by venue' : 'Revenue by item'}</h2>
            <div className="spacer" />
            <span className="count">{loading ? 'querying rollups…' : `${rows?.length ?? 0} rows`}</span>
          </div>
          <div className="body" style={{ padding: groupBy === 'day' ? '18px 16px 8px' : '6px 0' }}>
            {groupBy === 'day' ? (
              <AreaChart data={chart} />
            ) : (
              <BarList rows={rows} valueKey="net" />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="head">
            <h2>{groupBy === 'day' ? 'Daily breakdown' : groupBy === 'venue' ? 'Venue breakdown' : 'Item breakdown'}</h2>
            <div className="spacer" />
            <span className="count">rollup rows</span>
          </div>
          <div className="body">
            <ReportTable rows={rows} groupBy={groupBy} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  )
}

function BarList({ rows, valueKey }) {
  if (!rows?.length) return <div className="rep-empty">No data for this range.</div>
  const top = rows.slice(0, 14)
  const max = top[0]?.[valueKey] || 1
  return (
    <div>
      {top.map((r, i) => (
        <div className="item-row" key={r.key}>
          <div className="item-rank">{i + 1}</div>
          <div className="item-main">
            <div className="item-name">{r.label}</div>
            <div className="item-bar"><i style={{ width: `${((r[valueKey] / max) * 100).toFixed(0)}%`, background: 'linear-gradient(90deg,var(--brand),#ff9a52)' }} /></div>
          </div>
          <div className="item-qty">{money(r[valueKey])}<small>{r.qty != null ? `${fmt(r.qty)} sold` : 'net'}</small></div>
        </div>
      ))}
    </div>
  )
}

function ReportTable({ rows, groupBy, loading }) {
  if (loading && !rows?.length) return <div className="rep-empty">Querying daily rollups…</div>
  if (!rows?.length) return <div className="rep-empty">No data for this range.</div>

  if (groupBy === 'item') {
    return (
      <table className="rep-table">
        <thead><tr><th>Item</th><th className="num">Revenue</th><th className="num">Qty sold</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}><td className="name">{r.label}</td><td className="num">{money(r.net)}</td><td className="num">{fmt(r.qty)}</td></tr>
          ))}
        </tbody>
      </table>
    )
  }

  const firstCol = groupBy === 'day' ? 'Date' : 'Venue'
  return (
    <table className="rep-table">
      <thead>
        <tr><th>{firstCol}</th><th className="num">Net sales</th><th className="num">Txns</th><th className="num">Voids</th><th className="num">Refunds</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="name">{groupBy === 'day' ? fmtDay(r.label) : r.label}{r.live && <span className="badge-live">LIVE</span>}</td>
            <td className="num">{money(r.net)}</td>
            <td className="num">{fmt(r.txns)}</td>
            <td className="num">{r.voids}</td>
            <td className="num">{r.refunds}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
