import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names so a caller's classes EXTEND rather than fight a component's
 * defaults (docs/design/05-component-system.md §2). tailwind-merge resolves
 * conflicts by later-wins, so `<Button className="px-8">` actually overrides the
 * component's own padding instead of producing two competing classes.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
