import { memo, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { fmt, money } from '../utils.js'

const FLAG_CLASS = { hot: 'b-hot', drop: 'b-drop', spike: 'b-spike' }

/**
 * One row subscribes to exactly ONE venue slice (state.venues[id]).
 * Wrapped in memo() so a tick that only moved other venues never re-renders it
 * — the README's "one venue's update re-renders one row, not all 40."
 */
const VenueRow = memo(function VenueRow({ id, rank, maxNet, selected, flashAt }) {
  const v = useStore((s) => s.venues[id])
  const select = useStore((s) => s.selectVenue)
  const ref = useRef(null)

  // retrigger the flash animation when this row is the tick's biggest mover
  useEffect(() => {
    if (!flashAt || !ref.current) return
    const el = ref.current
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
  }, [flashAt])

  if (!v) return null
  const badge = v.flag ? <span className={`badge-sm ${FLAG_CLASS[v.flag]}`}>{v.flag}</span> : null

  return (
    <div
      ref={ref}
      className={`row${selected ? ' sel' : ''}`}
      style={{ order: rank }}
      onClick={() => select(id)}
    >
      <div className={`rank-no${rank < 3 ? ' top' : ''}`}>{rank + 1}</div>
      <div>
        <div className="venue-name">{v.name} {badge}</div>
        <div className="venue-meta">{fmt(v.txns)} txns · {v.voids}v · {v.refunds}r</div>
      </div>
      <div className="venue-val">
        <div className="amt">{money(v.net)}</div>
        <div className="bar"><i style={{ width: `${((v.net / maxNet) * 100).toFixed(1)}%` }} /></div>
      </div>
    </div>
  )
})

export default function VenueRankingBoard() {
  const order = useStore((s) => s.order)
  const flashId = useStore((s) => s.flashId)
  const tick = useStore((s) => s.tick)
  const selectedVenueId = useStore((s) => s.selectedVenueId)
  const topNet = useStore((s) => (s.order.length ? s.venues[s.order[0]]?.net : 1)) || 1

  return (
    <div className="panel">
      <div className="head">
        <h2>Venue Ranking</h2>
        <span className="count">{order.length} venues</span>
        <div className="spacer" />
        <span className="count">ranking:today · live</span>
      </div>
      <div className="body rank">
        {order.map((id, idx) => (
          <VenueRow
            key={id}
            id={id}
            rank={idx}
            maxNet={topNet}
            selected={id === selectedVenueId}
            flashAt={flashId === id ? tick : 0}
          />
        ))}
      </div>
    </div>
  )
}
