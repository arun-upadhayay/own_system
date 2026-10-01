/**
 * Result type for operations whose failure is an expected outcome rather than a
 * bug. Used where a caller must handle both branches — a limit being reached, a
 * state transition being illegal.
 *
 * Authorization failures deliberately do NOT use this: they throw, because a
 * boolean invites being ignored and an unchecked return value is a silently
 * unauthorized request (docs/architecture/07-rbac-and-authorization.md §4.2).
 */

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok

/** Unwrap, or throw. Only for call sites that have already checked, and tests. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value
  throw new Error(`Called unwrap on an error Result: ${String(r.error)}`)
}

export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r
}

export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error))
}
