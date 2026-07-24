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
const vercelJson = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
if (vercelJson.functions || vercelJson.crons)
  fail('vercel.json declares functions/crons — server-side code (invariant 4)')

/* 5 — the CSP, in all three places it lives. */
const REQUIRED_DIRECTIVES = ["default-src 'none'", "connect-src 'none'", "script-src 'self'"]
const checkCsp = (where, csp) => {
  if (!csp) return fail(`${where}: no Content-Security-Policy found (invariant 5)`)
  if (/unsafe-inline|unsafe-eval/.test(csp)) fail(`${where}: CSP contains an unsafe-* escape hatch (invariant 5)`)
  for (const d of REQUIRED_DIRECTIVES) {
    if (!csp.includes(d)) fail(`${where}: CSP missing "${d}" (invariant 5)`)
  }
}

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const decodeEntities = (s) =>
  s?.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&')
checkCsp(
  'dist/index.html <meta>',
  decodeEntities(html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]),
)

const headersPath = join(dist, '_headers')
if (!existsSync(headersPath)) {
  fail('dist/_headers missing — Cloudflare would serve without security headers')
} else {
  checkCsp('dist/_headers', readFileSync(headersPath, 'utf8').match(/Content-Security-Policy:\s*(.+)/)?.[1])
}
checkCsp(
  'vercel.json',
  vercelJson.headers?.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value,
)

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

if (failures.length) {
  console.error(`verify: ${failures.length} violation(s):\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`verify: all invariants hold across ${files.length} files in dist/.`)
