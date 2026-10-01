/**
 * Branded identifiers and UUID v7 generation.
 *
 * Ids are generated in the application, not the database: native `uuidv7()`
 * arrived in PostgreSQL 18 and the platform targets 16+, so columns carry no
 * `DEFAULT gen_random_uuid()` — a v4 default would silently undermine the
 * time-ordering v7 was chosen for, and the mix would be invisible
 * (docs/architecture/04-erd.md §1.0).
 *
 * Branding means an OrganizationId cannot be passed where a UserId is expected,
 * which matters most for `OrgScope` in ADR-012: tenant scoping becomes a
 * compile-time check rather than a convention.
 */

import { randomUUID, randomFillSync } from 'node:crypto'

declare const brand: unique symbol

export type Branded<T, B extends string> = T & { readonly [brand]: B }

export type UserId = Branded<string, 'UserId'>
export type OrganizationId = Branded<string, 'OrganizationId'>
export type BranchId = Branded<string, 'BranchId'>
export type MembershipId = Branded<string, 'MembershipId'>
export type ProductId = Branded<string, 'ProductId'>
export type FeatureId = Branded<string, 'FeatureId'>
export type PlanId = Branded<string, 'PlanId'>
export type SubscriptionId = Branded<string, 'SubscriptionId'>
export type RoleId = Branded<string, 'RoleId'>
export type PermissionId = Branded<string, 'PermissionId'>
export type SessionId = Branded<string, 'SessionId'>
export type AuditLogId = Branded<string, 'AuditLogId'>
export type CorrelationId = Branded<string, 'CorrelationId'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isUuid = (v: string): boolean => UUID_RE.test(v)

/**
 * UUID v7: 48-bit big-endian Unix timestamp in ms, then 74 random bits, with
 * version and variant set per RFC 9562. Time-ordered, so index locality is good
 * and ids sort by creation — unlike v4.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  randomFillSync(bytes)

  // 48-bit timestamp, bytes 0..5.
  bytes[0] = (now / 2 ** 40) & 0xff
  bytes[1] = (now / 2 ** 32) & 0xff
  bytes[2] = (now / 2 ** 24) & 0xff
  bytes[3] = (now / 2 ** 16) & 0xff
  bytes[4] = (now / 2 ** 8) & 0xff
  bytes[5] = now & 0xff

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70 // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Correlation ids are not persisted as entity keys, so v4 is fine. */
export const newCorrelationId = (): CorrelationId => randomUUID() as CorrelationId

const makeFactory =
  <T extends string>() =>
  (value: string): Branded<string, T> => {
    if (!isUuid(value)) throw new TypeError(`Invalid UUID: ${value}`)
    return value as Branded<string, T>
  }

export const UserId = { of: makeFactory<'UserId'>(), new: () => uuidv7() as UserId }
export const OrganizationId = {
  of: makeFactory<'OrganizationId'>(),
  new: () => uuidv7() as OrganizationId,
}
export const BranchId = { of: makeFactory<'BranchId'>(), new: () => uuidv7() as BranchId }
export const MembershipId = {
  of: makeFactory<'MembershipId'>(),
  new: () => uuidv7() as MembershipId,
}
export const ProductId = { of: makeFactory<'ProductId'>(), new: () => uuidv7() as ProductId }
export const SubscriptionId = {
  of: makeFactory<'SubscriptionId'>(),
  new: () => uuidv7() as SubscriptionId,
}
