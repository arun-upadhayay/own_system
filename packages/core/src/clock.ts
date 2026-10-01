/**
 * Clock port (HLD §3.1). Time is injected, never read via `Date.now()` in domain
 * code, because subscription expiry, trial ends, token lifetimes and lockout
 * windows are all time-dependent. Testing "what happens the instant a trial
 * expires" against the real clock means waiting or sleeping; with an injectable
 * clock it is an assertion.
 */

export interface Clock {
  now(): Date
  /** Epoch milliseconds — cheaper where a Date is not needed. */
  nowMs(): number
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
}

/** Test double. `advance` makes time-dependent behaviour directly assertable. */
export class FixedClock implements Clock {
  #ms: number
  constructor(start: Date | number = 0) {
    this.#ms = typeof start === 'number' ? start : start.getTime()
  }
  now(): Date {
    return new Date(this.#ms)
  }
  nowMs(): number {
    return this.#ms
  }
  advance(ms: number): void {
    this.#ms += ms
  }
  set(to: Date | number): void {
    this.#ms = typeof to === 'number' ? to : to.getTime()
  }
}
