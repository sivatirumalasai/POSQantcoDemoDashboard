import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TopItemsPanel from '../TopItemsPanel.jsx'
import { useStore } from '../../store/useStore.js'

describe('TopItemsPanel', () => {
  it('renders group items by default', () => {
    useStore.setState({
      itemScope: 'group', selectedVenueId: null, order: [1],
      groupItems: { Beer: 10, Wine: 5 },
      venues: { 1: { id: 1, name: 'Alpha', items: { Pizza: 3 } } },
    })
    render(<TopItemsPanel />)
    expect(screen.getByText('Beer')).toBeInTheDocument()
    expect(screen.getByText('Wine')).toBeInTheDocument()
  })

  it('switches to the selected venue items', () => {
    useStore.setState({
      itemScope: 'group', selectedVenueId: null, order: [1],
      groupItems: { Beer: 10 },
      venues: { 1: { id: 1, name: 'Alpha', items: { Pizza: 3 } } },
    })
    render(<TopItemsPanel />)
    fireEvent.click(screen.getByText('Selected venue'))
    expect(useStore.getState().itemScope).toBe('venue')
    expect(screen.getByText('Pizza')).toBeInTheDocument()
  })
})
