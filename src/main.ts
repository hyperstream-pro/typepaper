import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { toPlainText } from './serialize'
import { countDoc, formatCount } from './count'
import './styles.css'

/* ------------------------------------------------------------------
   Editor

   The schema is the allowlist. Anything pasted in that isn't one of
   these node or mark types is discarded by ProseMirror before it ever
   reaches the DOM — no script tags, no iframes, no event handlers, no
   data: URLs. Link is switched off deliberately: it is the one mark in
   the default kit that carries a URL, and a writing pad doesn't need
   it. Fewer types in the schema is a smaller attack surface.
   ------------------------------------------------------------------ */
const editor = new Editor({
  element: document.querySelector<HTMLElement>('.editor')!,
  autofocus: 'end',
  // Tiptap would otherwise inject a <style> tag at runtime, which a
  // strict CSP blocks. Those rules live in styles.css instead.
  injectCSS: false,
  extensions: [
    StarterKit.configure({
      link: false,
      trailingNode: false,
      heading: { levels: [1, 2, 3] },
    }),
    Placeholder.configure({ placeholder: 'Write. Copy. Paste. Gone when you close the tab.' }),
  ],
  editorProps: {
    attributes: {
      // Off by default. Chrome's "enhanced spell check" and Edge's
      // Microsoft Editor both send what you type to a remote server.
      // Basic spellcheck is local, but the browser decides which one
      // is running, not us — so we opt out of the question entirely.
      // Flip to 'true' if you'd rather have squiggles.
      spellcheck: 'false',
      autocapitalize: 'sentences',
      autocorrect: 'off',
      'aria-label': 'Writing area',
      // Extensions run outside the CSP, so grammar checkers that upload
      // text (Grammarly, LanguageTool) can't be blocked — but they
      // honour these vendor opt-outs. Best available fence.
      'data-gramm': 'false',
      'data-gramm_editor': 'false',
      'data-enable-grammarly': 'false',
      'data-lt-active': 'false',
    },
  },
})

/* ------------------------------------------------------------------
   Blank-sheet state
   ------------------------------------------------------------------ */
const isBlank = (): boolean => {
  const { doc } = editor.state
  // "Blank" means "produces nothing copyable" — the same definition the
  // copy button uses, so the two never disagree. The text check is the
  // cheap common path (any typed character makes it non-blank without
  // serializing); only a textless doc pays for toPlainText, which
  // correctly keeps a lone `---` or empty code block non-blank while
  // treating any number of empty paragraphs as blank. A node-count guard
  // can't do this: 4 empty paragraphs and a horizontal rule both fooled
  // the old `content.size <= 6` heuristic in opposite directions.
  if (doc.textContent.trim() !== '') return false
  return toPlainText(doc) === ''
}

const syncBlankState = (): void => {
  // The overlay (promise line + source link) assumes the caret sits on
  // line one. Extra empty paragraphs are still "blank", but the caret
  // would sit on top of the overlay text — so the class also requires a
  // single-block doc. Copy and beforeunload call isBlank() directly and
  // are unaffected.
  document.body.classList.toggle(
    'is-blank',
    isBlank() && editor.state.doc.childCount === 1,
  )
}

editor.on('update', syncBlankState)
syncBlankState()

/* ------------------------------------------------------------------
   The corner count — words and characters, bottom-right.

   Added 2026-07-27 on the first piece of user feedback: drafting to a
   length means guessing without it. Derived state only — recomputed
   from the document on every update, stored nowhere, sent nowhere.
   ------------------------------------------------------------------ */
const countLine = document.querySelector<HTMLElement>('.count')!

const syncCount = (): void => {
  const { words, characters } = countDoc(editor.state.doc)
  countLine.textContent = formatCount(words, characters)
  // Hidden while there is nothing to count: the blank sheet belongs to the
  // promise line, and "0 words" over an empty page is chrome for its own
  // sake. Characters gate the visibility — a run of spaces is countable
  // (0 words, 3 characters), a lone horizontal rule is not.
  countLine.classList.toggle('is-shown', characters > 0)
}

editor.on('update', syncCount)
syncCount()

