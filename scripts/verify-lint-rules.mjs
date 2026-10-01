#!/usr/bin/env node
/**
 * Proves the architecture lint rules actually fail a build.
 *
 * Phase 1 requires a test that "a lint rule violation fails the build"
 * (docs/architecture/19-implementation-plan.md). A rule that is configured but
 * silently not firing is worse than no rule, because it creates false confidence.
 * So each guard is run against a fixture that deliberately violates it, and this
 * script fails if the rule stays quiet.
 *
 * Uses ESLint's Node API rather than the CLI: the fixture config must override the
 * repository config (which exempts fixtures, so the real codebase stays clean),
 * and the API makes that explicit.
 */

import { ESLint } from 'eslint'
import cpRules from '../eslint-rules/no-hardcoded-products.js'
import tseslint from 'typescript-eslint'

const fixtureConfig = [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    plugins: { cp: cpRules },
    rules: {
      'cp/no-hardcoded-products': 'error',
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@cp/*/src/*'], message: 'Deep import (HLD §4.1).' }] },
      ],
    },
  },
]

const cases = [
  {
    name: 'ADR-013 — no hardcoded products',
    fixture: 'scripts/__lint-fixtures__/hardcoded-product.ts',
    rule: 'cp/no-hardcoded-products',
    // The fixture contains a comparison, a switch case, an object map, an array
    // and an .includes() — five distinct violation shapes the rule must catch.
    minimumErrors: 5,
  },
  {
    name: 'HLD §4.1 — module boundaries (no deep imports)',
    fixture: 'scripts/__lint-fixtures__/boundary-violation.ts',
    rule: 'no-restricted-imports',
    minimumErrors: 1,
  },
]

const eslint = new ESLint({
  overrideConfigFile: true, // ignore eslint.config.js entirely
  overrideConfig: fixtureConfig,
  ignore: false,
})

let failed = 0

for (const c of cases) {
  const results = await eslint.lintFiles([c.fixture])
  const messages = results.flatMap((r) => r.messages)
  const hits = messages.filter((m) => m.ruleId === c.rule)

  if (hits.length >= c.minimumErrors) {
    console.log(`PASS  ${c.name}`)
    console.log(`      ${hits.length} violation(s) reported by ${c.rule}`)
  } else {
    failed++
    console.error(`FAIL  ${c.name}`)
    console.error(`      expected >=${c.minimumErrors} ${c.rule} error(s), got ${hits.length}`)
    for (const m of messages) console.error(`      [${m.ruleId ?? 'parse'}] ${m.message}`)
  }
}

// The inverse check matters just as much: the real codebase must be clean under
// the same rules. If the production config exempted something broadly, the guard
// would pass here and still not protect anything.
const prod = new ESLint({})
const appResults = await prod.lintFiles(['apps', 'packages'])
const appViolations = appResults
  .flatMap((r) => r.messages.map((m) => ({ file: r.filePath, ...m })))
  .filter((m) => m.ruleId === 'cp/no-hardcoded-products')

if (appViolations.length > 0) {
  failed++
  console.error('\nFAIL  Application code contains hardcoded product references:')
  for (const v of appViolations) console.error(`      ${v.file}:${v.line} ${v.message}`)
} else {
  console.log('PASS  No hardcoded product references in apps/ or packages/')
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed. The architecture guards are not effective.\n`)
  process.exit(1)
}

console.log('\nAll architecture lint guards verified.\n')
