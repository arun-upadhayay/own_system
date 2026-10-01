/**
 * Matcher type augmentation for Vitest 3.
 *
 * `@testing-library/jest-dom` and `vitest-axe` both augment the legacy global `Vi`
 * namespace, which Vitest 3 no longer reads — so their matchers work at runtime
 * but are invisible to tsc. Vitest 3's documented extension point is the
 * `Matchers` interface, which `Assertion<T>` extends.
 *
 * This matters because accessibility assertions are CI gates
 * (docs/design/10-accessibility.md §9.1): they must typecheck rather than be
 * reached through an `any` escape.
 */

import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import type { AxeMatchers } from 'vitest-axe/matchers'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends TestingLibraryMatchers<T, void>, AxeMatchers {}
}
