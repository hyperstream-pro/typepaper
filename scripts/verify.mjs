// Verifies the CLAUDE.md invariants against the *built* output in dist/.
// Run after `npm run build`; exits non-zero on any violation.
//
//   1. Nothing persists   — no storage API appears in the bundle
//   2. Nothing leaves     — no network/navigation API appears in the bundle
//   3. No third parties   — no external origin is referenced by any asset
//   4. No server-side code — output is static files only, repo has no functions
//   5. Strict CSP         — connect-src 'none', no unsafe-inline/unsafe-eval,
//                           identical across meta tag, _headers, vercel.json
//   6. Opt-outs present   — extension/translate/spellcheck fences still in place
//
// The checks are deliberately strict and structural rather than substring-
// based: the earlier version proved that a widened CSP directive
// (`connect-src 'none' https:`), an aliased `fetch`, or a header deleted from
// one host file could all slip past a green build. Each of those now fails.
// If a check fires, it is usually right — fix the cause, don't loosen the check.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// fileURLToPath (not URL.pathname) so a checkout path containing a space, %,
// or non-ASCII character — or a Windows drive path — resolves correctly.
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const failures = []
const fail = (msg) => failures.push(msg)

if (!existsSync(dist)) {
  console.error(`verify: dist/ not found at ${dist} — run \`npm run build\` first.`)
  process.exit(1)
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })

const files = walk(dist)
const rel = (p) => relative(root, p)
const textFiles = files.filter((p) =>
  ['.js', '.css', '.html', '.svg', '.json', '.webmanifest', ''].includes(extname(p)),
)
const jsFiles = files.filter((p) => extname(p) === '.js')

// Guard against a vacuous pass: the invariant-1/2 scans look for forbidden
// APIs *in the bundle*, so a broken build that emitted no JS (or no HTML)
// would satisfy them trivially and report success. Require the real
// artifacts to exist before trusting an all-clear.
if (!jsFiles.length) {
  console.error('verify: dist/ has no JavaScript bundle — build is incomplete, refusing to pass.')
  process.exit(1)
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error('verify: dist/index.html missing — build is incomplete, refusing to pass.')
  process.exit(1)
}

/* 1 + 2 — the bundle must not contain storage, network, or navigation APIs.
   Matched as identifiers (word boundaries), not call syntax, so an aliased or
   destructured reference (`const {fetch: f} = globalThis`) is still caught —
   the bare identifier is what indirection can't hide. window.open and
   location are banned outright: both are zero in the current bundle (Tiptap
   v3's disabled Link extension is tree-shaken, so the old exemption for its
   dead handler is no longer needed). CSP cannot block top-level navigation,
   so these two are the sole guard for that egress class. */
const FORBIDDEN = [
  [/\blocalStorage\b/, 'persistence (invariant 1)'],
  [/\bsessionStorage\b/, 'persistence (invariant 1)'],
  [/\bindexedDB\b/, 'persistence (invariant 1)'],
  [/\bcookie\b/, 'persistence (invariant 1)'], // document.cookie / cookieStore
  [/\bserviceWorker\b/, 'persistence (invariant 1)'],
  [/\bcaches\b/, 'persistence (invariant 1)'],
  [/\bCacheStorage\b/, 'persistence (invariant 1)'],
  [/\bfetch\b/, 'network egress (invariant 2)'],
  [/\bXMLHttpRequest\b/, 'network egress (invariant 2)'],
  [/\bWebSocket\b/, 'network egress (invariant 2)'],
  [/\bsendBeacon\b/, 'network egress (invariant 2)'],
  [/\bEventSource\b/, 'network egress (invariant 2)'],
  [/\bRTCPeerConnection\b/, 'network egress (invariant 2)'],
  [/\bWebTransport\b/, 'network egress (invariant 2)'],
  [/\blocation\b/, 'navigation egress (invariant 2)'], // location = url, location.href, etc.
]

for (const file of textFiles) {
  const src = readFileSync(file, 'utf8')
  for (const [re, why] of FORBIDDEN) {
    if (re.test(src)) fail(`${rel(file)}: matches ${re} — ${why}`)
  }
}

