import { memo } from 'react'
import { money } from '../utils.js'

/**
 * Lightweight SVG area+line chart (no charting dependency).
 * data: [{ label, value, live? }]
 */
function AreaChart({ data, height = 230, color = '#ff5c00' }) {
  if (!data || data.length === 0) return <div className="rep-empty">No data for this range.</div>

  const W = 1000, H = height, padT = 14, padB = 4
  const max = Math.max(...data.map((d) => d.value), 1)
  const n = data.length
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v) => padT + (1 - v / max) * (H - padT - padB)

  const linePts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ')
  const areaPts = `0,${H} ${linePts} ${W},${H}`
  const last = data[data.length - 1]

  // ~7 evenly spaced x labels
  const step = Math.max(1, Math.ceil(n / 7))
  const gid = `g-${color.replace('#', '')}`

  return (
    <div className="area-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.42" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={W} y1={padT + g * (H - padT - padB)} y2={padT + g * (H - padT - padB)}
            stroke="#232a38" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <polygon points={areaPts} fill={`url(#${gid})`} />
        <polyline points={linePts} fill="none" stroke={color} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(n - 1)} cy={y(last.value)} r="3.5" fill={last.live ? '#2fd07a' : color}
          stroke="#0a0c10" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="area-x">
        {data.map((d, i) => (
          <span key={d.label + i}>{i % step === 0 || i === n - 1 ? d.label : ''}</span>
        ))}
      </div>
      <div className="area-max">peak {money(max)}</div>
    </div>
  )
}

export default memo(AreaChart)
