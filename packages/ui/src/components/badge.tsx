import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn.js'

/**
 * Badge — docs/design/04-color-system.md §4.3, 10-accessibility.md §3.
 *
 * THREE CHANNELS, always: colour, shape (the dot or an icon), and text. A screen
 * reader user gets the label; a colourblind user gets the icon and label;
 * everyone gets the colour. Colour alone is never sufficient (WCAG 1.4.1).
 *
 * This is also why the `-text` tokens exist: `warning` measures 1.83:1 and
 * `serious` 2.64:1 against white, so the swatch hue cannot carry text. The badge
 * uses the tinted background with the darkened text variant on it.
 *
 * NOTE: this component is deliberately generic over *status tone*. Mapping a
 * product's access state to a tone belongs in a Tier 4 domain component that
 * receives the state from the backend — never computed here, and never branching
 * on a product (ADR-013).
 */

const badgeVariants = cva(
  [
    'inline-flex items-center gap-[var(--space-1-5,0.375rem)]',
    'rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[1px]',
    'text-[var(--text-xs)] leading-[var(--leading-xs)] font-medium whitespace-nowrap',
  ],
  {
    variants: {
      tone: {
        neutral:
          'border-[var(--border-default)] bg-[var(--surface-sunken)] text-[var(--text-secondary)]',
        good: 'border-[var(--status-good-border)] bg-[var(--status-good-bg)] text-[var(--status-good-text)]',
        warning:
          'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]',
        serious:
          'border-[var(--status-serious-border)] bg-[var(--status-serious-bg)] text-[var(--status-serious-text)]',
        critical:
          'border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] text-[var(--status-critical-text)]',
        info: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-text)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

const dotColor: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'var(--text-muted)',
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  serious: 'var(--status-serious)',
  critical: 'var(--status-critical)',
  info: 'var(--status-info)',
}

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Shows the colour dot. Suppress only when an explicit icon is passed instead. */
  showDot?: boolean
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone = 'neutral', showDot = true, children, ...props },
  ref,
) {
  return (
    <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...props}>
      {showDot && (
        <span
          aria-hidden="true"
          className="size-[6px] shrink-0 rounded-[var(--radius-full)]"
          style={{ backgroundColor: dotColor[tone ?? 'neutral'] }}
        />
      )}
      {children}
    </span>
  )
})

export { badgeVariants }
