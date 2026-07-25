// Verifies the CLAUDE.md invariants against the *built* output in dist/.
// Run after `npm run build`; exits non-zero on any violation.
//
//   1. Nothing persists   — no storage API appears in the bundle
//   2. Nothing leaves     — no network API appears in the bundle
//   3. No third parties   — no external origin is referenced by any asset
//   4. No server-side code — output is static files only, repo has no functions
//   5. Strict CSP         — connect-src 'none', no unsafe-inline/unsafe-eval,
//                           consistent across meta tag, _headers, vercel.json

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import process from 'node:process'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')
const failures = []
const fail = (msg) => failures.push(msg)

if (!existsSync(dist)) {
  console.error('verify: dist/ not found — run `npm run build` first.')
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

// Guard against a vacuous pass: the invariant-1/2 scans look for forbidden
// APIs *in the bundle*, so a broken build that emitted no JS (or no HTML)
// would satisfy them trivially and report success. Require the real
// artifacts to exist before trusting an all-clear.
if (!files.some((p) => extname(p) === '.js')) {
  console.error('verify: dist/ has no JavaScript bundle — build is incomplete, refusing to pass.')
  process.exit(1)
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error('verify: dist/index.html missing — build is incomplete, refusing to pass.')
  process.exit(1)
}

/* 1 + 2 — the bundle must not contain storage or network APIs. */
const FORBIDDEN = [
  ['localStorage', 'persistence (invariant 1)'],
  ['sessionStorage', 'persistence (invariant 1)'],
  ['indexedDB', 'persistence (invariant 1)'],
  ['document.cookie', 'persistence (invariant 1)'],
  ['serviceWorker', 'persistence (invariant 1)'],
  ['caches.open', 'persistence (invariant 1)'],
  ['CacheStorage', 'persistence (invariant 1)'],
  ['fetch(', 'network egress (invariant 2)'],
  ['XMLHttpRequest', 'network egress (invariant 2)'],
  ['WebSocket', 'network egress (invariant 2)'],
  ['sendBeacon', 'network egress (invariant 2)'],
  ['EventSource', 'network egress (invariant 2)'],
  ['RTCPeerConnection', 'network egress (invariant 2)'],
  // CSP cannot block top-level navigation (navigate-to never shipped),
  // so navigation-based exfiltration is caught here instead. window.open
  // is NOT on this list: StarterKit statically bundles the (disabled)
  // Link extension whose dead click-handler contains one — importing
  // extensions individually would allow banning it too (see CLAUDE.md).
  ['location.href', 'navigation egress (invariant 2)'],
  ['location.assign', 'navigation egress (invariant 2)'],
  ['location.replace', 'navigation egress (invariant 2)'],
  ['document.location', 'navigation egress (invariant 2)'],
]

for (const file of textFiles) {
  const src = readFileSync(file, 'utf8')
  for (const [needle, why] of FORBIDDEN) {
    if (src.includes(needle)) fail(`${rel(file)}: contains "${needle}" — ${why}`)
  }
}

/* 3 — no external origin fetched by any asset. Namespace URIs (xmlns,
   createElementNS) are identifiers, not requests, so they're allowed.
   The JS bundle is additionally held to zero URLs of any kind, minus an
   explicit allowlist of inert strings we know about — currently one
   ProseMirror error-message docs link. A new URL appearing in the
   bundle means a dependency grew a reference we haven't reviewed. */
const ALLOWED_URL = /^https?:\/\/www\.w3\.org\//
const INERT_JS_URLS = new Set(['https://prosemirror.net/docs/guide/'])
for (const file of files.filter((p) => extname(p) === '.js')) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/https?:\/\/[a-zA-Z0-9./_-]+/g)) {
    if (!INERT_JS_URLS.has(m[0]) && !ALLOWED_URL.test(m[0]))
      fail(`${rel(file)}: unreviewed URL in bundle: ${m[0]} (invariant 3)`)
  }
  // A scheme-only string literal ("https://") is the fingerprint of URL
  // construction by concatenation — the one shape the full-URL scan above
  // can't see. The bundle has no legitimate use for one.
  if (/["'`]https?:\/\/["'`]/.test(src))
    fail(`${rel(file)}: bare URL-scheme string literal — URL built by concatenation? (invariant 2/3)`)
}
const urlRefs = (file, src) => {
  const refs = []
  if (file.endsWith('.html') || file.endsWith('.svg')) {
    // Resource loads only: src= anywhere, href= on <link>. An <a href>
    // is user-initiated navigation — nothing is fetched unless clicked —
    // and the source link to the public repo is deliberate. rel=canonical
    // is inert metadata the browser never fetches, so it's exempt too.
    for (const m of src.matchAll(/\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) refs.push(m[1])
    for (const m of src.matchAll(/<link\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi)) {
      if (!/rel\s*=\s*["']canonical["']/i.test(m[0])) refs.push(m[1])
    }
  }
  if (file.endsWith('.css') || file.endsWith('.html')) {
    for (const m of src.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)/gi)) refs.push(m[1])
  }
  if (file.endsWith('.html')) {
    for (const m of src.matchAll(/@import\s+["'](https?:\/\/[^"']+)/gi)) refs.push(m[1])
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

/* 5 — the CSP, in all three places it lives. Every directive is checked,
   not just a representative few: widening any one of them (an img-src or
   style-src pointed at a CDN, say — the exact Google-Fonts scenario the
   docs forbid) is the likely way this invariant slips, and it must fail. */
const REQUIRED_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]
const checkCsp = (where, csp, { frameAncestors = false } = {}) => {
  if (!csp) return fail(`${where}: no Content-Security-Policy found (invariant 5)`)
  if (/unsafe-inline|unsafe-eval/.test(csp)) fail(`${where}: CSP contains an unsafe-* escape hatch (invariant 5)`)
  // No directive may name an external host: 'self'/'none' and scheme
  // keywords only. A CDN or font host here is a third-party origin.
  if (/(?:https?:)?\/\/[a-z0-9.-]+/i.test(csp))
    fail(`${where}: CSP references an external host (invariant 3/5)`)
  for (const d of REQUIRED_DIRECTIVES) {
    if (!csp.includes(d)) fail(`${where}: CSP missing "${d}" (invariant 5)`)
  }
  // frame-ancestors is a header-only directive (<meta> can't carry it),
  // so it's required in the real response headers but not the meta tag.
  if (frameAncestors && !csp.includes("frame-ancestors 'none'"))
    fail(`${where}: CSP missing "frame-ancestors 'none'" (invariant 5)`)
}

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const decodeEntities = (s) =>
  s?.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&')
const metaCsp = decodeEntities(
  html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1],
)
checkCsp('dist/index.html <meta>', metaCsp)

const headersPath = join(dist, '_headers')
const headersCsp = existsSync(headersPath)
  ? readFileSync(headersPath, 'utf8').match(/Content-Security-Policy:\s*(.+)/)?.[1]
  : null
if (!existsSync(headersPath)) {
  fail('dist/_headers missing — Cloudflare would serve without security headers')
} else {
  checkCsp('dist/_headers', headersCsp, { frameAncestors: true })
}
const vercelCsp = vercelJson.headers
  ?.flatMap((h) => h.headers)
  .find((h) => h.key === 'Content-Security-Policy')?.value
checkCsp('vercel.json', vercelCsp, { frameAncestors: true })

/* 5b — the two host configs claim to be "kept in sync". Enforce it, so a
   change to one file that isn't mirrored in the other can't ship. The
   <meta> is the header CSP minus the header-only frame-ancestors. */
if (headersCsp && vercelCsp && headersCsp.trim() !== vercelCsp.trim())
  fail('CSP differs between dist/_headers and vercel.json — the two hosts would serve different policies')
if (metaCsp && vercelCsp && metaCsp.trim() !== vercelCsp.replace(/;\s*frame-ancestors 'none'/, '').trim())
  fail('CSP <meta> and vercel.json disagree beyond the expected frame-ancestors difference')

/* 5c — the other security headers must match between the two host files.
   Only _headers was ever cross-checked before; drift in either was silent. */
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
if (headersCsp) {
  const cf = parseCloudflareGlobal(readFileSync(headersPath, 'utf8'))
  const vercelGlobal = (vercelJson.headers?.find((h) => h.source === '/(.*)')?.headers ?? [])
    .reduce((m, h) => ((m[h.key.toLowerCase()] = h.value), m), {})
  for (const key of Object.keys(vercelGlobal)) {
    if (cf[key] === undefined) fail(`_headers missing "${key}" that vercel.json sets (sync)`)
    else if (cf[key] !== vercelGlobal[key]) fail(`header "${key}" differs between _headers and vercel.json (sync)`)
  }
}

/* 6 — opt-outs that fence off exfiltration paths CSP can't reach
   (extensions, Chrome translate). These are presences, not absences,
   so they can silently regress — hence the check. */
if (!html.includes('name="google" content="notranslate"') || !/\<html[^>]*translate="no"/.test(html))
  fail('dist/index.html: page-level translate opt-out missing')
const bundleJs = files.filter((p) => extname(p) === '.js').map((p) => readFileSync(p, 'utf8')).join('')
for (const attr of ['data-gramm', 'data-lt-active']) {
  if (!bundleJs.includes(attr)) fail(`bundle: editor extension opt-out "${attr}" missing`)
}
if (existsSync(headersPath) && !readFileSync(headersPath, 'utf8').includes('Permissions-Policy:'))
  fail('dist/_headers: Permissions-Policy header missing')
if (!html.includes('href="https://github.com/hyperstream-pro/typepaper"'))
  fail('dist/index.html: source link to the public repo missing')

/* 7 — structural hooks main.ts asserts on with `!`. If markup drops one,
   the module throws at load and everything after it silently never wires
   up (order-dependent partial init). Cheap to catch here instead. */
for (const hook of [
  'data-action="theme"',
  'data-action="copy"',
  'class="editor"',
  'id="status"',
  'class="feedback"',
]) {
  if (!html.includes(hook)) fail(`dist/index.html: structural hook ${hook} missing (main.ts asserts on it)`)
}

if (failures.length) {
  console.error(`verify: ${failures.length} violation(s):\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`verify: all invariants hold across ${files.length} files in dist/.`)
