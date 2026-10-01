/**
 * Cursor pagination (docs/architecture/13-api-specification.md §3.1).
 *
 * Cursors, not offsets: offset pagination over a mutating table skips and
 * duplicates rows as items are inserted, and the admin console lists exactly the
 * tables that mutate most. The cursor is opaque to clients and must never be
 * constructed by them.
 */

export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 200

export interface PageRequest {
  readonly limit: number
  readonly cursor?: string
}

export interface PageInfo {
  readonly hasNextPage: boolean
  readonly endCursor: string | null
  readonly limit: number
}

export interface Page<T> {
  readonly data: readonly T[]
  readonly pageInfo: PageInfo
}

export function clampLimit(requested?: number): number {
  if (requested === undefined || Number.isNaN(requested)) return DEFAULT_PAGE_LIMIT
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_LIMIT)
}

/** Sort key plus id, so ties resolve deterministically and paging is stable. */
export interface CursorPayload {
  readonly k: string
  readonly id: string
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CursorPayload).k === 'string' &&
      typeof (parsed as CursorPayload).id === 'string'
    ) {
      return parsed as CursorPayload
    }
    return null
  } catch {
    return null
  }
}
