import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import KpiStrip from '../KpiStrip.jsx'
import { useStore } from '../../store/useStore.js'

describe('KpiStrip', () => {
  it('renders KPI values from the store', () => {
    useStore.setState({
      kpis: { net: 12345, rate: 678, tps: 9, totalTxns: 4321, netTrend: 8.2 },
      history: { net: [1, 2, 3], rate: [1, 2], tps: [1, 2] },
      flags: [],
    })
    render(<KpiStrip />)
    expect(screen.getByText('12,345')).toBeInTheDocument()  // net sales
    expect(screen.getByText('9')).toBeInTheDocument()        // tps
    expect(screen.getByText(/all venues healthy/i)).toBeInTheDocument()
  })

  it('summarises active anomalies', () => {
    useStore.setState({
      kpis: { net: 0, rate: 0, tps: 0, totalTxns: 0, netTrend: 0 },
      history: { net: [], rate: [], tps: [] },
      flags: [{ id: 'a', type: 'drop' }, { id: 'b', type: 'spike' }],
    })
    render(<KpiStrip />)
    expect(screen.getByText(/1 drop · 1 spike · 0 hot/)).toBeInTheDocument()
  })
})
