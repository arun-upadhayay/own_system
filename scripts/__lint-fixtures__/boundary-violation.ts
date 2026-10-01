// FIXTURE. Deliberately violates the module-boundary rule (HLD §4.1).
// @ts-expect-error - deep import into another package's internals
import { cn } from '@cp/ui/src/lib/cn'
export const x = cn
