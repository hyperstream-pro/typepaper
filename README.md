# Typepaper

A blank page for getting a thought out of your head. It holds text while you
write and forgets it when you leave. There is no account, no cookie, no
database, no analytics, and no network call of any kind.

Two controls: light/dark, and copy everything.

---

## Run it

```bash
npm ci
npm run dev      # http://localhost:5173
npm run build    # → dist/  (static, no server)
npm run preview
```

`npm run build` typechecks first, then builds. There is no server-side code
anywhere in this project, and adding any would break the cost model below.

## The typeface

The design is set in **Newsreader** — a screen-native face with old-style
bones, which is where the "modern but classic" brief lands. It is not
included here because fonts have their own licences and I would rather you
fetch it yourself.

1. Download Newsreader (OFL, free) — variable roman + variable italic, as
   `.woff2`, Latin subset.
2. Drop them in `public/fonts/` as:
   - `newsreader-variable.woff2`
   - `newsreader-italic-variable.woff2`

Until you do, the fallback stack in `styles.css` carries it — Iowan Old
Style, Palatino, Charter — which look genuinely good on Mac and Windows
respectively. Nothing breaks; you just get the local face instead.

**Do not swap this for a Google Fonts `<link>`.** That sends every visitor's
IP address to Google on page load, which would quietly undo the main promise
of the app. Self-hosted or system, nothing else.

---

## Deploy

The build output is five static files. Both configs are already in the repo,
so it deploys to either host with no code changes.

### Cloudflare Pages — recommended

Connect the repo, set build command `npm run build`, output directory `dist`.
`public/_headers` is copied into `dist/` at build time and Cloudflare reads it
from there.

This is the one that actually satisfies "zero expense at a million visitors."
Per Cloudflare's own docs, <cite index="30-1">requests to static assets are free
and unlimited on both free and paid plans</cite>. The free tier's real limit is
500 builds/month, which is ~16 deploys a day.

### Vercel

`vercel.json` sets `framework: vite`, a static output directory, and the
headers. It will Just Work. But be clear-eyed about the difference:

| | this app @ 1M visits/month | Vercel Pro includes |
|---|---|---|
| Bandwidth | ~124 GB (~214 GB with fonts) | 1 TB |
| Edge requests | ~4M (~6M with fonts) | 10M |

So a million *legitimate* visitors fits inside what you already pay for. The
problem is the shape of the downside: Vercel bills all served bandwidth past
the included tier, **including bot and attack traffic**, and there are
documented cases of a $20 Pro account landing at $700–$1,100 after a traffic
spike. Spend Management is opt-in and at least one reviewer reported it did
not meaningfully protect them.

If you deploy to Vercel, do both of these:

1. Turn on Spend Management with a hard cap in the dashboard.
2. Put the domain behind Cloudflare with the orange proxy on, so Cloudflare
   absorbs the traffic and caches the assets before Vercel ever sees them.

Or just use Cloudflare Pages and skip the whole question. The repo supports
either; nothing in the code has to change.

---

## What makes it secure

Not a claim — a list you can check.

**Nothing is stored.** No cookies, no `localStorage`, no `sessionStorage`, no
IndexedDB, no service worker. Verify it yourself against the built bundle:

```bash
npm run build
grep -c "localStorage\|sessionStorage\|indexedDB\|document.cookie" dist/assets/*.js
# 0
```

**Nothing can be sent.** The bundle contains no `fetch`, `XMLHttpRequest`,
`WebSocket`, or `sendBeacon` call. On top of that, the CSP sets
`connect-src 'none'`, so the browser refuses network requests from this page
at the platform level. Even a compromised dependency has no egress path.

```bash
grep -c "fetch(\|XMLHttpRequest\|WebSocket\|sendBeacon" dist/assets/*.js
# 0
```

**Paste is sanitised by the schema, not by a filter.** ProseMirror parses
pasted HTML into a fixed set of node and mark types and discards everything
else — this is structurally stronger than blocklisting. Tested with a payload
containing `<script>`, `<iframe>`, `<form>`, `<img onerror>`, `onclick`,
inline `style`, and a `javascript:` link. Result: text preserved, every
dangerous element and attribute gone, nothing executed.

`Link` is switched off in `main.ts` even though StarterKit now ships it —
it's the one mark in the default set that carries a URL, and a writing pad
doesn't need it.

**Strict CSP with no escape hatches.** `default-src 'none'`, and no
`unsafe-inline` anywhere, including for styles. Getting there took one real
change: Tiptap injects a `<style>` element at runtime by default, which a
strict policy correctly blocks. So `injectCSS: false` is set and those rules
are bundled into `styles.css` instead. The policy is enforced by response
headers *and* baked into the document as a `<meta>` tag at build time, so it
survives a hosting misconfiguration.

**No third-party requests at all.** No CDN, no font host, no analytics. The
`Permissions-Policy` header denies camera, mic, geolocation, sensors, USB,
serial, topics, local font enumeration, clipboard *reading* (the app only
ever writes), and synchronous XHR.

**Spellcheck is off.** Chrome's "enhanced spell check" and Edge's Microsoft
Editor both transmit what you type to a remote server. Basic spellcheck is
local, but the browser decides which one is running, not us — so the app opts
out of the question. See below to change it.

