/* eslint-disable no-restricted-syntax --
 * THE ONE PERMITTED USE of dangerouslySetInnerHTML in this codebase.
 *
 * Sanctioned by docs/architecture/15-security-architecture.md §6 (design-review
 * finding D-4). The blanket ban stands everywhere else; this is the single named
 * exception, and the reasoning is:
 *
 *   - The script MUST run before first paint. Without it every dark-mode user
 *     sees a white flash on every page load, because React has not hydrated yet.
 *     A useEffect cannot do this; only an inline script can.
 *   - The content is a COMPILE-TIME CONSTANT with no interpolated input. There is
 *     no user data, no props, and nothing from the request in the string.
 *   - It carries the per-request CSP nonce (15 §7.1), so it is covered by
 *     script-src rather than requiring 'unsafe-inline'.
 *
 * A blanket ban that developers routinely disable is weaker than a ban with one
 * documented exception. If a second exception is ever proposed, it needs an ADR.
 */

/**
 * Applies the stored theme to <html> before paint.
 *
 * Mirrors the cascade in docs/design/02-design-tokens.md §1.1: an explicit choice
 * wins over the OS preference in BOTH directions, which a media query alone
 * cannot achieve.
 */
const THEME_BOOTSTRAP = `
try {
  var stored = localStorage.getItem('cp-theme');
  var root = document.documentElement;
  if (stored === 'dark' || stored === 'light') {
    root.dataset.theme = stored;
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    root.dataset.theme = 'dark';
  }
} catch (e) {
  /* localStorage throws in private mode or with site data blocked. The page must
     still render: the CSS media query provides the OS-preference fallback. */
}
`.trim()

export function ThemeScript({ nonce }: { nonce: string | undefined }): React.JSX.Element {
  return (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
    />
  )
}
