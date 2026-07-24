# Fonts go here

Two files, both `.woff2`, Latin subset:

- `newsreader-variable.woff2`
- `newsreader-italic-variable.woff2`

Newsreader is licensed under the SIL Open Font License, so self-hosting is
fine. Get it from Google Fonts (use the download button, not the `<link>`
embed) or from the Production Type / Google Fonts GitHub repository, then
convert or subset to `woff2` if the download gives you `.ttf`.

The `@font-face` rules in `src/styles.css` already point here. Until these
files exist the fallback stack takes over — Iowan Old Style on macOS,
Palatino or Charter on Windows — which looks good, just not identical
across machines. Nothing breaks either way.

## Why not a Google Fonts `<link>`

Because it sends every visitor's IP address to Google on page load, which
would quietly undo the main promise of the app. It would also be blocked by
the Content-Security-Policy in `vercel.json` / `public/_headers`, which sets
`font-src 'self'`. Self-hosted or system fonts only.