**Grammar extensions and page translation are opted out.** Grammarly and
LanguageTool run as browser extensions, outside the CSP's reach, and upload
what you type to their servers. The editor carries their documented opt-out
attributes, which the extensions honour. Chrome's full-page translate — which
uploads the page text to Google — is likewise declined (`translate="no"` and
a `notranslate` meta). These are the exfiltration paths headers can't close,
fenced off by the only means available.

---

## Check the code itself

The claims above don't ask for trust, and neither does the code.

**The source is public** — https://github.com/hyperstream-pro/typepaper —
and the blank sheet links to it (bottom-left, "source"; it disappears along
with the promise line on your first keystroke). The link is navigation, not
a request: nothing is fetched unless you click it.

**The shipped JavaScript is glass-boxed.** Source maps are published alongside
the bundle, so DevTools → Sources shows the real annotated TypeScript — ours
and every dependency's — not minified output. Maps are same-origin static
files fetched only while DevTools is open; normal visits never load them.

**The build is reproducible.** The lockfile is committed and the output is
deterministic — two builds produce byte-identical files. So you can prove the
served code is the audited code:

```bash
npm ci && npm run build
shasum -a 256 dist/assets/*
# compare against what the site serves — the hashes are in the filenames
```

**The invariants are enforced, not remembered.** `npm run verify` checks the
built output for every promise on this page — no storage APIs, no network
APIs, no external origins, no unreviewed URLs in the bundle, strict CSP in
all three places it lives — and fails the build if any of them slips.

---

## Known limits

A web page cannot promise what the rest of your machine does. For
completeness, the edges that sit outside this page's control:

- **The clipboard leaves the sandbox by design.** Copy hands your text to
  the operating system, and Apple's Universal Clipboard or Windows Cloud
  Clipboard may sync it off-device. That's the one action you asked for.
- **Browser extensions** with page access can read anything you can see.
  The CSP does not bind them; the editor carries the documented opt-outs
  for the common grammar checkers, which is the strongest available fence.
- **Mobile keyboards and IMEs** may learn from (and sometimes upload)
  what's typed. The OS picks the keyboard, not the page.
- **RAM, swap, hibernation files, crash restore, accessibility APIs** are
  the operating system's business, not the page's.

An edge found inside what the page controls is a bug — please report it.
One found outside is a contribution — it belongs on this list.

---

## Decisions you might want to reverse

Each of these is deliberate and each is a small edit. I would rather flag
them than have you find them.

**The page opens in light mode, and the theme is not remembered.** The
toggle switches to dark for the session; on reload it's light again.
Persisting it would mean `localStorage`, and the empty screen promises
nothing survives the tab — keeping the promise literally true beats saving
you one click. Following the OS preference instead is a small change in
`main.ts` (`activeTheme`) plus a `prefers-color-scheme` block in
`styles.css`; persisting is ~3 more lines you shouldn't write.

**Spellcheck is off.** `src/main.ts` → `editorProps.attributes.spellcheck`.
Change `'false'` to `'true'` if you want squiggles more than you want the
guarantee.

**There is a "you have unsaved work" prompt on close.** A native browser
dialog, no storage involved — a stray ⌘W shouldn't cost you an hour. If you
want the page to close without argument, delete the `beforeunload` block at
the bottom of `main.ts`.

**The empty screen states the promise.** "Nothing is saved. Close the tab and
it's gone." It disappears on your first keystroke. A first-time visitor has
no other way to know what the app is, but if you want the sheet truly bare,
delete `<p class="promise">` from `index.html`.

**Underline survives in the HTML flavour of a copy, not the plain-text one.**
Markdown has no underline syntax. Everything else round-trips.

---

## The name

**Typepaper** — a typewriter's paper is the only memory the machine has, and
when you pull the sheet out, nothing stays behind.

It lives at **typepaper.app**. The TLD is part of the design: all of `.app`
is HSTS-preloaded, so every browser refuses to load it over anything but
HTTPS — enforced at the TLD level, before this app's own headers are even
consulted. The same shape as everything else here: a guarantee the platform
enforces rather than a promise we make.

---

## Structure

```
index.html          shell + inline SVG icons (no icon dependency)
src/main.ts         editor, theme, clipboard, ephemerality guards
src/serialize.ts    ProseMirror doc → Markdown-ish plain text, hand-written
src/styles.css      palette, type, layout, bundled ProseMirror base styles
vite.config.ts      static build + CSP meta injection + brand switch
vercel.json         Vercel headers and cache policy
public/_headers     the same, for Cloudflare Pages
public/brand/       two marks: lines/ (default) and t/ — favicon,
                    social card, touch icon each. Build with VITE_BRAND=t
                    to switch every reference; both ship either way.
```

Four production dependencies (43 packages transitively), all from the Tiptap
monorepo. No framework, no icon library, no CSS library, no Markdown library.

## Weight

~124 kB gzipped on a cold visit, ~214 kB once the two font files are in
place. Repeat visits are a single revalidation of a 1 kB HTML file; the
hashed assets are `immutable`.

If you want it smaller, the lever is `StarterKit`: disabling `link` removes
it from the schema but not from the bundle, because StarterKit imports
`linkifyjs` statically. Importing the ~14 extensions individually instead
drops that weight, at the cost of a longer dependency list to maintain. I
chose the maintainable side; the trade is yours to make.

## License

MIT © 2026 ghostsinthemachine ltd. Read it, fork it, verify it.
