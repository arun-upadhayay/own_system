#!/usr/bin/env node
/**
 * WCAG contrast gate — docs/design/10-accessibility.md §9.1.
 *
 * This script exists because two accessibility failures were found during
 * Phase 0.5 BY COMPUTING contrast rather than judging it (docs/design/04 §7):
 *
 *   V-1  neutral-400 as a light-mode placeholder measured 2.57:1 — it failed even
 *        the 3:1 non-text floor, yet 2.57:1 reads as a perfectly acceptable gray.
 *   V-2  the dark page and dark card measured 1.08:1 — the layers were visually
 *        indistinguishable, yet 1.08:1 reads as "subtle".
 *
 * Both would have shipped on visual judgement. This gate re-verifies every pair in
 * CI so neither can silently return when a neutral or a surface is next adjusted.
 *
 * Exits non-zero on any failure, which fails the build.
 */

const relativeLuminance = (hex) => {
  const h = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

const ratio = (a, b) => {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// ---------------------------------------------------------------- the palette
// Must stay in step with packages/ui/src/styles/tokens.css.
const LIGHT = {
  page: '#F7F8FA',
  raised: '#FFFFFF',
  overlay: '#FFFFFF',
  textPrimary: '#14171F',
  textSecondary: '#4D5563',
  textMuted: '#6B7482',
  textPlaceholder: '#6B7482',
  textLink: '#4338CA',
  textOnPrimary: '#FFFFFF',
  borderDefault: '#E2E5EB',
  borderStrong: '#CBD0DA',
  borderFocus: '#4F46E5',
  actionPrimary: '#4F46E5',
  statusGoodText: '#046904',
  statusWarningText: '#7A4F00',
  statusSeriousText: '#8A3A17',
  statusCriticalText: '#A32020',
}

const DARK = {
  page: '#0B0D12',
  raised: '#1A1E28',
  overlay: '#252A35',
  textPrimary: '#F7F8FA',
  textSecondary: '#CBD0DA',
  textMuted: '#9AA2B1',
  textPlaceholder: '#9AA2B1',
  textLink: '#A5ADFB',
  textOnPrimary: '#FFFFFF',
  borderDefault: '#3A4150',
  borderFocus: '#A5ADFB',
  actionPrimary: '#4F46E5',
  statusGoodText: '#4ADE4A',
  statusWarningText: '#FAB219',
  statusSeriousText: '#F0A07E',
  statusCriticalText: '#F08A8A',
}

const AA_TEXT = 4.5
const AA_NON_TEXT = 3.0
const LAYER_SEPARATION = 1.15

/** [label, foreground, background, minimum] */
const checks = [
  // ---- light: text on the card surface
  ['light · primary text', LIGHT.textPrimary, LIGHT.raised, AA_TEXT],
  ['light · secondary text', LIGHT.textSecondary, LIGHT.raised, AA_TEXT],
  ['light · muted text', LIGHT.textMuted, LIGHT.raised, AA_TEXT],
  // V-1: placeholder is real text and must clear 4.5:1, which is why this token
  // is neutral-500 and not neutral-400.
  ['light · placeholder (V-1)', LIGHT.textPlaceholder, LIGHT.raised, AA_TEXT],
  ['light · link text', LIGHT.textLink, LIGHT.raised, AA_TEXT],
  ['light · primary text on page', LIGHT.textPrimary, LIGHT.page, AA_TEXT],
  ['light · secondary text on page', LIGHT.textSecondary, LIGHT.page, AA_TEXT],

  // ---- light: actions and focus
  ['light · white on primary button', LIGHT.textOnPrimary, LIGHT.actionPrimary, AA_TEXT],
  ['light · focus ring vs card', LIGHT.borderFocus, LIGHT.raised, AA_NON_TEXT],
  ['light · focus ring vs page', LIGHT.borderFocus, LIGHT.page, AA_NON_TEXT],

  // ---- light: status text variants exist precisely because the swatch hues
  // cannot carry text (warning 1.83:1, serious 2.64:1 on white).
  ['light · status good text', LIGHT.statusGoodText, LIGHT.raised, AA_TEXT],
  ['light · status warning text', LIGHT.statusWarningText, LIGHT.raised, AA_TEXT],
  ['light · status serious text', LIGHT.statusSeriousText, LIGHT.raised, AA_TEXT],
  ['light · status critical text', LIGHT.statusCriticalText, LIGHT.raised, AA_TEXT],

  // ---- dark: text on the card surface
  ['dark · primary text', DARK.textPrimary, DARK.raised, AA_TEXT],
  ['dark · secondary text', DARK.textSecondary, DARK.raised, AA_TEXT],
  ['dark · muted text', DARK.textMuted, DARK.raised, AA_TEXT],
  ['dark · placeholder', DARK.textPlaceholder, DARK.raised, AA_TEXT],
  ['dark · link text', DARK.textLink, DARK.raised, AA_TEXT],
  ['dark · primary text on page', DARK.textPrimary, DARK.page, AA_TEXT],
  ['dark · primary text on overlay', DARK.textPrimary, DARK.overlay, AA_TEXT],

  // ---- dark: actions and focus
  ['dark · white on primary button', DARK.textOnPrimary, DARK.actionPrimary, AA_TEXT],
  ['dark · focus ring vs card', DARK.borderFocus, DARK.raised, AA_NON_TEXT],

  // ---- dark: status text
  ['dark · status good text', DARK.statusGoodText, DARK.raised, AA_TEXT],
  ['dark · status warning text', DARK.statusWarningText, DARK.raised, AA_TEXT],
  ['dark · status serious text', DARK.statusSeriousText, DARK.raised, AA_TEXT],
  ['dark · status critical text', DARK.statusCriticalText, DARK.raised, AA_TEXT],

  // V-2: the dark page and card must read as distinct layers. This is the pair
  // that measured 1.08:1 before correction.
  ['dark · page vs card separation (V-2)', DARK.page, DARK.raised, LAYER_SEPARATION],
]

let failed = 0
const rows = []

for (const [label, fg, bg, min] of checks) {
  const r = ratio(fg, bg)
  const pass = r >= min
  if (!pass) failed++
  rows.push({ label, measured: `${r.toFixed(2)}:1`, required: `${min}:1`, result: pass ? 'PASS' : 'FAIL' })
}

const width = Math.max(...rows.map((r) => r.label.length))
for (const r of rows) {
  const line = `${r.result.padEnd(5)} ${r.measured.padStart(7)}  need ${r.required.padEnd(6)} ${r.label.padEnd(width)}`
  if (r.result === 'FAIL') console.error(line)
  else console.log(line)
}

console.log(`\n${checks.length - failed}/${checks.length} contrast checks passed`)

if (failed > 0) {
  console.error(
    `\n${failed} contrast check(s) FAILED. These are WCAG 2.1 AA violations and block the build.\n` +
      'Adjust the token in packages/ui/src/styles/tokens.css and update docs/design/04-color-system.md.\n' +
      'Do not lower a threshold to make this pass.\n',
  )
  process.exit(1)
}

// Non-text pairs that are intentionally below 3:1 are documented exceptions, not
// silent omissions: the status *swatch* hues (warning 1.83:1, serious 2.64:1 on
// white) and three chart series slots. Both are mitigated by icon-plus-label and
// by the chart relief rule (docs/design/10 §2.2). They are deliberately not
// asserted here, because asserting them would fail by design.
console.log('All contrast gates passed (documented exceptions: docs/design/10 §2.2)\n')
