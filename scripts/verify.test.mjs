// Mutation tests for the invariant enforcer. Run: node --test scripts/verify.test.mjs
//
// Each test copies the built site to a scratch tree, applies one mutation that
// a real regression (or attacker-influenced dependency) would introduce, and
// asserts `verify.mjs` now EXITS NON-ZERO. These are exactly the mutations the
// launch audit proved the old substring-based checker waved through. The
// baseline (unmutated) copy must still pass, or the checker is broken the other
// way. Requires `npm run build` to have produced dist/ first.

import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
if (!existsSync(join(repo, 'dist', 'index.html'))) {
  throw new Error('run `npm run build` before the verify self-test (dist/ is missing)')
}

// Fresh scratch copy of everything verify.mjs reads; it derives its own root
// from its location, so running the copied script scopes it to the scratch tree.
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'typepaper-verify-'))
  cpSync(join(repo, 'dist'), join(dir, 'dist'), { recursive: true })
  cpSync(join(repo, 'vercel.json'), join(dir, 'vercel.json'))
  cpSync(join(repo, 'scripts', 'verify.mjs'), join(dir, 'scripts', 'verify.mjs'), { recursive: true })
  return dir
}
function runVerify(dir) {
  return spawnSync('node', [join(dir, 'scripts', 'verify.mjs')], { encoding: 'utf8' })
}
function edit(file, from, to) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(from), `fixture out of date: "${from}" not found in ${file}`)
  writeFileSync(file, src.replaceAll(from, to))
}
// verify.mjs greps file contents, so an injected egress call need only be
// present in the text — append it rather than splicing at a syntactic anchor
// that a minified bundle may not contain.
function append(file, text) {
  writeFileSync(file, readFileSync(file, 'utf8') + text)
}
// Widen/alter the CSP in all three places consistently, the way the audit's
// exploit did — so a failure here proves the structural check catches it, not
// merely the cross-file parity check.
function editCspEverywhere(dir, from, to) {
  edit(join(dir, 'dist', '_headers'), from, to)
  edit(join(dir, 'vercel.json'), from, to)
  edit(join(dir, 'dist', 'index.html'), from.replaceAll("'", '&#39;'), to.replaceAll("'", '&#39;'))
}

const H = (dir) => join(dir, 'dist', '_headers')
const V = (dir) => join(dir, 'vercel.json')
const HTML = (dir) => join(dir, 'dist', 'index.html')
const jsPath = (dir) => {
  const assets = join(dir, 'dist', 'assets')
  return join(assets, readdirSync(assets).find((f) => f.endsWith('.js')))
}

test('baseline: the unmutated build passes', () => {
  const dir = scratch()
  try {
    const r = runVerify(dir)
    assert.equal(r.status, 0, `expected pass, got:\n${r.stderr}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

const mutations = [
  ['widened img-src with a scheme source (all three files)', (dir) =>
    editCspEverywhere(dir, "img-src 'self'", "img-src 'self' https:")],
  ['widened connect-src — the load-bearing directive (all three)', (dir) =>
    editCspEverywhere(dir, "connect-src 'none'", "connect-src 'none' https:")],
  ['wildcard appended to img-src (all three)', (dir) =>
    editCspEverywhere(dir, "img-src 'self'", "img-src 'self' *")],
  ['bare host added to script-src (all three)', (dir) =>
    editCspEverywhere(dir, "script-src 'self'", "script-src 'self' cdn.example.com")],
  ['extra worker-src directive appended (all three)', (dir) =>
    editCspEverywhere(dir, "form-action 'none'", "form-action 'none'; worker-src blob:")],
  ['HSTS deleted from vercel.json only', (dir) =>
    edit(V(dir), '        {\n          "key": "Strict-Transport-Security",\n          "value": "max-age=63072000; includeSubDomains; preload"\n        },\n', '')],
  ['HSTS deleted from _headers only', (dir) =>
    edit(H(dir), '\n  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload', '')],
  ['Permissions-Policy weakened to camera=* in both files', (dir) => {
    edit(H(dir), 'camera=()', 'camera=*'); edit(V(dir), 'camera=()', 'camera=*')
  }],
  ['Set-Cookie added to the _headers global block', (dir) =>
    edit(H(dir), 'X-Content-Type-Options: nosniff', 'X-Content-Type-Options: nosniff\n  Set-Cookie: sid=abc; Max-Age=31536000')],
  ['a second, weaker CSP under another _headers route', (dir) =>
    edit(H(dir), '/assets/*', "/leak/*\n  Content-Security-Policy: default-src *\n\n/assets/*")],
  ['aliased fetch appended to the bundle', (dir) =>
    append(jsPath(dir), '\nconst _f=globalThis.fetch;_f("/x");')],
  ['concatenation-obfuscated API access in the bundle', (dir) =>
    append(jsPath(dir), '\nglobalThis["fet"+"ch"]("/x");')],
  ['bare location assignment (navigation exfil) in the bundle', (dir) =>
    append(jsPath(dir), '\nself.location="/leak";')],
  ['external @import prepended to the CSS bundle', (dir) => {
    const css = readdirSync(join(dir, 'dist', 'assets')).find((f) => f.endsWith('.css'))
    edit(join(dir, 'dist', 'assets', css), ':root', '@import "https://fonts.googleapis.com/css2?family=X";\n:root')
  }],
  ['grammar opt-out flipped to true', (dir) =>
    edit(jsPath(dir), '"data-gramm":"false"', '"data-gramm":"true"')],
  ['spellcheck flipped to true', (dir) =>
    edit(jsPath(dir), 'spellcheck:"false"', 'spellcheck:"true"')],
  ['theme-color meta (a main.ts assertion hook) removed', (dir) =>
    edit(HTML(dir), 'name="theme-color"', 'name="theme-colour"')],
  ['no-referrer meta removed', (dir) =>
    edit(HTML(dir), 'name="referrer"', 'name="referer"')],
]

for (const [name, mutate] of mutations) {
  test(`FAILS on: ${name}`, () => {
    const dir = scratch()
    try {
      mutate(dir)
      const r = runVerify(dir)
      assert.notEqual(r.status, 0, `expected verify to FAIL but it passed. stdout:\n${r.stdout}`)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}
