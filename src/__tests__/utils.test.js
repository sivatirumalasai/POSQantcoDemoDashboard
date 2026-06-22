import { describe, it, expect } from 'vitest'
import { fmt, money, pad } from '../utils.js'

describe('utils', () => {
  it('fmt rounds and adds thousands separators', () => {
    expect(fmt(1234.6)).toBe('1,235')
    expect(fmt(0)).toBe('0')
  })
  it('money prefixes $ and rounds', () => {
    expect(money(1234.4)).toBe('$1,234')
    expect(money(1000000)).toBe('$1,000,000')
  })
  it('pad zero-pads to two digits', () => {
    expect(pad(5)).toBe('05')
    expect(pad(12)).toBe('12')
  })
})
