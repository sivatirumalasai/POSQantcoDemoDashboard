import { useStore } from '../store/useStore.js'
import { fmt } from '../utils.js'
import Sparkline from './Sparkline.jsx'

export default function KpiStrip() {
  const kpis = useStore((s) => s.kpis)
  const history = useStore((s) => s.history)
  const flags = useStore((s) => s.flags)

  const drops = flags.filter((f) => f.type === 'drop').length
  const spikes = flags.filter((f) => f.type === 'spike').length
  const hots = flags.filter((f) => f.type === 'hot').length

  return (
    <section className="kpis">
      <div className="kpi" style={{ '--accent': 'var(--brand)' }}>
        <div className="label">Net Sales · Today</div>
        <div className="val"><span className="cur">$</span>{fmt(kpis.net)}</div>
        <div className="sub"><span className="up">▲ {kpis.netTrend}%</span> vs same time yesterday</div>
        <Sparkline data={history.net.slice(-24)} color="#ff5c00" />
      </div>

      <div className="kpi" style={{ '--accent': 'var(--green)' }}>
        <div className="label">Net Sales / min</div>
        <div className="val"><span className="cur">$</span>{fmt(kpis.rate)}</div>
        <div className="sub">rolling 60-second run-rate</div>
        <Sparkline data={history.rate.slice(-24)} color="#2fd07a" />
      </div>

      <div className="kpi" style={{ '--accent': 'var(--blue)' }}>
        <div className="label">Transactions / sec</div>
        <div className="val">{kpis.tps}</div>
        <div className="sub"><b>{fmt(kpis.totalTxns)}</b> processed today</div>
        <Sparkline data={history.tps.slice(-24)} color="#4b9bff" />
      </div>

      <div className="kpi" style={{ '--accent': 'var(--red)' }}>
        <div className="label">Active Anomalies</div>
        <div className="val" style={{ color: flags.length ? 'var(--red)' : 'var(--green)' }}>{flags.length}</div>
        <div className="sub">{flags.length ? `${drops} drop · ${spikes} spike · ${hots} hot` : 'all venues healthy'}</div>
      </div>
    </section>
  )
}
