import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { fmt, money, pad } from '../utils.js'

export default function VenueDrillPanel() {
  const id = useStore((s) => s.selectedVenueId)
  const venue = useStore((s) => (s.selectedVenueId ? s.venues[s.selectedVenueId] : null))
  const order = useStore((s) => s.order)
  const close = useStore((s) => s.closeDrill)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const open = !!id
  const rank = venue ? order.indexOf(venue.id) + 1 : 0
  const hourly = venue?.hourly ?? []
  const maxH = hourly.length ? Math.max(...hourly) : 1
  const items = venue ? Object.entries(venue.items).sort((a, b) => b[1] - a[1]).slice(0, 6) : []
  const maxI = items[0] ? items[0][1] : 1
  const startH = 6

  return (
    <>
      <div className={`scrim${open ? ' show' : ''}`} onClick={close} />
      <aside className={`drill${open ? ' open' : ''}`}>
        <div className="dhead">
          <div>
            <h3>{venue?.name ?? '—'}</h3>
            <p>{venue ? `Rank #${rank} of 40 · venue ${pad(venue.id)}` : '—'}</p>
          </div>
          <button className="close" onClick={close}>✕</button>
        </div>
        <div className="dbody">
          <div className="dstat-grid">
            <div className="dstat"><div className="l">Net Sales</div><div className="v">{venue ? money(venue.net) : '$0'}</div></div>
            <div className="dstat"><div className="l">Transactions</div><div className="v">{venue ? fmt(venue.txns) : '0'}</div></div>
            <div className="dstat"><div className="l">Voids</div><div className="v" style={{ color: 'var(--amber)' }}>{venue?.voids ?? 0}</div></div>
            <div className="dstat"><div className="l">Refunds</div><div className="v" style={{ color: 'var(--red)' }}>{venue?.refunds ?? 0}</div></div>
          </div>

          <div className="sec-title">Hourly trade · today</div>
          <div className="chart">
            {hourly.map((h, i) => (
              <div
                key={i}
                className={`col${i === hourly.length - 1 ? ' now' : ''}`}
                style={{ height: `${((h / maxH) * 100).toFixed(0)}%` }}
                title={money(h)}
              />
            ))}
          </div>
          <div className="chart-x">
            {hourly.map((_, i) => <span key={i}>{i % 3 === 0 ? pad((startH + i) % 24) : ''}</span>)}
          </div>

          <div className="sec-title">Top items · this venue</div>
          <div>
            {items.map(([name, qty], i) => (
              <div className="item-row" key={name} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div className="item-rank">{i + 1}</div>
                <div className="item-main">
                  <div className="item-name">{name}</div>
                  <div className="item-bar"><i style={{ width: `${((qty / maxI) * 100).toFixed(0)}%` }} /></div>
                </div>
                <div className="item-qty">{qty}<small>sold</small></div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  )
}
