import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReportsView from '../ReportsView.jsx'
import { useStore } from '../../store/useStore.js'

afterEach(() => vi.unstubAllGlobals())

const payload = {
  groupBy: 'day',
  rows: [{ key: '2026-01-01', label: '2026-01-01', net: 100, txns: 5, voids: 0, refunds: 0 }],
  summary: { totalNet: 100, totalTxns: 5, totalVoids: 0, totalRefunds: 0, dayCount: 1, avgPerDay: 100, bestDay: { label: '2026-01-01', net: 100 } },
}

describe('ReportsView', () => {
  it('renders controls and loads a report from the backend', async () => {
    useStore.setState({
      venues: { 1: { id: 1, name: 'Alpha', net: 0, txns: 0, voids: 0, refunds: 0 } },
      reports: { loading: false, params: null, groupBy: 'day', rows: [], summary: null },
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })))

    render(<ReportsView />)
    // controls render immediately
    expect(screen.getByText('Last 30 days')).toBeInTheDocument()
    expect(screen.getByText('By day')).toBeInTheDocument()
    // after the async "REST" call, the breakdown row appears
    expect(await screen.findByText('Daily breakdown')).toBeInTheDocument()
    // $100 shows in both the "Best day" KPI and the table row → allow multiple
    const hits = await screen.findAllByText('$100')
    expect(hits.length).toBeGreaterThan(0)
    expect(fetch).toHaveBeenCalled()
  })
})
