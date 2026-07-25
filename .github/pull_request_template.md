## What this changes

<!-- One or two sentences. If this is a feature, link the issue where we agreed
     it fits (features start as an issue — see CONTRIBUTING.md). -->

## Type

- [ ] Bug fix
- [ ] Documentation
- [ ] Feature (linked issue: # )

## Checklist

- [ ] `npm run build` passes clean — typecheck, `verify`, and tests all green
- [ ] The invariants still hold: no storage, no network/navigation egress, no
      third-party origin, no server-side code, no `unsafe-*` in the CSP
      (see [CONTRIBUTING.md](../CONTRIBUTING.md) / [CLAUDE.md](../CLAUDE.md))
- [ ] If I changed `serialize.ts`, I added or updated a case in
      `scripts/serialize.test.mjs`
- [ ] If I changed `verify.mjs`, I added a mutation to `scripts/verify.test.mjs`
- [ ] This PR is one focused concern
