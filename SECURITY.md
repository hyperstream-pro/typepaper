# Security Policy

Typepaper's whole premise is a security claim: nothing you type is stored, and
nothing leaves your browser. Reports against that claim are the most important
ones we get.

## Reporting a vulnerability

**Please report privately. Do not open a public issue for a vulnerability.**

Use GitHub's private reporting: the
**["Report a vulnerability"](https://github.com/hyperstream-pro/typepaper/security/advisories/new)**
button on the repository's **Security** tab opens a private advisory only the
maintainers can see. The same pointer lives, machine-readable, in
[`/.well-known/security.txt`](public/.well-known/security.txt).

Please include:

- what you found and where — a file and line, or a URL and repro;
- the impact, ideally named as the invariant it breaks;
- steps to reproduce, and any proof-of-concept.

We'll acknowledge your report, keep you updated while we investigate, and credit
you when a fix ships — unless you'd prefer to stay anonymous.

## What's in scope

The [threat-model table](README.md#known-limits) in the README is the map. In
short:

- **The page** — this code and its CSP. Every claim we make is scoped to this
  layer and enforced by the build. Text that persists, or reaches the network,
  from within the page **is a bug** — report it privately.
- **The browser, host, and OS** — extensions with page access, crash/session
  restore, the CDN's request logs, the system clipboard and its history
  managers. These sit outside what a web page can control. An edge you find here
  isn't a page-layer vulnerability; it's a contribution to the "Known limits"
  table — open a normal issue or PR and we'll document it.

## Supported versions

This is a single static site with no release train. The deployed site at
typepaper.app and the `main` branch are what we support; fixes land on `main`.
