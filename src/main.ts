import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { toPlainText } from './serialize'
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
    Placeholder.configure({ placeholder: 'Start anywhere.' }),
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
  // Cheap guard first, so this stays O(1) once anything is written.
  return doc.content.size <= 6 && doc.textContent.trim() === ''
}

const syncBlankState = (): void => {
  document.body.classList.toggle('is-blank', isBlank())
}

editor.on('update', syncBlankState)
syncBlankState()

/* ------------------------------------------------------------------
   Theme — session only

   Deliberately not persisted. localStorage would survive the tab, and
   the promise on the empty screen says nothing survives the tab. It
   follows the OS until you override it, then holds until reload.
   ------------------------------------------------------------------ */
type Theme = 'day' | 'night'

const THEME_COLOUR: Record<Theme, string> = {
  day: '#edefee',
  night: '#111415',
}

const media = window.matchMedia('(prefers-color-scheme: dark)')
const themeButton = document.querySelector<HTMLButtonElement>('[data-action="theme"]')!
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!

let override: Theme | null = null

const activeTheme = (): Theme => override ?? (media.matches ? 'night' : 'day')

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

media.addEventListener('change', () => {
  if (override === null) renderTheme()
})

renderTheme()

/* ------------------------------------------------------------------
   Copy
   ------------------------------------------------------------------ */
const copyButton = document.querySelector<HTMLButtonElement>('[data-action="copy"]')!
const controls = document.querySelector<HTMLElement>('.controls')!
const status = document.querySelector<HTMLElement>('#status')!

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

const copyAll = async (): Promise<boolean> => {
  const text = toPlainText(editor.state.doc)
  if (!text) return false

  // Both flavours: plain text lands cleanly in a terminal or textarea,
  // HTML keeps the formatting in Docs, Notion, mail clients.
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
  status.textContent = message

  if (ok) {
    copyButton.dataset.state = 'done'
    copyButton.classList.add('is-done')
    controls.classList.add('is-done')
  }

  resetTimer = window.setTimeout(() => {
    copyButton.dataset.state = 'idle'
    copyButton.classList.remove('is-done')
    controls.classList.remove('is-done')
    status.textContent = ''
  }, 1600)
}

const handleCopy = async (): Promise<void> => {
  if (isBlank()) {
    flash('Nothing to copy yet', false)
    return
  }
  const ok = await copyAll()
  flash(ok ? 'Copied' : "Couldn't copy — try selecting the text instead", ok)
}

copyButton.addEventListener('click', () => void handleCopy())

/* ------------------------------------------------------------------
   Ephemerality guards
   ------------------------------------------------------------------ */

// Ctrl/Cmd + Enter copies everything without leaving the keyboard.
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void handleCopy()
  }
})

// A stray Cmd+W shouldn't cost you an hour. This is a native browser
// prompt — nothing is stored to make it work. Delete this block if you
// want the page to close without argument.
window.addEventListener('beforeunload', (event) => {
  if (isBlank()) return
  event.preventDefault()
  event.returnValue = ''
})

// Click the margins, land in the text.
document.addEventListener('mousedown', (event) => {
  const target = event.target as HTMLElement | null
  if (!target || target.closest('.controls') || target.closest('.editor')) return
  event.preventDefault()
  editor.commands.focus('end')
})
