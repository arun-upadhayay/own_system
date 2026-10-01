import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn.js'

/**
 * Button — docs/design/05-component-system.md §3.1.
 *
 * Styled only against TIER 2 semantic tokens, never Tier 1 primitives, so it
 * works in both themes without change (02 §1).
 *
 * `loading` is a REQUIRED capability, not a nicety: every mutation can fail on
 * the server for permission, entitlement or limit reasons (C8), so every mutating
 * button needs an in-flight state. The width is held steady — a button that
 * shrinks to fit a spinner shifts the layout around it.
 */

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-[var(--space-2)]',
    'rounded-[var(--radius-md)] font-medium whitespace-nowrap',
    'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
    'disabled:pointer-events-none disabled:opacity-[var(--opacity-disabled)]',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--action-primary)] text-[var(--text-on-primary)] hover:bg-[var(--action-primary-hover)] active:bg-[var(--action-primary-active)]',
        secondary:
          'border border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
        ghost: 'text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
        danger:
          'bg-[var(--action-danger)] text-[var(--text-on-primary)] hover:bg-[var(--action-danger-hover)]',
        link: 'text-[var(--text-link)] underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-[var(--control-height-sm)] px-[var(--space-3)] text-[var(--text-sm)] [&_svg]:size-[var(--icon-xs)]',
        md: 'h-[var(--control-height-md)] px-[var(--space-4)] text-[var(--text-body)] [&_svg]:size-[var(--icon-sm)]',
        lg: 'h-[var(--control-height-lg)] px-[var(--space-6)] text-[var(--text-body-lg)] [&_svg]:size-[var(--icon-sm)]',
        icon: 'size-[var(--control-height-md)] [&_svg]:size-[var(--icon-sm)]',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as a child element (e.g. a link) while keeping button styling. */
  asChild?: boolean
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading</span>
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
})

export { buttonVariants }