/* ------------------------------------------------------------------
   Easter egg — type "paper" and the page becomes one.

   Typing the word "paper" folds the sheet into ruled typewriter paper (a
   `paper` class on <body>; all CSS). Type it again to fold it back. It's the
   one place the single-accent restraint is spent on purpose. Nothing is
   stored — the detection only reads text you already typed, and every session
   still starts blank.
   ------------------------------------------------------------------ */
const ground = document.querySelector<HTMLElement>('.ground')
const groundText = ground?.textContent ?? ''
let paperArmed = true
let paperHintTimer: number | undefined

const togglePaper = (): void => {
  const on = document.body.classList.toggle('paper')
  if (!ground) return
  window.clearTimeout(paperHintTimer)
  ground.textContent = on ? 'paper mode · type "paper" again to fold it away' : groundText
  if (on) paperHintTimer = window.setTimeout(() => (ground.textContent = groundText), 5000)
}

editor.on('update', () => {
  // The text just before the caret; "paper" on a word boundary flips the mode.
  // `paperArmed` re-arms once the boundary passes, so holding the word or
  // typing "paperpaper" doesn't thrash the toggle.
  const before = editor.state.doc.textBetween(0, editor.state.selection.head, '\n', '')
  if (/(?:^|[^a-z])paper$/i.test(before)) {
    if (paperArmed) {
      paperArmed = false
      togglePaper()
    }
  } else {
    paperArmed = true
  }
})

/* ------------------------------------------------------------------
   Theme — session only

   Opens light regardless of the OS preference; the toggle switches to
   night for the session. Deliberately not persisted: localStorage
   would survive the tab, and the promise on the empty screen says
   nothing survives the tab.
   ------------------------------------------------------------------ */
type Theme = 'day' | 'night'

const THEME_COLOUR: Record<Theme, string> = {
  day: '#edefee',
  night: '#111415',
}

const themeButton = document.querySelector<HTMLButtonElement>('[data-action="theme"]')!
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!

let override: Theme | null = null

const activeTheme = (): Theme => override ?? 'day'

const renderTheme = (): void => {
  const theme = activeTheme()
  document.documentElement.dataset.theme = theme
  themeMeta.content = THEME_COLOUR[theme]
  // The button shows the glyph for where you'd go, not where you are.
  themeButton.dataset.state = theme
  themeButton.setAttribute(
    'aria-label',
    theme === 'night' ? 'Switch to light' : 'Switch to dark',
  )
}

themeButton.addEventListener('click', () => {
  override = activeTheme() === 'night' ? 'day' : 'night'
  renderTheme()
})

renderTheme()

/* ------------------------------------------------------------------
   Copy
   ------------------------------------------------------------------ */
const copyButton = document.querySelector<HTMLButtonElement>('[data-action="copy"]')!
const controls = document.querySelector<HTMLElement>('.controls')!
const status = document.querySelector<HTMLElement>('#status')!
// Visible sibling of the sr-only #status. Success shows a coloured glyph,
// which sighted users read at a glance; failure has no glyph, so the words
// have to appear on screen or the button looks broken. SR users already
// hear #status, hence aria-hidden here.
const feedback = document.querySelector<HTMLElement>('.feedback')!

let resetTimer: number | undefined

const legacyCopy = (text: string): boolean => {
  const scratch = document.createElement('textarea')
  scratch.value = text
  scratch.setAttribute('readonly', '')
  scratch.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(scratch)
  scratch.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  scratch.remove()
  return ok
}

const copyAll = async (text: string): Promise<boolean> => {
  // Both flavours: plain text lands cleanly in a terminal or textarea,
  // HTML keeps the formatting in Docs, Notion, mail clients.
  //
  // Everything before clipboard.write() must stay synchronous: Safari
  // invalidates the user gesture across an await, and a write() without
  // a live gesture fails silently. Don't insert awaits above it.
  const html = editor.getHTML()

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
      return true
    } catch {
      /* Safari and Firefox can be fussy here — fall through. */
    }
  }

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return legacyCopy(text)
  }
}

