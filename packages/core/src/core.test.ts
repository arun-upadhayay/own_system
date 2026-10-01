import { describe, expect, it } from 'vitest'
import { FixedClock } from './clock.js'
import { clampLimit, decodeCursor, encodeCursor, MAX_PAGE_LIMIT } from './pagination.js'
import { isUuid, uuidv7 } from './ids.js'
import { err, isErr, isOk, map, ok } from './result.js'
import { ForbiddenError, isClientError, LimitReachedError, NotFoundError } from './errors.js'

describe('uuidv7', () => {
  it('produces a valid v7 UUID', () => {
    const id = uuidv7()
    expect(isUuid(id)).toBe(true)
    expect(id[14]).toBe('7') // version nibble
  })

  it('is time-ordered — the property v7 was chosen for', () => {
    const early = uuidv7(1_000_000_000_000)
    const late = uuidv7(2_000_000_000_000)
    expect(early < late).toBe(true)
  })

  it('is unique across a tight loop', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => uuidv7()))
    expect(ids.size).toBe(2000)
  })
})

describe('FixedClock', () => {
  it('does not move unless advanced', () => {
    const clock = new FixedClock(new Date('2026-10-01T00:00:00Z'))
    expect(clock.now().toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(clock.now().toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('advances by exactly the requested amount', () => {
    const clock = new FixedClock(0)
    clock.advance(86_400_000)
    expect(clock.nowMs()).toBe(86_400_000)
  })
})

describe('pagination', () => {
  it('caps the limit so no endpoint returns an unbounded collection', () => {
    expect(clampLimit(10_000)).toBe(MAX_PAGE_LIMIT)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(undefined)).toBe(50)
  })

  it('round-trips a cursor', () => {
    const payload = { k: '2026-10-01T00:00:00.000Z', id: 'abc' }
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload)
  })

  it('rejects a malformed cursor rather than throwing', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull()
    expect(decodeCursor(Buffer.from('{"nope":1}').toString('base64url'))).toBeNull()
  })
})

describe('Result', () => {
  it('narrows ok and err', () => {
    expect(isOk(ok(1))).toBe(true)
    expect(isErr(err('bad'))).toBe(true)
  })

  it('maps only the ok branch', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual({ ok: true, value: 4 })
    expect(map(err('bad'), (n: number) => n * 2)).toEqual({ ok: false, error: 'bad' })
  })
})

describe('error taxonomy', () => {
  it('maps a cross-tenant resource to 404, never 403', () => {
    // 07-rbac-and-authorization.md §9: a 403 would confirm the resource exists.
    expect(new NotFoundError().status).toBe(404)
  })

  it('maps a reached limit to 409, not 403', () => {
    // The user is permitted; the plan is the constraint (09 §7).
    const e = new LimitReachedError('Seat limit reached.', { limit: 2, used: 2 })
    expect(e.status).toBe(409)
    expect(e.code).toBe('limit_reached')
    expect(e.details).toEqual({ limit: 2, used: 2 })
  })

  it('classifies 4xx as a client error so it is never retried', () => {
    expect(isClientError(new ForbiddenError())).toBe(true)
    expect(isClientError(new Error('boom'))).toBe(false)
  })
})
