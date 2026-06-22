import { useEffect, useState } from 'react'
import Header from './components/Header.jsx'
import KpiStrip from './components/KpiStrip.jsx'
import VenueRankingBoard from './components/VenueRankingBoard.jsx'
import TopItemsPanel from './components/TopItemsPanel.jsx'
import AnomalyRail from './components/AnomalyRail.jsx'
import VenueDrillPanel from './components/VenueDrillPanel.jsx'
import ReportsView from './components/ReportsView.jsx'
import { startLive } from './live/connect.js'
import { useStore } from './store/useStore.js'
import { pad } from './utils.js'

export default function App() {
  const [uptime, setUptime] = useState('00:00')
  const view = useStore((s) => s.view)

  // DashboardPage owns the single live connection (here, the simulator stands
  // in for the WebSocket). Swap startSimulator() for a WS client and the rest
  // of the tree is unchanged.
  useEffect(() => {
    const stop = startLive()
    const start = performance.now()
    const id = setInterval(() => {
      const el = Math.floor((performance.now() - start) / 1000)
      setUptime(`${pad(Math.floor(el / 60))}:${pad(el % 60)}`)
    }, 1000)
    return () => { stop(); clearInterval(id) }
  }, [])

  return (
    <div className="app">
      <Header />
      {view === 'live' ? (
        <>
          <KpiStrip />
          <main>
            <VenueRankingBoard />
            <TopItemsPanel />
            <AnomalyRail />
          </main>
        </>
      ) : (
        <ReportsView />
      )}
      <div className="footer-note">
        {view === 'live'
          ? <span>CQRS-lite · SQS ingest buffer · Redis read model · Django Channels fan-out</span>
          : <span>Reporting read path · pre-aggregated daily rollups · today unioned from the live read model</span>}
        <span className="spacer" />
        <span className="mono">end-to-end latency ≈ <b style={{ color: 'var(--green)' }}>1.1s</b> median</span>
        <span className="mono">|</span>
        <span className="mono">session {uptime}</span>
      </div>
      {view === 'live' && <VenueDrillPanel />}
    </div>
  )
}
