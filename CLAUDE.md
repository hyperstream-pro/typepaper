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

`npm run verify` enforces 1–5 against the built bundle, and `npm run build`
runs it as its final step — so a violation fails the build (and therefore
the Cloudflare/Vercel deploy, whose build command is `npm run build`). It
parses the CSP in all three places the policy lives and rejects any source
that isn't exactly `'self'` or `'none'` (a widened `connect-src 'none' https:`
or a bare host fails — substring checks used to wave those through), pins the
other security headers to their exact values symmetrically across `_headers`
and `vercel.json`, and bans network/navigation/storage API identifiers in the
bundle even when aliased. `scripts/verify.test.mjs` mutates the built site the
way a regression would and asserts the checker catches each one; `npm test`
(serializer + verify) runs after verify in the build. Don't weaken the check
to make it pass — if it fires, it's usually right.

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
- **`isBlank()` is defined by the serializer, not a node count.** It returns
  `toPlainText(doc) === ''` (after a cheap textContent early-out). A
  `content.size` heuristic looks tempting and is wrong in both directions:
  four empty paragraphs exceed a small size threshold yet are blank, and a
  lone `---` is under it yet is real content. The same definition backs the
  copy button and the blank-sheet overlay, so they never disagree. Don't reintroduce a size shortcut.
- **The code-block serializer bumps its fence** to one more backtick than the
  longest run inside the body (CommonMark), or a code block *about* Markdown
  closes its own fence early. Don't simplify it back to a fixed ```` ``` ````.
  Inline code spans do the same widening, and pad with a space when the content
  starts or ends with a backtick.
- **The serializer threads an `indent` string, not a depth count.** Content
  under a list marker is indented by the marker's own width (`1. ` → three,
  `- ` → two); a fixed two-space indent silently de-nested ordered sublists and
  let a code block break out of its list item and eat the rest of the document.
  Every block body line (code, continuation paragraphs, hard-break lines) is
  indented to its column for the same reason. There is deliberately no global
  `\n{3,}` collapse — it reached into code-block bodies and deleted the user's
  blank lines. `scripts/serialize.test.mjs` locks all of this in; run it before
  touching `serialize.ts`.
- **The code-block `language` attribute is sanitised before it hits the fence.**
  It's invisible in the editor but StarterKit's VS Code paste handler fills it
  from an attacker-controlled clipboard field, so an unfiltered value injects
  lines the user never saw into the "copy everything" output. Only a short
  language-name token (`/^[A-Za-z0-9+#._-]{1,32}$/`) survives. Don't drop the
  filter back to a bare `typeof === 'string'` check.
- **Copy failure shows monochrome words, success shows the accent glyph.**
  Sighted users get no glyph change on failure, so `.feedback` surfaces the
  message in `--mute-text` (the AA-contrast text token — `--mute` itself stays
  quiet for the icons, which as non-text UI only need 3:1); the lone accent
  colour stays reserved for the success confirmation. The sr-only `#status` is
  the screen-reader channel. Keep both.
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

- **The page opens in light mode, ignoring the OS preference** (decided
  2026-07-25), and the theme isn't remembered across reloads. Persisting it
  needs localStorage, and the empty screen promises nothing survives the
  tab. Keeping the promise literally true beat saving one click. There is
  deliberately no `prefers-color-scheme` block in styles.css — it would
  flash dark before the script sets day.
- **`spellcheck="false"`.** Chrome's enhanced spell check and Edge's Microsoft
  Editor transmit what you type; the browser picks which engine runs, not us.
- **There is deliberately no "leave site?" prompt.** The `beforeunload` guard
  was removed 2026-07-26 — closing the tab is frictionless, which is exactly
  what "gone when you close the tab" promises. Nothing is kept, so there is
  nothing to warn about.
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

Two brand marks live in `public/brand/`: **"t"** (the serif letter — the
default, chosen 2026-07-25 as the more distinctive icon) and **"lines"**
(three bars fading out). `VITE_BRAND=lines` at build time switches every
reference; the plugin in vite.config.ts rewrites the HTML.

The `t` favicon ships in two styles: **`favicon.svg`** (black on white — the
default; a fixed white tile stands out on any browser tab) and
**`favicon-theme.svg`** (theme-matching paper/ink, which blends into the tab).
Swap the `<link rel="icon">` in `index.html` to interchange them. The touch
icon (`apple-touch-icon.png`) matches the black-on-white favicon, rendered from
Iowan Old Style to match its letterform.
The original caret-on-a-pane mark was retired deliberately (2026-07-25) —
too close to iA Writer's cursor logo. Don't bring it back.

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

- **Manual crash-restore test before launch** (cannot be automated from this
  harness): in Firefox and Chrome, type text, force-kill the browser
  process, reopen, restore the session — does the text come back? Firefox's
  session store captures form state to disk; whether it captures this
  contenteditable is unknown. (`autocomplete="off"` is NOT a mitigation —
  it's defined for form controls and inert on contenteditable; it was
  briefly added and removed, don't re-add it.) State the result flatly in
  README's Known limits table. If text survives, that is NOT a known limit
  — "nothing survives the tab" breaks inside the browser — frame it as a
  bug with a fix in flight.
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
