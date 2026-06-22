import { useStore } from '../store/useStore.js'

const TITLE = { drop: 'Sales Drop', spike: 'Void / Refund Spike', hot: 'Running Hot' }

export default function AnomalyRail() {
  const flags = useStore((s) => s.flags)

  return (
    <div className="panel anom">
      <div className="head">
        <h2>Anomaly Rail</h2>
        <span className="count">{flags.length ? `${flags.length} active` : 'flags:active'}</span>
      </div>
      <div className="body">
        {flags.length === 0 ? (
          <div className="empty">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
            </svg>
            <div>All 40 venues trading normally.<br />No active flags.</div>
          </div>
        ) : (
          flags.map((f) => (
            <div className={`flag ${f.type}`} key={f.id}>
              <div className="ftop">
                <span className="ftype">{TITLE[f.type]}</span>
                <span className="ftime">{f.time}</span>
              </div>
              <div className="fvenue">{f.venue}</div>
              <div className="fwhy">{f.why}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
