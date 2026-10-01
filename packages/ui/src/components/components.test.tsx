import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { Badge } from './badge.js'
import { Button } from './button.js'
import { Skeleton } from './skeleton.js'

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>Save changes</Button>)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('is disabled and aria-busy while loading', () => {
    // C8: every mutation can fail server-side, so loading is a required state.
    render(<Button loading>Save</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('merges caller classes rather than losing them', () => {
    render(<Button className="w-full">Save</Button>)
    expect(screen.getByRole('button').className).toContain('w-full')
  })

  it.each(['primary', 'secondary', 'ghost', 'danger', 'link'] as const)(
    'has no axe violations — %s variant',
    async (variant) => {
      const { container } = render(<Button variant={variant}>Action</Button>)
      expect(await axe(container)).toHaveNoViolations()
    },
  )
})

describe('Badge', () => {
  it('always carries a text label, never colour alone', async () => {
    // WCAG 1.4.1 / docs/design/10-accessibility.md §3.
    render(<Badge tone="critical">Suspended</Badge>)
    expect(screen.getByText('Suspended')).toBeInTheDocument()
  })

  it('hides the decorative dot from assistive technology', () => {
    const { container } = render(<Badge tone="good">Active</Badge>)
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it.each(['neutral', 'good', 'warning', 'serious', 'critical', 'info'] as const)(
    'has no axe violations — %s tone',
    async (tone) => {
      const { container } = render(<Badge tone={tone}>Status label</Badge>)
      expect(await axe(container)).toHaveNoViolations()
    },
  )
})

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
