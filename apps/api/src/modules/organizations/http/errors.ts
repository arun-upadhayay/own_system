/**
 * Translate organization-module domain errors to the platform HTTP taxonomy
 * (13 §5). The use cases throw domain errors; this is the one place that knows
 * their HTTP shape.
 */

import { z } from 'zod'
import {
  ConflictError,
  InvalidTransitionError,
  ValidationError,
  isAppError,
  type AppError,
} from '@cp/core'
import { IllegalTransitionError, LastOwnerError, OrgRuleError } from '../domain/errors.js'

export function translateOrgError(error: unknown): AppError {
  if (isAppError(error)) return error
  if (error instanceof LastOwnerError) return new ConflictError(error.message)
  if (error instanceof IllegalTransitionError) return new InvalidTransitionError(error.message)
  if (error instanceof OrgRuleError) return new ConflictError(error.message)
  if (error instanceof z.ZodError) {
    return new ValidationError('The request could not be validated.', {
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  throw error
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new ValidationError('The request could not be validated.', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}
