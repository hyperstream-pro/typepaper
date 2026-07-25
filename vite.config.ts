import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * The policy. `connect-src 'none'` is the important line: the page is
 * incapable of making a network request, so there is no code path —
 * ours, a dependency's, or an injected one's — that can send what you
 * typed anywhere.
 *
 * frame-ancestors is omitted here because <meta> CSP ignores it; it is
 * enforced by the real response header in vercel.json / public/_headers.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * Two brand marks ship in public/brand/ — "t" (the serif letter, the
 * default) and "lines" (text fading out). index.html references the
 * default; set VITE_BRAND=lines at build (or dev) time to switch every
 * reference. Both asset sets are copied to dist either way; only the HTML
 * pointers move.
 */
function brandSwitch(brand: string): Plugin {
  return {
    name: 'brand-switch',
    transformIndexHtml(html) {
      return html.replaceAll('/brand/t/', `/brand/${brand}/`)
    },
  }
}

/**
 * Belt and braces: the headers are the real enforcement, but baking the
 * policy into the document means it survives a hosting misconfiguration
 * or a move to a platform that drops custom headers.
 *
 * Build-only — in dev it would block Vite's HMR websocket.
 */
function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    // loadEnv (rather than process.env) keeps this file typecheckable
    // without node types; it reads VITE_* from the shell and .env files.
    brandSwitch(loadEnv(mode, '.', 'VITE_').VITE_BRAND === 'lines' ? 'lines' : 't'),
    cspMeta(),
  ],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    // Transparency, not debugging: anyone who opens DevTools sees the
    // real annotated TypeScript, not minified soup. Maps are static
    // same-origin files, fetched only while DevTools is open.
    sourcemap: true,
    reportCompressedSize: true,
    // There is one chunk and no dynamic imports, so preloading buys
    // nothing — and the polyfill ships a fetch() call that would trip
    // connect-src 'none'. Removing it means the bundle contains no
    // network-capable call of any kind.
    modulePreload: false,
  },
  server: {
    port: 5173,
  },
}))
