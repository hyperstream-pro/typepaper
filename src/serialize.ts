import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Turns the document into Markdown-flavoured plain text.
 *
 * Written by hand rather than pulled from a package: it is ~80 lines,
 * it adds nothing to the dependency tree, and the output is exactly
 * what we want rather than what a general-purpose serializer assumes.
 */
export function toPlainText(doc: PMNode): string {
  const blocks: string[] = []
  doc.forEach((child) => blocks.push(...serializeBlock(child, 0)))
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

function serializeBlock(node: PMNode, depth: number): string[] {
  const pad = '  '.repeat(depth)

  switch (node.type.name) {
    case 'heading': {
      const level = Number(node.attrs.level) || 1
      const text = inline(node)
      return text ? [`${pad}${'#'.repeat(level)} ${text}`] : []
    }

    case 'paragraph': {
      const text = inline(node)
      return text.trim() ? [pad + text] : []
    }

    case 'bulletList': {
      const lines: string[] = []
      node.forEach((item) => lines.push(...serializeListItem(item, depth, '- ')))
      return lines.length ? [lines.join('\n')] : []
    }

    case 'orderedList': {
      const start = Number(node.attrs.start) || 1
      const lines: string[] = []
      node.forEach((item, _offset, index) =>
        lines.push(...serializeListItem(item, depth, `${start + index}. `)),
      )
      return lines.length ? [lines.join('\n')] : []
    }

    case 'blockquote': {
      const inner: string[] = []
      node.forEach((child) => inner.push(...serializeBlock(child, 0)))
      if (!inner.length) return []
      const quoted = inner
        .join('\n\n')
        .split('\n')
        .map((line) => `${pad}> ${line}`.trimEnd())
        .join('\n')
      return [quoted]
    }

    case 'codeBlock': {
      const lang = typeof node.attrs.language === 'string' ? node.attrs.language : ''
      // Trailing newlines are an artefact of hitting Enter before
      // leaving the block; they'd push the closing fence adrift.
      const body = node.textContent.replace(/\s+$/, '')
      // The fence must be longer than the longest backtick run inside the
      // body, or an embedded ``` closes the block early (CommonMark). A
      // code block about Markdown is the obvious way to hit this.
      const longestRun = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length))
      const fence = '`'.repeat(Math.max(3, longestRun + 1))
      return [`${pad}${fence}${lang}\n${body}\n${pad}${fence}`]
    }

    case 'horizontalRule':
      return [`${pad}---`]

    default: {
      // Unknown block: emit its text rather than losing it.
      const text = node.isTextblock ? inline(node) : node.textContent
      return text.trim() ? [pad + text] : []
    }
  }
}

function serializeListItem(item: PMNode, depth: number, marker: string): string[] {
  const pad = '  '.repeat(depth)
  const parts: string[] = []
  // Does the item lead with its own paragraph text, or is its first
  // content a nested block (an empty bullet holding only a sublist)?
  // The marker must sit on the item's own line — gluing it onto an
  // already-indented nested line produces "-   - child" garbage.
  let leadsWithOwnText = false

  item.forEach((child) => {
    if (child.type.name === 'paragraph') {
      const text = inline(child)
      if (text.trim()) {
        if (parts.length === 0) leadsWithOwnText = true
        parts.push(text)
      }
    } else {
      parts.push(...serializeBlock(child, depth + 1))
    }
  })

  if (!parts.length) return []
  if (leadsWithOwnText) {
    const [first, ...rest] = parts
    return [`${pad}${marker}${first}`, ...rest]
  }
  // Empty item carrying only nested content: bare marker on its own line.
  return [`${pad}${marker}`.trimEnd(), ...parts]
}

function inline(node: PMNode): string {
  let out = ''

  node.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      out += '\n'
      return
    }

    if (!child.isText) {
      out += child.textContent
      return
    }

    let text = child.text ?? ''
    if (!text) return

    // Wrap from the inside out. Code wins — you don't want ** inside a
    // backtick span, since Markdown won't render it there anyway.
    if (child.marks.some((m) => m.type.name === 'code')) {
      return void (out += '`' + text + '`')
    }

    for (const mark of child.marks) {
      switch (mark.type.name) {
        case 'bold':
          text = `**${text}**`
          break
        case 'italic':
          text = `*${text}*`
          break
        case 'strike':
          text = `~~${text}~~`
          break
        default:
          break
      }
    }

    out += text
  })

  return out
}
