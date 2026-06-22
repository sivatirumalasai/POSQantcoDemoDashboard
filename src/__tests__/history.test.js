import { describe, it, expect } from 'vitest'
import {
  queryReports, presetRange, addDays, enumerateDays, isoDate, parseISO,
} from '../sim/history.js'

const venues = [{ id: 1, name: 'Sydney Taphouse' }, { id: 2, name: 'Perth Grill' }]

describe('date helpers', () => {
  it('addDays / enumerateDays', () => {
    expect(addDays('2026-01-01', 5)).toBe('2026-01-06')
    expect(enumerateDays('2026-01-01', '2026-01-07')).toHaveLength(7)
  })
  it('isoDate / parseISO round-trip', () => {
    expect(isoDate(parseISO('2026-05-12'))).toBe('2026-05-12')
  })
  it('presetRange 7d spans 7 inclusive days', () => {
    const { from, to } = presetRange('7d', '2026-06-21')
    expect(enumerateDays(from, to)).toHaveLength(7)
    expect(to).toBe('2026-06-21')
  })
})

describe('queryReports', () => {
  const params = { from: '2026-01-01', to: '2026-01-05', venueId: null, groupBy: 'day' }

  it('group_by day returns one row per day with a summary', () => {
    const r = queryReports(venues, params)
    expect(r.groupBy).toBe('day')
    expect(r.rows).toHaveLength(5)
    expect(r.summary.totalNet).toBeGreaterThan(0)
    expect(r.summary.dayCount).toBe(5)
    expect(r.summary.bestDay).toBeTruthy()
  })

  it('is deterministic (same query → same numbers)', () => {
    const a = queryReports(venues, params)
    const b = queryReports(venues, params)
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows))
  })

  it('group_by venue ranks venues by net desc', () => {
    const r = queryReports(venues, { ...params, groupBy: 'venue' })
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].net).toBeGreaterThanOrEqual(r.rows[1].net)
  })

  it('group_by item returns item rows with net + qty', () => {
    const r = queryReports(venues, { ...params, groupBy: 'item' })
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows[0]).toHaveProperty('net')
    expect(r.rows[0]).toHaveProperty('qty')
  })

  it('unions today from the live read model', () => {
    const today = '2026-01-05'
    const live = { perVenue: { 1: { net: 9999, txns: 1, voids: 0, refunds: 0 } } }
    const r = queryReports([{ id: 1, name: 'Sydney Taphouse' }],
      { from: '2026-01-01', to: today, venueId: null, groupBy: 'day', todayISO: today, live })
    const todayRow = r.rows.find((x) => x.label === today)
    expect(todayRow.live).toBe(true)
    expect(todayRow.net).toBe(9999)
  })
})
