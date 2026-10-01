import * as React from 'react'
import { cn } from '../lib/cn.js'

/**
 * Skeleton — docs/design/05-component-system.md §3.7.
 *
 * Preferred over a spinner because it PREVENTS LAYOUT SHIFT: a spinner where a
 * table will be causes a visible jump when data arrives; a skeleton of the same
 * shape does not. Always match the final layout.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn(
          'animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-sunken)]',
          className,
        )}
        {...props}
      />
    )
  },
)