// window.open is the one navigation call left in the bundle: StarterKit
// statically imports the disabled Link extension, whose click-handler calls
// window.open(href). It is dead code — Link is off, so the handler never fires
// — so exactly one occurrence is allowed. A second window.open, or any other
// object's .open( (an XHR/IndexedDB handle would already be caught above),
// fails: that's how a real navigation-exfil call would look.
const bundleJs = jsFiles.map((p) => readFileSync(p, 'utf8')).join('\n')
const openTotal = (bundleJs.match(/\.open\s*\(/g) || []).length
const windowOpen = (bundleJs.match(/window\.open\s*\(/g) || []).length
if (openTotal !== windowOpen)
  fail(`bundle: ${openTotal - windowOpen} non-window .open( call(s) — navigation/IO egress (invariant 2)`)
if (windowOpen > 1)
  fail(`bundle: ${windowOpen} window.open() calls, expected at most 1 (the disabled Link dead code) (invariant 2)`)

// Obfuscated computed access — `globalThis["fet"+"ch"]` — evades the identifier
// scan by splitting the name across a concatenation. A string literal built
// inside a member-access bracket has no legitimate place in this bundle (a
// minifier never emits one), so its presence is itself the signal. Zero today.
for (const file of jsFiles) {
  const src = readFileSync(file, 'utf8')
  if (/\[\s*["'`][^"'`]*["'`]\s*\+/.test(src))
    fail(`${rel(file)}: computed member access built by string concatenation — possible obfuscated API (invariant 2)`)
}

/* 3 — no external origin fetched by any asset. Namespace URIs (xmlns,
   createElementNS) are identifiers, not requests, so they're allowed.
   The JS bundle is additionally held to zero URLs of any kind, minus an
   explicit allowlist of inert strings we know about — currently one
   ProseMirror error-message docs link. A new URL appearing in the
   bundle means a dependency grew a reference we haven't reviewed. */
const ALLOWED_URL = /^https?:\/\/www\.w3\.org\//
const INERT_JS_URLS = new Set(['https://prosemirror.net/docs/guide/'])
for (const file of jsFiles) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/https?:\/\/[a-zA-Z0-9./_-]+/g)) {
    if (!INERT_JS_URLS.has(m[0]) && !ALLOWED_URL.test(m[0]))
      fail(`${rel(file)}: unreviewed URL in bundle: ${m[0]} (invariant 3)`)
  }
  // A scheme-only ("https://") or protocol-relative ("//host") string literal
  // is the fingerprint of URL construction by concatenation or a scheme-
  // relative resource — the shapes the full-URL scan can't see. The bundle has
  // no legitimate use for either.
  if (/["'`]https?:\/\/["'`]/.test(src))
    fail(`${rel(file)}: bare URL-scheme string literal — URL built by concatenation? (invariant 2/3)`)
  if (/["'`]\/\/[a-z0-9.-]+/i.test(src))
    fail(`${rel(file)}: protocol-relative URL string literal (invariant 2/3)`)
}

// Resource loads referenced by markup/stylesheets. An <a href> is user-
// initiated navigation (nothing is fetched unless clicked) and rel=canonical
// is inert metadata the browser never fetches, so both are exempt; everything
// that the browser fetches automatically is checked, including protocol-
// relative forms, srcset/imagesrcset/ping, and @import inside a .css bundle
// (where Vite leaves external imports untouched — the Google-Fonts hole).
const REL_OR_ABS = '(?:https?:)?\\/\\/[^"\')\\s]+'
const urlRefs = (file, src) => {
  const refs = []
  const collect = (re, group = 1) => {
    for (const m of src.matchAll(re)) refs.push(m[group])
  }
  if (file.endsWith('.html') || file.endsWith('.svg')) {
    collect(new RegExp(`\\b(?:src|srcset|imagesrcset|ping)\\s*=\\s*["'](${REL_OR_ABS})`, 'gi'))
    for (const m of src.matchAll(new RegExp(`<link\\b[^>]*\\bhref\\s*=\\s*["'](${REL_OR_ABS})["'][^>]*>`, 'gi'))) {
      if (!/rel\s*=\s*["']canonical["']/i.test(m[0])) refs.push(m[1])
    }
  }
  if (file.endsWith('.css') || file.endsWith('.html') || file.endsWith('.svg')) {
    collect(new RegExp(`url\\(\\s*["']?(${REL_OR_ABS})`, 'gi'))
    collect(new RegExp(`@import\\s+(?:url\\()?\\s*["'](${REL_OR_ABS})`, 'gi'))
  }
  return refs
}
for (const file of textFiles) {
  const src = readFileSync(file, 'utf8')
  for (const url of urlRefs(file, src)) {
    if (!ALLOWED_URL.test(url)) fail(`${rel(file)}: references external origin ${url} (invariant 3)`)
  }
}

/* 4 — static output only; no function/middleware entry points anywhere. */
for (const dir of ['api', 'functions', 'netlify/functions', 'edge-functions', join('dist', 'api')]) {
  if (existsSync(join(root, dir)) && statSync(join(root, dir)).isDirectory())
    fail(`${dir}/ exists — server-side code (invariant 4)`)
}
for (const f of ['middleware.ts', 'middleware.js', '_worker.js', join('dist', '_worker.js')]) {
  if (existsSync(join(root, f))) fail(`${f} exists — server-side code (invariant 4)`)
}
let vercelJson
try {
  vercelJson = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
} catch (err) {
  console.error(`verify: vercel.json is unreadable or malformed — ${err.message}`)
  process.exit(1)
}
if (vercelJson.functions || vercelJson.crons)
  fail('vercel.json declares functions/crons — server-side code (invariant 4)')

/* 5 — the CSP, in all three places it lives. Parsed into directive -> sources
   and compared for exact equality against the expected policy: every source
   must be exactly 'self' or 'none' (plus frame-ancestors 'none' in the header
   variants). This is what makes widening impossible however it's spelled —
   `img-src 'self' https:`, `connect-src 'none' *`, a bare host, or an extra
   `worker-src blob:` all fail, where a substring check waved them through. */
const EXPECTED_CSP = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'img-src': ["'self'"],
  'connect-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
}
const parseCsp = (csp) => {
  const map = {}
  for (const part of csp.split(';')) {
    const toks = part.trim().split(/\s+/).filter(Boolean)
    if (toks.length) map[toks[0].toLowerCase()] = toks.slice(1)
  }
  return map
}
const checkCsp = (where, csp, { frameAncestors = false } = {}) => {
  if (!csp) return fail(`${where}: no Content-Security-Policy found (invariant 5)`)
  const expected = { ...EXPECTED_CSP }
  if (frameAncestors) expected['frame-ancestors'] = ["'none'"]
  const got = parseCsp(csp)
  for (const name of Object.keys(expected)) {
    if (!(name in got)) fail(`${where}: CSP missing "${name} ${expected[name].join(' ')}" (invariant 5)`)
  }
  for (const name of Object.keys(got)) {
    if (!(name in expected)) {
      fail(`${where}: CSP has unexpected directive "${name} ${got[name].join(' ')}" — only 'self'/'none' policies are allowed (invariant 3/5)`)
      continue
    }
    const a = [...got[name]].sort().join(' ')
    const b = [...expected[name]].sort().join(' ')
    if (a !== b)
      fail(`${where}: CSP directive "${name}" is "${got[name].join(' ')}", expected "${expected[name].join(' ')}" — a widened directive re-opens egress (invariant 2/3/5)`)
  }
}

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const decodeEntities = (s) =>
  s?.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&')

// Collect every CSP the document/host files declare, not just the first — a
// second, weaker policy under another route would otherwise never be seen.
const metaCspTags = [...html.matchAll(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi)]
if (metaCspTags.length !== 1) fail(`dist/index.html: expected exactly one CSP <meta>, found ${metaCspTags.length} (invariant 5)`)
const metaCsp = decodeEntities(metaCspTags[0]?.[0].match(/content=["']([^"']+)["']/i)?.[1])
checkCsp('dist/index.html <meta>', metaCsp)

const headersPath = join(dist, '_headers')
const headersText = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : null
const headerCspLines = headersText ? [...headersText.matchAll(/^\s*Content-Security-Policy:\s*(.+)$/gim)] : []
let headersCsp = null
if (!headersText) {
  fail('dist/_headers missing — Cloudflare would serve without security headers')
} else if (headerCspLines.length !== 1) {
  fail(`dist/_headers: expected exactly one CSP, found ${headerCspLines.length} (invariant 5)`)
} else {
  headersCsp = headerCspLines[0][1].trim()
  checkCsp('dist/_headers', headersCsp, { frameAncestors: true })
}

const vercelCspEntries = (vercelJson.headers ?? [])
  .flatMap((h) => h.headers ?? [])
  .filter((h) => h.key === 'Content-Security-Policy')
if (vercelCspEntries.length !== 1) fail(`vercel.json: expected exactly one CSP, found ${vercelCspEntries.length} (invariant 5)`)
const vercelCsp = vercelCspEntries[0]?.value
checkCsp('vercel.json', vercelCsp, { frameAncestors: true })

/* 5b — the two host configs and the <meta> must serve the same policy. Even
   with each independently pinned above, byte parity catches token reordering
   or whitespace drift between the files. */
if (headersCsp && vercelCsp && headersCsp.trim() !== vercelCsp.trim())
  fail('CSP differs between dist/_headers and vercel.json — the two hosts would serve different policies')
if (metaCsp && vercelCsp && metaCsp.trim() !== vercelCsp.replace(/;\s*frame-ancestors 'none'/, '').trim())
  fail('CSP <meta> and vercel.json disagree beyond the expected frame-ancestors difference')

/* 5c — the other security headers must exist, hold their exact values, and
   match between the two host files symmetrically. Deleting a header from one
   file (or both) now fails; before, only drift where a key existed in
   vercel.json was noticed, so a header removed from either shipped silently. */
const REQUIRED_HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'x-permitted-cross-domain-policies': 'none',
  'permissions-policy':
    'accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), bluetooth=(), camera=(), clipboard-read=(), display-capture=(), encrypted-media=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), nfc=(), otp-credentials=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), speaker-selection=(), sync-xhr=(), usb=(), xr-spatial-tracking=(), interest-cohort=(), browsing-topics=()',
}
const parseCloudflareGlobal = (text) => {
  const map = {}
  let inGlobal = false
  for (const line of text.split('\n')) {
    if (/^\/\*\s*$/.test(line)) { inGlobal = true; continue }
    if (/^\S/.test(line)) inGlobal = false
    const m = inGlobal && line.match(/^\s+([A-Za-z-]+):\s*(.+?)\s*$/)
    if (m) map[m[1].toLowerCase()] = m[2]
  }
  return map
}
if (headersText) {
  const cf = parseCloudflareGlobal(headersText)
  const vercelGlobalBlock = (vercelJson.headers ?? []).find((h) => h.source === '/(.*)')
  if (!vercelGlobalBlock) {
    fail('vercel.json: global header block "/(.*)" not found — cross-file header check disabled (invariant 5)')
  } else {
    const vercelGlobal = (vercelGlobalBlock.headers ?? []).reduce(
      (m, h) => ((m[h.key.toLowerCase()] = h.value), m), {},
    )
    // Required headers: present with the exact expected value in BOTH files.
    for (const [key, value] of Object.entries(REQUIRED_HEADERS)) {
      for (const [where, map] of [['dist/_headers', cf], ['vercel.json', vercelGlobal]]) {
        if (map[key] === undefined) fail(`${where}: required header "${key}" missing (invariant 5)`)
        else if (map[key] !== value) fail(`${where}: header "${key}" is "${map[key]}", expected "${value}" (invariant 5)`)
      }
    }
    // Symmetric: every key in either file must exist in both with equal value.
    for (const key of new Set([...Object.keys(cf), ...Object.keys(vercelGlobal)])) {
      if (cf[key] === undefined) fail(`dist/_headers missing "${key}" that vercel.json sets (sync)`)
      else if (vercelGlobal[key] === undefined) fail(`vercel.json missing "${key}" that dist/_headers sets (sync)`)
      else if (cf[key] !== vercelGlobal[key]) fail(`header "${key}" differs between _headers and vercel.json (sync)`)
    }
    // A server-set cookie is a persistence channel headers must never open.
    for (const [where, map] of [['dist/_headers', cf], ['vercel.json', vercelGlobal]]) {
      if ('set-cookie' in map) fail(`${where}: Set-Cookie in the global block — persistence (invariant 1)`)
    }
  }
}

/* 6 — opt-outs that fence off exfiltration paths CSP can't reach (extensions,
   Chrome translate, browser spell-check). Presences, not absences, so they can
   silently regress — and their *values* matter as much as their names: a
   `data-gramm` flipped to "true" re-enables the upload the attribute exists to
   stop, so the value is asserted too. */
if (!html.includes('name="google" content="notranslate"') || !/<html[^>]*translate="no"/.test(html))
  fail('dist/index.html: page-level translate opt-out missing')
if (!/<meta[^>]*name=["']referrer["'][^>]*content=["']no-referrer["']/i.test(html))
  fail('dist/index.html: no-referrer meta missing (keeps the outbound source link from leaking the origin)')
for (const attr of ['data-gramm', 'data-gramm_editor', 'data-enable-grammarly', 'data-lt-active']) {
  if (!new RegExp(`["']${attr}["']\\s*:\\s*["']false["']`).test(bundleJs))
    fail(`bundle: editor opt-out ${attr} not set to "false" (invariant 6)`)
}
if (!/spellcheck\s*:\s*["']false["']/.test(bundleJs))
  fail('bundle: spellcheck not set to "false" (invariant 6)')
if (headersText && !headersText.includes('Permissions-Policy:'))
  fail('dist/_headers: Permissions-Policy header missing')
if (!html.includes('href="https://github.com/hyperstream-pro/typepaper"'))
  fail('dist/index.html: source link to the public repo missing')

/* 7 — structural hooks main.ts asserts on with `!`. If markup drops one, the
   module throws at load and everything after it silently never wires up
   (order-dependent partial init). All seven non-null querySelectors are
   listed; theme-color and controls were the two that used to be missing. */
for (const hook of [
  'data-action="theme"',
  'data-action="copy"',
  'class="editor"',
  'id="status"',
  'class="feedback"',
  'class="controls"',
  'name="theme-color"',
]) {
  if (!html.includes(hook)) fail(`dist/index.html: structural hook ${hook} missing (main.ts asserts on it)`)
}

/* 8 — the 404 page. Its presence is what switches Cloudflare Pages out of
   SPA-fallback mode: without it, a request for a missing asset returns
   index.html with status 200 and the assets' year-long immutable header,
   which the edge cache then pins under the asset URL — HTML served as
   CSS/JS until someone purges (the 2026-07-27 launch-day outage). A file's
   absence is invisible in review, so it is asserted here. The page must
   also stay static (no script) and keep its external stylesheet link — the
   CSP forbids inline styles, so without the link it ships unstyled. */
const notFound = join(dist, '404.html')
if (!existsSync(notFound)) {
  fail('dist/404.html missing — Pages reverts to serving index.html for unknown paths, re-opening the asset cache-poisoning window')
} else {
  const nf = readFileSync(notFound, 'utf8')
  if (!nf.includes('href="/404.css"'))
    fail('dist/404.html: stylesheet link missing (CSP forbids inline styles; the page would ship unstyled)')
  if (/<script\b/i.test(nf)) fail('dist/404.html: contains a script — the 404 page is deliberately static')
  if (!existsSync(join(dist, '404.css'))) fail('dist/404.css missing — the 404 page ships unstyled')
}

if (failures.length) {
  console.error(`verify: ${failures.length} violation(s):\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`verify: all invariants hold across ${files.length} files in dist/.`)
