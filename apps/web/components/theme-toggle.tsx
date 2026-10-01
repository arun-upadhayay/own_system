'use client'

import * as React from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@cp/ui'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'cp-theme'

/**
 * Theme toggle. A client component, as deep in the tree as possible so the server
 * shell above it stays server-rendered (docs/design/11 §2.1).
 *
 * Every localStorage access is wrapped: it throws in private mode and with site
 * data blocked, and a theme store that crashes there would take the whole app
 * with it (11 §5).
 */
export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = React.useState<Theme>('system')

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'dark' || stored === 'light') setTheme(stored)
    } catch {
      /* unavailable — the CSS media query still provides the OS fallback */
    }
  }, [])

  const apply = (next: Theme): void => {
    setTheme(next)
    const root = document.documentElement
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY)
        delete root.dataset.theme
      } else {
        localStorage.setItem(STORAGE_KEY, next)
        root.dataset.theme = next
      }
    } catch {
      // Still apply to the DOM: the preference simply will not persist.
      if (next === 'system') delete root.dataset.theme
      else root.dataset.theme = next
    }
  }

  const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => apply(next)}
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      data-testid="theme-toggle"
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}
