# Founder Village Frontends

> **Public repository safety:** This repository and its full Git history are public. Be 100% careful not to leak secrets, API keys or tokens, credentials, passwords, private keys, session material, personal or customer data, or sensitive operational details in source, documentation, examples, fixtures, logs, screenshots, generated artifacts, commits, pull requests, or deployments. Use obviously fake placeholders in committed examples, keep real values only in approved ignored local secret stores, and inspect staged and generated output before publishing. If unsure, treat the value as secret and stop.

Static React applications for the Founder Village runtime. Every app is deployed to its own Cloudflare Pages project at an exact `pages.dev` origin. This repository does not deploy frontend Workers or Pages Functions.

The first vertical slice is [Founder Food Deliveries](apps/founder-food-deliveries/), a responsive receipt-and-expense interface backed by the shared `founders` runtime database. The database is intentionally reusable by future founder frontends; this first app records iFood and 99Food orders and creates one matching expense atomically.

## Repository model

- `apps/<slug>/` owns one frontend and its `founder-village-app.json` manifest.
- `packages/frontend-platform/` owns shared public runtime config, OIDC authorization-code-with-PKCE, and API transport.
- `templates/app/` and `scripts/scaffold-app.ts` provide the repeatable static app scaffold.
- `scripts/pages.ts` is the single Pages plan/provision/deploy/verify implementation for every app.
- `src/generated/contracts/` is copied from `founder-village-runtime/packages/frontend-contracts/<slug>/`; never edit it by hand.

See [architecture](docs/architecture.md) and [Pages release](docs/pages-release.md).

## Local verification

Requires Node 24.22.0.

```sh
npm ci
npm run contracts:workspace
npm run check
npm run test:e2e
```

`npm run check` validates generated snapshot integrity, typechecks all workspaces, runs behavior tests, builds every app, and performs a non-deployable Pages artifact plan. The Playwright suite covers desktop and mobile viewports.

Run the sample app with:

```sh
npm run dev:food-deliveries
```

The checked-in local `runtime-config.js` points to `https://api.fv`. Production release replaces it with explicitly supplied public runtime/OIDC values.

## Add an app

Start from the repository-owned `$create-founder-village-app` skill in the sibling runtime. Copy its example project manifest to an ignored path inside this repository, such as `.state/new-apps/<slug>.json`, then plan both sides:

```sh
npx tsx scripts/scaffold-app.ts --manifest /absolute/path/project.json --plan

cd ../founder-village-runtime
npm run frontend:add -- --manifest /absolute/path/project.json \
  --frontends-root ../founder-village-frontends --plan
```

Apply only after reviewing both plans. The scaffold is identical-rerun safe and refuses to overwrite different files. Runtime onboarding creates the database/Hasura/contract locations and exact browser-origin registration; product-specific schema, routes, UX, and tests still need implementation.

## Pages commands

All apps use the same command surface:

```sh
npm run pages -- plan --app <slug>
npm run pages -- provision --app <slug>
npm run pages -- deploy --app <slug>
npm run pages -- verify --app <slug>
```

Provision and deploy are intentionally separate. No Cloudflare project or live deployment is implied by a successful local build.
