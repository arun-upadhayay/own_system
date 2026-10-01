// FIXTURE. Deliberately violates ADR-013 so the rule-verification test can prove
// the lint rule fires. Never imported by application code.
declare const product: { slug: string }

export function openProduct(): string {
  if (product.slug === 'pos') return '/pos-dashboard'
  switch (product.slug) {
    case 'inventory':
      return '/stock'
    default:
      return '/'
  }
}

export const ICONS = { pos: 'pos.svg', inventory: 'inv.svg' }
export const ORDER = ['pos', 'kds']
export const enabled = ['pos', 'crm'].includes(product.slug)
