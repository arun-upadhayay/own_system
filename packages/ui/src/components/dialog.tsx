'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../lib/cn.js'

/**
 * Dialog — Radix (ADR-020).
 *
 * Radix handles the genuinely hard parts: focus trapping, scroll locking,
 * dismissal layering, and returning focus to the trigger. Those are the reasons
 * ADR-020 chose a primitive library over building from scratch.
 *
 * Note the z-index: dialogs sit at --z-modal (60) while dropdowns sit at
 * --z-dropdown (70), because a select inside a modal is routine and must not clip
 * (02 §6).
 */

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description

export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 bg-[var(--neutral-950)]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:fade-in data-[state=closed]:fade-out',
        className,
      )}
      style={{ zIndex: 'var(--z-backdrop)', opacity: 'var(--opacity-scrim)' }}
      {...props}
    />
  )
})

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed top-1/2 left-1/2 w-full max-w-[560px] -translate-x-1/2 -translate-y-1/2',
          'border border-[var(--border-default)] bg-[var(--surface-overlay)]',
          'rounded-[var(--radius-xl)] p-[var(--space-6)]',
          'duration-[var(--duration-slow)]',
          className,
        )}
        style={{ zIndex: 'var(--z-modal)', boxShadow: 'var(--elevation-3)' }}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            'absolute top-[var(--space-4)] right-[var(--space-4)]',
            'rounded-[var(--radius-sm)] text-[var(--text-muted)]',
            'transition-colors hover:text-[var(--text-primary)]',
          )}
        >
          <X className="size-[var(--icon-sm)]" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})
