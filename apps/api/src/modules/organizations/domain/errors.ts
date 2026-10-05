/**
 * Organization-module domain errors. Framework-agnostic; the HTTP layer maps them
 * to the platform's error taxonomy (13 §5).
 */

export class LastOwnerError extends Error {
  constructor() {
    super('An organization must keep at least one active owner. Transfer ownership first.')
    this.name = 'LastOwnerError'
  }
}

export class IllegalTransitionError extends Error {
  constructor(what: string, from: string, to: string) {
    super(`Illegal ${what} transition: ${from} → ${to}.`)
    this.name = 'IllegalTransitionError'
  }
}

export class OrgRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrgRuleError'
  }
}
