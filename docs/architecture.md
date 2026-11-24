# Frontend architecture

> **Public repository safety:** This repository and its full Git history are public. Be 100% careful not to leak secrets, API keys or tokens, credentials, passwords, private keys, session material, personal or customer data, or sensitive operational details in source, documentation, examples, fixtures, logs, screenshots, generated artifacts, commits, pull requests, or deployments. Use obviously fake placeholders in committed examples, keep real values only in approved ignored local secret stores, and inspect staged and generated output before publishing. If unsure, treat the value as secret and stop.

## One manifest, two repositories

Each app manifest defines its slug, runtime application, Pages project/origin, local HTTPS origin/port, and runtime contract source. The frontend scaffold and runtime onboarding scripts parse the same strict shape. Runtime `config/frontends.json` remains authoritative for browser origins and application mapping.

Applications use a separate runtime database by default. That gives each product an exact PostgreSQL database, Hasura source, migrations, roles, monitoring, and backup inventory. Sharing a database requires an explicit product/data-boundary decision.

`founder-village-app` owns Members and Food Deliveries in the same application namespace. `founder-village-team` keeps the internal workspace in its own namespace.

The primary app lists Team in `featureFrontends`. Its origin can call the scoped routes for both applications. Contract sync includes the primary app's schemas and bundles the canonical Team schemas into `features/founder-village-team/`.

## Runtime-owned contracts

The runtime organizes browser-safe Zod schemas and inferred TypeScript types under `packages/frontend-contracts/<slug>/`. Its synchronizer copies only real `.ts` files to the registered frontend target, refuses symlinks and path escapes, removes stale owned files, and writes `contract-source.json` with the source, inventory, and SHA-256 digest.

The frontend checks the digest without trusting source imports. A runtime push runs a cross-repository workflow that opens a generated-contract pull request when its token is configured. Local development can run the runtime's `frontend-contracts:watch` command for near-immediate copies.

Contract synchronization rejects symlinks in both canonical sources and generated target ancestors, so automation cannot be redirected outside either repository.

## Browser boundary

The shared platform loads public configuration from a same-origin static script. OIDC uses authorization code with PKCE; transient verifier/state values live in session storage, and bearer tokens are not persisted in local storage. API calls use the fixed configured runtime origin, omit cookies, set application and tenant headers, enforce timeouts, reject redirects, and parse generated schemas.

The runtime independently verifies bearer identity, membership, tenant scope, and database row-level security. Exact-origin CORS is defense in depth, not authentication.

## Static Pages boundary

Every app builds to `dist/`. Shared release inspection rejects Worker entrypoints, Pages Functions, symlinks, oversized files, missing app identity, and placeholder production runtime configuration. Release generation narrows `connect-src` to the exact API and token endpoint origins, `_headers` supplies the remaining static security headers, and `_redirects` supplies SPA navigation fallback.
