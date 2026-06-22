import { memo } from 'react'

function Sparkline({ data, color, width = 70, height = 26 }) {
  if (!data || data.length < 2) return <svg className="spark" width={width} height={height} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const rng = max - min || 1
  const n = data.length
  const pts = data
    .map((d, i) => `${((i / (n - 1)) * width).toFixed(1)},${(height - 2 - ((d - min) / rng) * (height - 4)).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="spark" width={width} height={height}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default memo(Sparkline)
