import { useEffect, useRef, useState } from 'react'
import Logo from './Logo.jsx'
import { useStore } from '../store/useStore.js'
import { pad } from '../utils.js'

export default function Header() {
  const [clock, setClock] = useState('--:--:--')
  const tick = useStore((s) => s.tick)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const backendMode = useStore((s) => s.backendMode)
  const fillRef = useRef(null)

  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date()
      setClock(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // restart the tick-meter fill animation on every batched snapshot
  useEffect(() => {
    const el = fillRef.current
    if (!el) return
    el.classList.remove('run')
    void el.offsetWidth
    el.classList.add('run')
  }, [tick])

  return (
    <header>
      <Logo />
      <div className="header-divider" />
      <div className="title-block">
        <h1>Real-Time Venue Operations</h1>
        <p>Live group-wide trade · 40 venues · no refresh</p>
      </div>
      <div className="header-spacer" />
      <div className="seg view-toggle">
        <button className={view === 'live' ? 'on' : ''} onClick={() => setView('live')}>● Live</button>
        <button className={view === 'history' ? 'on' : ''} onClick={() => setView('history')}>History</button>
      </div>
      {view === 'live' && (
        <div className="tick-meter" title="1s batching tick — coalesces all dirty venues into one snapshot">
          <span>TICK</span>
          <div className="tick-bar"><i ref={fillRef} /></div>
        </div>
      )}
      <div className="clock"><b>{clock}</b></div>
      {view === 'live'
        ? <div className="status-pill"><span className="dot" /> LIVE · {backendMode ? 'WebSocket' : 'Simulator'}</div>
        : <div className="status-pill hist">HISTORY · REST</div>}
    </header>
  )
}
