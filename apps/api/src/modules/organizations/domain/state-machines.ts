/**
 * Status state machines (docs/architecture/10 §2, §4; 09 §4).
 *
 * A status is never set by direct assignment from input — the transition is
 * requested and the machine decides whether it is legal (data dictionary §10
 * rule 7). This prevents, for example, moving a membership straight from `removed`
 * back to `active` by asserting a state.
 *
 * Pure: no I/O, so it lives in the domain layer and is unit-testable.
 */

export type OrgStatus = 'pending' | 'active' | 'suspended' | 'cancelled'
export type MembershipStatus = 'active' | 'suspended' | 'removed'

const ORG_TRANSITIONS: Record<OrgStatus, readonly OrgStatus[]> = {
  pending: ['active', 'cancelled'],
  active: ['suspended', 'cancelled'],
  suspended: ['active', 'cancelled'],
  cancelled: ['active'], // win-back / reactivation
}

const MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  active: ['suspended', 'removed'],
  suspended: ['active', 'removed'],
  removed: [], // terminal
}

export function canTransitionOrg(from: OrgStatus, to: OrgStatus): boolean {
  return from === to || ORG_TRANSITIONS[from]?.includes(to) === true
}

export function canTransitionMembership(from: MembershipStatus, to: MembershipStatus): boolean {
  return from === to || MEMBERSHIP_TRANSITIONS[from]?.includes(to) === true
}
