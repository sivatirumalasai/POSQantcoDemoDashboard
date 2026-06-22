import { describe, it, expect, vi, afterEach } from 'vitest'
import { startSimulator } from '../sim/simulator.js'
import { useStore } from '../store/useStore.js'

afterEach(() => vi.useRealTimers())

describe('startSimulator', () => {
  it('primes the store with 40 venues and returns a stop fn', () => {
    vi.useFakeTimers()
    const stop = startSimulator()
    const s = useStore.getState()
    expect(s.order).toHaveLength(40)
    expect(Object.keys(s.venues)).toHaveLength(40)
    expect(typeof stop).toBe('function')
    stop()
  })
})
