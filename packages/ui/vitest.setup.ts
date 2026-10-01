import '@testing-library/jest-dom/vitest'
import { expect } from 'vitest'
import * as axeMatchers from 'vitest-axe/matchers'

// Accessibility assertions are first-class: a11y failures block the merge
// (docs/design/10-accessibility.md §9.1), like the tenant-isolation tests.
expect.extend(axeMatchers)
