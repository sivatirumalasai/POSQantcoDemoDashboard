import { useStore } from '../store/useStore.js'
import { fmt } from '../utils.js'

export default function TopItemsPanel() {
  const scope = useStore((s) => s.itemScope)
  const setScope = useStore((s) => s.setItemScope)
  const selectVenue = useStore((s) => s.selectVenue)
  const selectedVenueId = useStore((s) => s.selectedVenueId)
  const groupItems = useStore((s) => s.groupItems)
  const order = useStore((s) => s.order)
  const venue = useStore((s) => (s.selectedVenueId ? s.venues[s.selectedVenueId] : null))

  let source = groupItems
  let label = null
  if (scope === 'venue' && venue) {
    source = venue.items
    label = venue.name
  }

  const top = Object.entries(source).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const max = top[0] ? top[0][1] : 1

  const onScope = (next) => {
    if (next === 'venue' && !selectedVenueId && order.length) selectVenue(order[0])
    setScope(next)
  }

  return (
    <div className="panel">
      <div className="head">
        <h2>Top Items</h2>
        <div className="spacer" />
        <div className="seg">
          <button className={scope === 'group' ? 'on' : ''} onClick={() => onScope('group')}>Group</button>
          <button className={scope === 'venue' ? 'on' : ''} onClick={() => onScope('venue')}>Selected venue</button>
        </div>
      </div>
      <div className="body">
        {label && <div className="scope-label">{label}</div>}
        {top.map(([name, qty], i) => (
          <div className="item-row" key={name}>
            <div className="item-rank">{i + 1}</div>
            <div className="item-main">
              <div className="item-name">{name}</div>
              <div className="item-bar"><i style={{ width: `${((qty / max) * 100).toFixed(0)}%` }} /></div>
            </div>
            <div className="item-qty">{fmt(qty)}<small>sold</small></div>
          </div>
        ))}
      </div>
    </div>
  )
}
