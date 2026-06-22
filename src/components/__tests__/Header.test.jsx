import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Header from '../Header.jsx'
import { useStore } from '../../store/useStore.js'

describe('Header', () => {
  it('renders the title, logo and live status', () => {
    useStore.setState({ view: 'live', backendMode: true, tick: 1 })
    render(<Header />)
    expect(screen.getByText('Real-Time Venue Operations')).toBeInTheDocument()
    expect(screen.getByText(/LIVE ·/)).toBeInTheDocument()
  })

  it('toggles to the History view', () => {
    useStore.setState({ view: 'live', backendMode: false, tick: 1 })
    render(<Header />)
    fireEvent.click(screen.getByText('History'))
    expect(useStore.getState().view).toBe('history')
  })
})
