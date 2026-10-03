/**
 * Translate framework-agnostic identity errors into the platform's HTTP error
 * taxonomy (13 §5). The use cases throw domain errors; this is the one place that
 * knows their HTTP shape, so the application layer stays transport-free.
 */

import { z } from 'zod'
import {
  UnauthenticatedError,
  ValidationError,
  type AppError,
  isAppError,
} from '@cp/core'
import { AuthError, RefreshError } from '../application/authentication.js'
import { InvalidTokenError, WeakPasswordError } from '../application/registration.js'

export function translateIdentityError(error: unknown): AppError {
  if (isAppError(error)) return error
  if (error instanceof AuthError) return new UnauthenticatedError('Invalid email or password.')
  if (error instanceof RefreshError) return new UnauthenticatedError(error.message)
  if (error instanceof WeakPasswordError) return new ValidationError(error.message)
  if (error instanceof InvalidTokenError) return new ValidationError(error.message)
  if (error instanceof z.ZodError) {
    return new ValidationError('The request could not be validated.', {
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  // Unknown — let the global handler log it and return a generic 500.
  throw error
}

/** Parse a body with Zod, throwing a ValidationError the global handler formats. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new ValidationError('The request could not be validated.', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}
