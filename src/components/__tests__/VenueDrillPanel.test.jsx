import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VenueDrillPanel from '../VenueDrillPanel.jsx'
import { useStore } from '../../store/useStore.js'

describe('VenueDrillPanel', () => {
  it('renders the selected venue stats', () => {
    useStore.setState({
      selectedVenueId: 1, order: [1],
      venues: { 1: { id: 1, name: 'Alpha', net: 1234, txns: 88, voids: 3, refunds: 4, hourly: Array(18).fill(100), items: { Beer: 9 } } },
    })
    render(<VenueDrillPanel />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('$1,234')).toBeInTheDocument()
    expect(screen.getByText('Beer')).toBeInTheDocument()
  })

  it('closes the drill panel', () => {
    useStore.setState({
      selectedVenueId: 1, order: [1],
      venues: { 1: { id: 1, name: 'Alpha', net: 10, txns: 1, voids: 0, refunds: 0, hourly: Array(18).fill(1), items: {} } },
    })
    render(<VenueDrillPanel />)
    fireEvent.click(screen.getByText('✕'))
    expect(useStore.getState().selectedVenueId).toBeNull()
  })
})
