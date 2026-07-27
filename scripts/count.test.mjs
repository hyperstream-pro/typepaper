// Word/character count tests. Run with: node --test scripts/count.test.mjs
//
// The count in the corner is the one number the user drafts against, so it
// gets the same treatment as the serializer: real ProseMirror documents from
// the editor's own schema, asserted exactly. Same esbuild transpile trick as
// serialize.test.mjs — Node 20 can't import .ts directly.

import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

const outfile = join(tmpdir(), `typepaper-count-${process.pid}.mjs`)
await build({
  entryPoints: [fileURLToPath(new URL('../src/count.ts', import.meta.url))],
  outfile,
  format: 'esm',
  platform: 'node',
  bundle: false,
})
const { countDoc, formatCount } = await import(pathToFileURL(outfile))

const schema = getSchema([
  StarterKit.configure({ link: false, trailingNode: false, heading: { levels: [1, 2, 3] } }),
])

// --- builders (same shapes as serialize.test.mjs) --------------------------
const mk = (names) => names.map((n) => schema.marks[n].create())
const t = (text, ...marks) => schema.text(text, mk(marks))
const n = (type, attrs, content) => schema.node(type, attrs, content)
const doc = (...blocks) => schema.node('doc', null, blocks)
const p = (...content) => schema.node('paragraph', null, content.length ? content : undefined)
const code = (text) => schema.node('codeBlock', { language: null }, text ? schema.text(text) : undefined)
const count = (...blocks) => countDoc(doc(...blocks))

// --- counting ---------------------------------------------------------------
test('empty doc counts nothing', () => {
  assert.deepEqual(count(p()), { words: 0, characters: 0 })
})

test('plain sentence: words split on whitespace, characters include spaces', () => {
  assert.deepEqual(count(p(t('hello world'))), { words: 2, characters: 11 })
})

test('runs of whitespace count once between words', () => {
  assert.deepEqual(count(p(t('a   b'))), { words: 2, characters: 5 })
})

test('spaces alone are characters but not words', () => {
  assert.deepEqual(count(p(t('   '))), { words: 0, characters: 3 })
})

test('block boundary separates words without adding characters', () => {
  assert.deepEqual(count(p(t('hello')), p(t('world'))), { words: 2, characters: 10 })
})

test('hard break separates words without adding characters', () => {
  assert.deepEqual(count(p(t('a'), n('hardBreak'), t('b'))), { words: 2, characters: 2 })
})

test('adjacent text nodes with different marks stay one word', () => {
  assert.deepEqual(count(p(t('wo', 'bold'), t('rd'))), { words: 1, characters: 4 })
})

test('a lone horizontal rule counts nothing', () => {
  assert.deepEqual(count(n('horizontalRule')), { words: 0, characters: 0 })
})

test('newlines the user typed inside a code block are characters', () => {
  assert.deepEqual(count(code('a\nb')), { words: 2, characters: 3 })
})

test('an astral-plane character counts once, not by UTF-16 units', () => {
  assert.deepEqual(count(p(t('🙂'))), { words: 1, characters: 1 })
})

// --- formatting -------------------------------------------------------------
test('plural formatting with the ground line’s middot', () => {
  assert.equal(formatCount(412, 2304), '412 words · 2,304 characters')
})

test('singular forms', () => {
  assert.equal(formatCount(1, 1), '1 word · 1 character')
})

test('zero is plural', () => {
  assert.equal(formatCount(0, 0), '0 words · 0 characters')
})
