import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { ThemeToggle } from './theme-toggle'

afterEach(() => {
  delete document.documentElement.dataset.theme
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('ThemeToggle', () => {
  it('has an accessible name describing the action', async () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button')).toHaveAccessibleName(/theme/i)
  })

  it('cycles light → dark → system', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    const button = screen.getByRole('button')

    await user.click(button) // system → light
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(button) // light → dark
    expect(document.documentElement.dataset.theme).toBe('dark')

    await user.click(button) // dark → system
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('persists the explicit choice', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button'))
    expect(localStorage.getItem('cp-theme')).toBe('light')
  })

  it('still applies the theme when localStorage throws', async () => {
    // Private browsing and blocked site data both produce this. A theme store
    // that crashes there would take the whole app down (docs/design/11 §5).
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })

    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button'))

    // The DOM is still updated; only persistence is lost.
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('renders without crashing when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    expect(() => render(<ThemeToggle />)).not.toThrow()
  })

  it('has no axe violations', async () => {
    const { container } = render(<ThemeToggle />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