const flash = (message: string, ok: boolean): void => {
  window.clearTimeout(resetTimer)
  status.textContent = message // announced to screen readers either way

  if (ok) {
    copyButton.dataset.state = 'done'
    copyButton.classList.add('is-done')
    controls.classList.add('is-done')
  } else {
    // No glyph change on failure — surface the words on screen, monochrome
    // so the lone accent colour stays reserved for the success confirmation.
    feedback.textContent = message
    feedback.classList.add('is-shown')
  }

  resetTimer = window.setTimeout(() => {
    copyButton.dataset.state = 'idle'
    copyButton.classList.remove('is-done')
    controls.classList.remove('is-done')
    feedback.classList.remove('is-shown')
    status.textContent = ''
  }, 1600)
}

const handleCopy = async (): Promise<void> => {
  try {
    // Serialize once, here: it's both the empty-check and the payload, so
    // "nothing to copy" and a real clipboard failure never get the same
    // message.
    const text = toPlainText(editor.state.doc)
    if (!text) {
      flash('Nothing to copy yet', false)
      return
    }
    const ok = await copyAll(text)
    flash(ok ? 'Copied' : "Couldn't copy — try selecting the text instead", ok)
  } catch {
    // A throw in toPlainText/getHTML (a schema or Tiptap bug) must still
    // give feedback rather than vanish as an unhandled rejection — the
    // call sites fire this with `void`.
    flash("Couldn't copy — try selecting the text instead", false)
  }
}

copyButton.addEventListener('click', () => void handleCopy())

// A <button> takes DOM focus on mousedown in Chrome, Firefox and Edge, which
// blurs the editor — and nothing hands focus back, so the next keystrokes
// after a copy or theme click go nowhere (and Space/Enter re-fire the button).
// Preventing the default mousedown keeps the caret and selection in the editor
// while the click still fires on mouseup. (Safari doesn't focus buttons on
// click, so this bug was invisible there.)
controls.addEventListener('mousedown', (event) => event.preventDefault())

/* ------------------------------------------------------------------
   Keep the controls in view when the mobile keyboard is up.

   iOS pins position:fixed to the *layout* viewport, but opening the keyboard
   scrolls the *visual* viewport to keep the caret visible — which leaves the
   top-right controls off-screen while you type. Track the visual viewport's
   vertical offset and hand it to CSS (--vv-offset), which .controls and
   .feedback add to their `top`. --vv-bottom is the same idea from the other
   edge: how far the layout viewport's bottom sits below the visual one, so
   the corner count rides above the keyboard instead of hiding behind it.
   UI-only reposition; no storage, no network.
   ------------------------------------------------------------------ */
const viewport = window.visualViewport
if (viewport) {
  const followViewport = (): void => {
    document.documentElement.style.setProperty('--vv-offset', `${viewport.offsetTop}px`)
    document.documentElement.style.setProperty(
      '--vv-bottom',
      `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
    )
  }
  viewport.addEventListener('resize', followViewport)
  viewport.addEventListener('scroll', followViewport)
  followViewport()
}

/* ------------------------------------------------------------------
   Ephemerality guards
   ------------------------------------------------------------------ */

// Ctrl/Cmd + Enter copies everything without leaving the keyboard.
// Capture phase, and the event must be stopped: Tiptap binds Mod-Enter
// too (hard break, exit-code-block), and ProseMirror preventDefaults
// without stopping propagation — so a bubble-phase listener here would
// copy AND let the editor inject a line break on every use.
window.addEventListener(
  'keydown',
  (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void handleCopy()
    }
  },
  { capture: true },
)

// Click the margins, land in the text — but only a genuine left-click on the
// empty sheet. A mousedown on the window scrollbar targets <html> (the page
// scrolls the body here, so any document past one screen has one); left
// unguarded, grabbing that scrollbar would yank the caret to the end of the
// document. Skip non-primary buttons, the scrollbar gutter, the controls, the
// editor, and any link or button so those keep their own behaviour.
document.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return
  const root = document.documentElement
  if (event.clientX >= root.clientWidth || event.clientY >= root.clientHeight) return
  const target = event.target as HTMLElement | null
  if (!target || target.closest('.controls, .editor, a, button')) return
  event.preventDefault()
  editor.commands.focus('end')
})
