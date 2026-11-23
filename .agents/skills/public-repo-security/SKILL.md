---
name: public-repo-security
description: Prevent and investigate secret exposure in the public Founder Village frontends repository. Use for credential audits and before creating commits or publishing source, history, or frontend build artifacts.
---

# Public repository security

Treat anything shipped in `dist/`, a source map, `runtime-config.js`, or a Vite `VITE_*` or Expo `EXPO_PUBLIC_*` variable as public. Keep provider credentials, OAuth client secrets, session tokens, signing keys, and customer data on the runtime side or in approved ignored stores. Review public endpoints and client identifiers for their intended audience. Use empty values, environment references, or unmistakably synthetic data in tracked examples and tests.

## Before committing or publishing

1. After staging the intended changes, run `npm run security:scan -- --staged`. It scans the complete index blobs for changed files. Keep the pre-commit and commit-msg hooks active using the setup in [README.md](../../../README.md#secret-checks). A finding or an incomplete scan blocks the commit. Repeat the check when the index changes.
2. Review the staged content locally for private data, credential-bearing URLs, hardcoded fallbacks, and browser build inputs. Review the commit message and public PR text. For local commits about to be pushed, run the history scan. For build output, run `npm run security:scan -- --artifact apps/<slug>/dist` on the exact directory to be published and review images, exports, and other opaque files separately.

## Audit and triage

- Run `npm run security:scan` for tracked and non-ignored untracked working files, `npm run security:scan -- --staged` for changes in the index, and `npm run security:scan -- --history` for reachable commit patches and messages. Check branch and tag coverage before describing the scope as remote history. Keep ignored secret stores and local state out of the audit.
- Report only the rule, safe relative location, line, and commit SHA where available. Keep matched values, raw diffs around findings, scanner reports, environment output, and sensitive filenames out of tool output, chat, and public artifacts. Pattern checks need manual review of private data and unusual credential formats.
- Hold publication while a finding is unresolved. Remove an exposed value from proposed changes and rescan. If it may already be public, notify the owner privately and prioritize provider-side revocation or rotation. Check history, CI logs, and release artifacts for prior exposure. Coordinate external changes and history rewrites with the owner.
- For a verified synthetic fixture, scope the exception in `.gitleaks.toml` to the exact value and file. Keep provider rules enabled. Test scanner and hook changes in a disposable repository using synthetic values.
