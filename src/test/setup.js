import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom doesn't implement these — stub so components/clients don't throw.
if (!('matchMedia' in window)) {
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
