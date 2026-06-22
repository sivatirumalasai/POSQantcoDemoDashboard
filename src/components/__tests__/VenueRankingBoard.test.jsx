import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VenueRankingBoard from '../VenueRankingBoard.jsx'
import { useStore } from '../../store/useStore.js'

function seed() {
  useStore.setState({
    venues: {
      1: { id: 1, name: 'Alpha', net: 500, txns: 50, voids: 1, refunds: 2, flag: null, hourly: [], items: {} },
      2: { id: 2, name: 'Beta', net: 200, txns: 20, voids: 0, refunds: 0, flag: 'hot', hourly: [], items: {} },
    },
    order: [1, 2], selectedVenueId: null, flashId: null, tick: 1,
  })
}

describe('VenueRankingBoard', () => {
  it('renders ranked venue rows', () => {
    seed()
    render(<VenueRankingBoard />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('2 venues')).toBeInTheDocument()
  })

  it('selects a venue on click', () => {
    seed()
    render(<VenueRankingBoard />)
    fireEvent.click(screen.getByText('Alpha').closest('.row'))
    expect(useStore.getState().selectedVenueId).toBe(1)
  })
})
