import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Turns the document into Markdown-flavoured plain text.
 *
 * Written by hand rather than pulled from a package: it is ~120 lines,
 * it adds nothing to the dependency tree, and the output is exactly
 * what we want rather than what a general-purpose serializer assumes.
 *
 * Blocks carry an `indent` string (not a depth count) so that content
 * nested under a list marker lines up with the marker's own width — a
 * `1. ` item indents its children three spaces, a `- ` item two. That
 * one change is what keeps a nested list, or a code block inside a list
 * item, from breaking out of the list on paste.
 */
export function toPlainText(doc: PMNode): string {
  const blocks: string[] = []
  doc.forEach((child) => blocks.push(...serializeBlock(child, '')))
  // Join with exactly one blank line between blocks. There is deliberately no
  // global `\n{3,}` collapse: it would reach into code-block bodies, whose
  // blank lines are the user's verbatim text. Empty blocks are dropped at the
  // source instead, so no block contributes a stray newline to a seam.
  return blocks.join('\n\n').trim()
}

function serializeBlock(node: PMNode, indent: string): string[] {
  switch (node.type.name) {
    case 'heading': {
      const level = Number(node.attrs.level) || 1
      const text = inline(node)
      return text ? [prefix(`${'#'.repeat(level)} ${text}`, indent)] : []
    }

    case 'paragraph': {
      const text = inline(node)
      return text.trim() ? [prefix(text, indent)] : []
    }

    case 'bulletList': {
      const lines: string[] = []
      node.forEach((item) => lines.push(...serializeListItem(item, indent, '- ')))
      return lines.length ? [lines.join('\n')] : []
    }

    case 'orderedList': {
      const start = Number(node.attrs.start) || 1
      const lines: string[] = []
      node.forEach((item, _offset, index) =>
        lines.push(...serializeListItem(item, indent, `${start + index}. `)),
      )
      return lines.length ? [lines.join('\n')] : []
    }

    case 'blockquote': {
      const inner: string[] = []
      node.forEach((child) => inner.push(...serializeBlock(child, '')))
      if (!inner.length) return []
      const quoted = inner
        .join('\n\n')
        .split('\n')
        .map((line) => `${indent}> ${line}`.trimEnd())
        .join('\n')
      return [quoted]
    }

    case 'codeBlock': {
      const rawLang = node.attrs.language
      // The language attribute is invisible in the editor but emitted into the
      // fence line, and StarterKit's VS Code paste handler will populate it
      // from an attacker-controlled clipboard field. Allow only a short,
      // language-name-shaped token; anything with a newline, space or backtick
      // is dropped, so nothing the user never saw can ride along in the copy.
      const lang = typeof rawLang === 'string' && /^[A-Za-z0-9+#._-]{1,32}$/.test(rawLang) ? rawLang : ''
      // Trailing newlines are an artefact of hitting Enter before leaving the
      // block; they'd push the closing fence adrift.
      const body = node.textContent.replace(/\s+$/, '')
      // The fence must be longer than the longest backtick run inside the
      // body, or an embedded ``` closes the block early (CommonMark). A
      // code block about Markdown is the obvious way to hit this.
      const longestRun = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length))
      const fence = '`'.repeat(Math.max(3, longestRun + 1))
      // Indent every non-empty body line to the block's column. Without this a
      // code block inside a list item emits at column 0, ends the list item
      // early, and its closing fence opens a new unterminated block that eats
      // the rest of the document. Blank lines stay bare (no trailing spaces).
      const bodyLines = body
        .split('\n')
        .map((line) => (line ? indent + line : line))
        .join('\n')
      return [`${indent}${fence}${lang}\n${bodyLines}\n${indent}${fence}`]
    }

    case 'horizontalRule':
      return [`${indent}---`]

    default: {
      // Unknown block: emit its text rather than losing it.
      const text = node.isTextblock ? inline(node) : node.textContent
      return text.trim() ? [prefix(text, indent)] : []
    }
  }
}

function serializeListItem(item: PMNode, indent: string, marker: string): string[] {
  // Everything under the marker is indented by the marker's own width, so a
  // sublist or code block lines up with the item's text column. A fixed two
  // spaces was correct for `- ` but too narrow for `1. ` (three) or `10. `
  // (four), which silently de-nested ordered sublists on paste.
  const childIndent = indent + ' '.repeat(marker.length)
  const parts: string[] = []
  // Does the item lead with its own paragraph text, or is its first content a
  // nested block (an empty bullet holding only a sublist)? The marker must sit
  // on the item's own line — gluing it onto an already-indented nested line
  // produces "-   - child" garbage.
  let leadsWithOwnText = false

  item.forEach((child) => {
    if (child.type.name === 'paragraph') {
      const text = inline(child)
      if (!text.trim()) return
      if (parts.length === 0) {
        // Marker sits on the first line; a hard break inside this paragraph
        // continues at the content column, not column 0.
        leadsWithOwnText = true
        parts.push(`${indent}${marker}${text.split('\n').join('\n' + childIndent)}`)
      } else {
        parts.push(prefix(text, childIndent))
      }
    } else {
      parts.push(...serializeBlock(child, childIndent))
    }
  })

  if (!parts.length) return []
  if (leadsWithOwnText) return parts // marker already applied to the first part
  // Empty item carrying only nested content: bare marker on its own line.
  return [`${indent}${marker}`.trimEnd(), ...parts]
}

/**
 * Prefix the first line with `indent` and every continuation line (produced by
 * a hard break) with the same indent, so multi-line inline text stays inside
 * its block instead of the second line falling out to column 0.
 */
function prefix(text: string, indent: string): string {
  return indent + text.split('\n').join('\n' + indent)
}

/**
 * Wrap an inline code span, widening the delimiter past any backtick run inside
 * it (CommonMark) and padding with a space when the content itself begins or
 * ends with a backtick — otherwise the span truncates and leaks a stray `.
 */
function codeSpan(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(longestRun + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

const WRAP: Record<string, string> = { bold: '**', italic: '*', strike: '~~' }

function inline(node: PMNode): string {
  let out = ''

  node.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      // A backslash + newline is a real Markdown hard break. A bare newline is
      // a *soft* break (a space) and, worse, drops the next line to column 0
      // where a leading `#`/`-`/`---` gets reinterpreted as a block. The
      // backslash form also survives trimEnd, unlike the two-trailing-spaces
      // spelling.
      out += '\\\n'
      return
    }

    if (!child.isText) {
      out += child.textContent
      return
    }

    let text = child.text ?? ''
    if (!text) return

    // Wrap from the inside out. Code wins — you don't want ** inside a backtick
    // span, since Markdown won't render it there anyway.
    if (child.marks.some((m) => m.type.name === 'code')) {
      return void (out += codeSpan(text))
    }

    for (const mark of child.marks) {
      const delim = WRAP[mark.type.name]
      if (!delim) continue
      // CommonMark's flanking rules reject a delimiter adjacent to whitespace,
      // so `**hello **` renders as literal asterisks. Split the surrounding
      // whitespace out and wrap only the inner text; skip empty/all-space runs.
      const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
      if (!m || !m[2]) continue
      text = `${m[1]}${delim}${m[2]}${delim}${m[3]}`
    }

    out += text
  })

  return out
}
