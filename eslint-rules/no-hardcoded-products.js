/**
 * Enforces ADR-013 and master prompt §33: the Control Plane must contain no
 * product-specific code. Products are rows in the `products` table; adding one
 * is a registration, not a release.
 *
 * This rule catches the forms a violation actually takes:
 *
 *   if (product.slug === 'pos')                  → comparison
 *   switch (slug) { case 'pos': }                → switch case
 *   ['pos','kds'].includes(slug)                 → membership test
 *   const ICONS = { pos: ..., inventory: ... }    → slug-keyed map
 *   <Route path="/pos" />                         → product route literal
 *
 * It is a guard, not a proof. The complete test of ADR-013 is the Phase 11
 * integration test that registers a fictional product via the API and asserts it
 * appears in the launcher, renders a discovery page and accepts a conversion
 * request — with no code change. This rule catches the regressions that would
 * otherwise reach that test.
 */

/** Reserved slugs: the first ecosystem's products, per baseline §11. */
const RESERVED = new Set([
  'pos',
  'inventory',
  'kds',
  'crm',
  'analytics',
  'hr',
  'point-of-sale',
  'kitchen-display',
])

const isReserved = (v) => typeof v === 'string' && RESERVED.has(v.toLowerCase())

const MESSAGE =
  "Hardcoded product reference '{{name}}' violates ADR-013. Products are registry data: " +
  'drive behaviour from the `products` table, not from a slug in code. ' +
  'See docs/architecture/21-architecture-decisions.md (ADR-013).'

/** @type {import('eslint').Rule.RuleModule} */
export const noHardcodedProducts = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow product-specific branching; products are registry data (ADR-013)',
    },
    schema: [],
    messages: { hardcoded: MESSAGE },
  },

  create(context) {
    const report = (node, name) => context.report({ node, messageId: 'hardcoded', data: { name } })

    /** `x === 'pos'` in either direction. */
    const checkComparison = (node) => {
      if (!['==', '===', '!=', '!=='].includes(node.operator)) return
      for (const side of [node.left, node.right]) {
        if (side.type === 'Literal' && isReserved(side.value)) report(side, side.value)
      }
    }

    return {
      BinaryExpression: checkComparison,

      SwitchCase(node) {
        if (node.test?.type === 'Literal' && isReserved(node.test.value)) {
          report(node.test, node.test.value)
        }
      },

      /** `[...].includes('pos')`, `.indexOf('pos')`, `.startsWith('/pos')` */
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return
        if (!['includes', 'indexOf', 'startsWith', 'endsWith'].includes(callee.property.name)) return
        for (const arg of node.arguments) {
          if (arg.type !== 'Literal' || typeof arg.value !== 'string') continue
          const bare = arg.value.replace(/^\/+/, '')
          if (isReserved(bare)) report(arg, arg.value)
        }
      },

      /** Slug-keyed lookup maps — the icon-map anti-pattern. */
      ObjectExpression(node) {
        for (const prop of node.properties) {
          if (prop.type !== 'Property') continue
          const key = prop.key
          const name =
            key.type === 'Identifier' ? key.name : key.type === 'Literal' ? key.value : undefined
          if (isReserved(name)) report(key, name)
        }
      },

      /** Array of slugs, e.g. a hardcoded product order. */
      ArrayExpression(node) {
        const literals = node.elements.filter(
          (el) => el?.type === 'Literal' && typeof el.value === 'string',
        )
        const hits = literals.filter((el) => isReserved(el.value))
        // Two or more reserved slugs in one array is unambiguously a product list.
        if (hits.length >= 2) for (const el of hits) report(el, el.value)
      },

      /** JSX route/path literals: path="/pos" */
      JSXAttribute(node) {
        if (node.value?.type !== 'Literal' || typeof node.value.value !== 'string') return
        const segments = node.value.value.split('/').filter(Boolean)
        for (const seg of segments) if (isReserved(seg)) report(node.value, seg)
      },
    }
  },
}

export default { rules: { 'no-hardcoded-products': noHardcodedProducts } }
