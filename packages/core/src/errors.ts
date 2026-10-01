/**
 * Error taxonomy. Each class maps to exactly one HTTP status and one error code
 * from docs/architecture/13-api-specification.md §5, so the mapping lives here
 * rather than being re-decided per route.
 *
 * Two distinctions in this file are security decisions, not style:
 *
 *  - `NotFoundError` is thrown for a resource in ANOTHER TENANT. Returning 403
 *    would confirm the resource exists, which leaks cross-tenant existence
 *    through the status code (07-rbac-and-authorization.md §9). Because
 *    repositories are organization-scoped, the row genuinely is not found.
 *
 *  - `LimitReachedError` is 409, not 403. The user is permitted; the plan is the
 *    constraint. Conflating them sends users to their administrator when they
 *    should be sent to the upgrade page (09-plans-and-subscriptions.md §7).
 */

export type ErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'organization_suspended'
  | 'product_not_entitled'
  | 'product_seat_required'
  | 'not_found'
  | 'conflict'
  | 'limit_reached'
  | 'invalid_transition'
  | 'rate_limited'
  | 'internal_error'

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode
  abstract readonly status: number
  /** Structured data for the client. Must never contain S2/S3 fields. */
  readonly details?: Readonly<Record<string, unknown>>

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message)
    this.name = new.target.name
    if (details !== undefined) this.details = details
    Error.captureStackTrace?.(this, new.target)
  }
}

export class ValidationError extends AppError {
  readonly code = 'validation_failed' as const
  readonly status = 400
}

export class UnauthenticatedError extends AppError {
  readonly code = 'unauthenticated' as const
  readonly status = 401
  constructor(message = 'Authentication required.') {
    super(message)
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'forbidden' as const
  readonly status = 403
  constructor(message = 'You do not have permission to perform this action.') {
    super(message)
  }
}

export class OrganizationSuspendedError extends AppError {
  readonly code = 'organization_suspended' as const
  readonly status = 403
}

export class ProductNotEntitledError extends AppError {
  readonly code = 'product_not_entitled' as const
  readonly status = 403
}

export class ProductSeatRequiredError extends AppError {
  readonly code = 'product_seat_required' as const
  readonly status = 403
}

/** Also used for another tenant's resource — see the note at the top of this file. */
export class NotFoundError extends AppError {
  readonly code = 'not_found' as const
  readonly status = 404
  constructor(message = 'Not found.') {
    super(message)
  }
}

export class ConflictError extends AppError {
  readonly code = 'conflict' as const
  readonly status = 409
}

export class LimitReachedError extends AppError {
  readonly code = 'limit_reached' as const
  readonly status = 409
}

export class InvalidTransitionError extends AppError {
  readonly code = 'invalid_transition' as const
  readonly status = 422
}

export class RateLimitedError extends AppError {
  readonly code = 'rate_limited' as const
  readonly status = 429
}

export class InternalError extends AppError {
  readonly code = 'internal_error' as const
  readonly status = 500
  constructor(message = 'An unexpected error occurred.') {
    super(message)
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError

/** 4xx is a decision, not a transient failure, so it is never retried. */
export const isClientError = (e: unknown): boolean =>
  isAppError(e) && e.status >= 400 && e.status < 500
