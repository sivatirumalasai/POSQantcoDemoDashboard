import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AnomalyRail from '../AnomalyRail.jsx'
import { useStore } from '../../store/useStore.js'

describe('AnomalyRail', () => {
  it('shows the healthy empty state when there are no flags', () => {
    useStore.setState({ flags: [] })
    render(<AnomalyRail />)
    expect(screen.getByText(/All 40 venues trading normally/i)).toBeInTheDocument()
  })

  it('renders a flag with its venue and human-readable type', () => {
    useStore.setState({
      flags: [{ id: '3-spike', venue: 'Perth Grill', type: 'spike', why: 'ratio too high', time: '12:00:00' }],
    })
    render(<AnomalyRail />)
    expect(screen.getByText('Perth Grill')).toBeInTheDocument()
    expect(screen.getByText('Void / Refund Spike')).toBeInTheDocument()
    expect(screen.getByText('ratio too high')).toBeInTheDocument()
  })
})
