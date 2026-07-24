# CLAUDE.md

A single-page writing surface. You type, you copy, you leave, it's gone.
Two controls: light/dark and copy-everything. No account, no save, no name yet.

Built and verified July 2026. Vite + vanilla TS + Tiptap v3. Static output only.

## Invariants

These are the product, not preferences. Each one is invisible in the code —
you can't see an absence — so they need stating.

1. **Nothing persists.** No localStorage, sessionStorage, IndexedDB, cookies,
   service worker, cache API. This includes the theme, which is session-only
   on purpose (see Deliberate omissions).
2. **Nothing leaves the browser.** No fetch, XHR, WebSocket, sendBeacon. No
   analytics, no error reporting, no telemetry, however well-intentioned. The
   CSP sets `connect-src 'none'`, so it would fail at runtime anyway.
3. **No third-party origins.** No CDN, no Google Fonts `<link>` — that leaks
   every visitor's IP on page load. Self-hosted or system fonts only.
4. **No server-side code.** No API routes, serverless functions, edge
   functions, or middleware. This is the cost model, not a style choice: a
   static file is free to serve at any scale, a function is metered.
5. **No `unsafe-inline` or `unsafe-eval` in the CSP.** If a CSP error appears,
   fix what caused it. There is a worked example of doing exactly that below.

`npm run verify` enforces 1–5 against the built bundle and fails the build.
Run it before reporting any task complete. Don't weaken the check to make it
pass — if it fires, it's usually right.

## Pitfalls already hit

Costly to rediscover, so:

- **Tiptap injects a `<style>` tag at runtime.** `injectCSS: true` is the
  default and strict `style-src 'self'` blocks it, leaving a subtly unstyled
  editor with one console warning. We set `injectCSS: false` and carry those
  rules in `styles.css` instead. Don't remove either half.
- **Vite's modulepreload polyfill ships a `fetch()`.** Trips `connect-src
  'none'` on older browsers. `build.modulePreload: false` — there's one chunk,
  so it bought nothing anyway.
- **`hidden` doesn't reflect onto SVG elements.** It's an `HTMLElement`
  property. Icon visibility is driven by `data-state` on the button plus CSS.
  Setting `.hidden` on an `<svg>` silently does nothing.
- **StarterKit v3 differs from v2.** `history` is now `undoRedo`; `Link` and
  `Underline` ship by default. `Placeholder` moved to `@tiptap/extensions`.
- **`link: false` removes Link from the schema but not linkifyjs from the
  bundle** — StarterKit imports it statically. Expected, not a bug.
- **Paste safety comes from the ProseMirror schema, not a filter.** Unknown
  node and mark types are discarded on parse. Verified against `<script>`,
  `<iframe>`, `<form>`, `<img onerror>`, `onclick`, inline `style`, and a
  `javascript:` link — all stripped, nothing executed. Adding permissive node
  types weakens this; adding an HTML sanitiser library is redundant.
- **Pasting styled HTML logs one CSP violation per `style` attribute.**
  ProseMirror briefly materialises the pasted markup while parsing, the CSP
  blocks the inline style, then the schema discards it anyway. Console noise,
  not a bug — two layers catching the same payload. Never "fix" it by adding
  `unsafe-inline`.
- **Trusted Types breaks the editor outright.** Adding
  `require-trusted-types-for 'script'` to the CSP kills Tiptap at
  construction — `DOMParser.parseFromString` throws needing TrustedHTML
  before the editor mounts (tested against the built bundle, July 2026).
  The schema already provides the paste guarantee; don't add the directive.
- **Browser extensions run outside the CSP.** Grammarly and LanguageTool
  inject into contenteditables and upload text; no header stops them. The
  editor carries their documented opt-out attributes (`data-gramm`,
  `data-lt-active`, etc. in `main.ts`), and the page opts out of Chrome's
  full-page translate (`translate="no"` + notranslate meta in `index.html`),
  which otherwise uploads page text to Google. These are presences, not
  absences, so `npm run verify` checks they're still there.

## Deliberate omissions that look like bugs

Don't "fix" these without asking. Each was a judgment call, and each is a
small edit if the answer changes.

- **Theme isn't remembered across reloads.** Persisting it needs
  localStorage, and the empty screen promises nothing survives the tab.
  Keeping the promise literally true beat saving one click.
- **`spellcheck="false"`.** Chrome's enhanced spell check and Edge's Microsoft
  Editor transmit what you type; the browser picks which engine runs, not us.
- **There is a `beforeunload` prompt.** Native dialog, no storage involved. A
  stray ⌘W shouldn't cost an hour.
- **The empty screen carries a line of copy** ("Nothing is saved…"), which
  vanishes on first keystroke. A first-time visitor has no other way to learn
  what the app is.
- **The blank sheet also carries a "source" link** (bottom-left) to the
  public repo, github.com/hyperstream-pro/typepaper. It's navigation, not a
  resource load — nothing is fetched unless clicked — so invariant 3 holds;
  `npm run verify` knows the difference and checks the link stays present.
  It fades with the promise line. Don't add further chrome alongside it.
- **Underline survives the HTML clipboard flavour but not the plain-text
  one.** Markdown has no underline syntax. Everything else round-trips.
- **No toolbar, no word count, no autosave, no export.** Markdown input rules
  only. Scope is two actions: type, copy. New features need a real argument.
- **Source maps are ON in production, deliberately.** They're transparency,
  not an oversight: DevTools shows the real annotated TypeScript, and the
  README points users at it. Maps only load while DevTools is open, so they
  cost normal visits nothing. Don't turn them off to "save bytes".
- **The build is verified deterministic** (two builds → byte-identical
  output), and the README teaches readers to reproduce it. Don't add
  build-time randomness, timestamps, or environment-dependent output.

## Design

One accent colour, spent only on the caret and the copy confirmation — that
restraint is the whole visual idea, so don't distribute it around the UI. The
palette is day/night on one pane of glass; controls stay quiet at rest. Type
is Newsreader with a system-serif fallback.

## Deploy

**Cloudflare Pages is the target.** Build `npm run build`, output `dist`,
`public/_headers` gets copied in automatically. Static asset requests are free
and unlimited on every tier, which is what makes the cost promise real.

Vercel works too (`vercel.json` is ready) and 1M visits/month fits inside
Pro's included allowances. But Vercel bills all served bandwidth past the
tier including bot and attack traffic — documented $20 accounts hitting
$700–$1,100 on a spike. If Vercel, enable Spend Management and proxy through
Cloudflare.

## Open work

- Two font files into `public/fonts/` (see the README there). Fallback stack
  carries the design until then; nothing is broken.
- Naming: **decided — "Typepaper" at typepaper.app** (July 2026; applied to
  title, package.json, README, canonical link). .app chosen deliberately:
  the TLD is HSTS-preloaded, extending the platform-enforced-guarantee
  pattern to the domain itself. Registration pending — register before
  announcing anything. typepaper.com is a HugeDomains squat; ignore it.
- Optional: importing Tiptap extensions individually instead of StarterKit
  drops linkifyjs, at the cost of a longer dependency list. Deliberately not
  done — maintainability won.
