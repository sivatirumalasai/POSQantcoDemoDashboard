import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AreaChart from '../AreaChart.jsx'

describe('AreaChart', () => {
  it('renders a polyline for the data series', () => {
    const data = [{ label: '1/1', value: 10 }, { label: '1/2', value: 20 }, { label: '1/3', value: 15 }]
    const { container } = render(<AreaChart data={data} />)
    expect(container.querySelector('polyline')).toBeTruthy()
    expect(container.querySelector('polygon')).toBeTruthy() // area fill
  })

  it('shows an empty state with no data', () => {
    render(<AreaChart data={[]} />)
    expect(screen.getByText(/No data for this range/i)).toBeInTheDocument()
  })
})
