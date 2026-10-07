import { z } from 'zod'
import { ValidationError, isAppError, type AppError } from '@cp/core'

export function translateRbacError(error: unknown): AppError {
  if (isAppError(error)) return error
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
