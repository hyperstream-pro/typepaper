import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * The two numbers the corner count shows. Words are whitespace-separated
 * runs; characters are counted by code point (an emoji is one character,
 * not two UTF-16 units) and include spaces, the way "characters with
 * spaces" is conventionally counted.
 */
export function countDoc(doc: PMNode): { words: number; characters: number } {
  // NUL marks the structural boundaries — between blocks, and for text-less
  // leaf nodes (hard breaks, horizontal rules). It can't be typed, so it
  // stays distinguishable from newlines the user really typed inside a code
  // block: a boundary splits a word but is not a character, a typed newline
  // is both whitespace and a character.
  const text = doc.textBetween(0, doc.content.size, '\u0000', '\u0000')
  const words = text.split(/[\s\u0000]+/).filter(Boolean).length
  let characters = 0
  for (const ch of text) if (ch !== '\u0000') characters++
  return { words, characters }
}

export function formatCount(words: number, characters: number): string {
  // Fixed en-US grouping: the page is lang="en", and a locale-dependent
  // string would make the corner text differ between visitors for no reason.
  const num = (n: number): string => n.toLocaleString('en-US')
  return (
    `${num(words)} ${words === 1 ? 'word' : 'words'}` +
    ` · ${num(characters)} ${characters === 1 ? 'character' : 'characters'}`
  )
}
