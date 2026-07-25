# Contributing to Typepaper

Typepaper is a single-page writing surface: it holds text while you write and
forgets it when you leave. Two actions — type, and copy. That narrowness is the
product, not a stage it grows out of, so the most useful thing to know before
contributing is what the project deliberately refuses to do.

Thanks for being here. Small, focused changes are the easiest to accept.

## The invariants (read these first)

These are load-bearing. A change that breaks one isn't a smaller Typepaper; it's
a different app. `npm run build` enforces every one of them against the built
bundle and fails if any slips — but knowing them up front saves you a rejected
PR:

1. **Nothing persists.** No `localStorage`, `sessionStorage`, IndexedDB,
   cookies, service worker, or cache. The theme resets on reload on purpose.
2. **Nothing leaves the browser.** No `fetch`, XHR, WebSocket, `sendBeacon`, or
   navigation-based exfiltration. No analytics, telemetry, or error reporting,
   however well-intentioned. The CSP sets `connect-src 'none'`.
3. **No third-party origins.** No CDN, no Google Fonts `<link>`. Self-hosted or
   system fonts only.
4. **No server-side code.** Static files only — that's the cost model, not a
   style choice.
5. **No `unsafe-inline` / `unsafe-eval` in the CSP.**

[`CLAUDE.md`](CLAUDE.md) is the long-form "why" behind each of these and a
catalogue of pitfalls already hit. Read it before touching `serialize.ts`, the
CSP, or the editor config — it will save you rediscovering something the hard
way.

## Setup

```bash
npm ci
npm run dev      # http://localhost:5173
npm run build    # typecheck → build → verify → tests — this is the gate
npm test         # serializer + verify mutation tests, without a full build
```

Node 20+ (the `engines` field pins the floor). No other toolchain, no framework.

## What lands easily, and what needs a conversation first

- **Bug fixes** are welcome as direct PRs — especially anything in the "page"
  row of the threat-model table in the [README](README.md#known-limits). A way
  that text could persist or leave that layer is a real bug.
- **New features need a real argument first, in an issue.** The scope is two
  actions on purpose; "no toolbar, no word count, no autosave, no export" is a
  decision, not an oversight. Open a feature request describing the problem and
  why it can't live outside the app, and let's agree it fits before you build.
- **Invariant-weakening changes won't be merged** — not because the idea is bad,
  but because the guarantee *is* the product. If you think an invariant is
  wrong, open an issue about the invariant itself, rather than a PR that quietly
  relaxes it.

## Tests

The two pieces most likely to break subtly are covered, and a PR that touches
them should extend that coverage:

- **`serialize.ts`** — the ProseMirror-doc → Markdown serializer that decides
  what "copy everything" produces. Add a case to
  [`scripts/serialize.test.mjs`](scripts/serialize.test.mjs) that builds a
  document and asserts the exact output.
- **`verify.mjs`** — the invariant enforcer. If you change what it checks, add a
  mutation to [`scripts/verify.test.mjs`](scripts/verify.test.mjs) proving it
  catches the thing it now guards.

Both suites run inside `npm run build`, so a regression fails the build — and
therefore the deploy.

## Submitting a change

1. Fork, then branch (`fix/…` or `feat/…`).
2. Make the change; add or update tests if you touched the serializer or verify.
3. Run `npm run build`. It must pass clean, including `verify` and the tests.
4. Open a pull request against `main`. The template asks you to confirm the
   build passes and the invariants hold. Describe *what* changed and *why*, and
   match the existing commit style — a clear, present-tense summary line.

Keep each PR to one concern. A dependency bump or a reformat folded into a bug
fix is harder to review and slower to merge.

## Keep the build reproducible

Two builds from the same source produce byte-identical output, and the README
teaches readers to verify it. Don't introduce build-time timestamps, randomness,
or environment-dependent output.

## Reporting a security issue

Please don't open a public issue for a vulnerability — see
[SECURITY.md](SECURITY.md) for private reporting.

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
