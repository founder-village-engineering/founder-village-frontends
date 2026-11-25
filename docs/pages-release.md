# Cloudflare Pages release

> **Public repository safety:** This repository and its full Git history are public. Be 100% careful not to leak secrets, API keys or tokens, credentials, passwords, private keys, session material, personal or customer data, or sensitive operational details in source, documentation, examples, fixtures, logs, screenshots, generated artifacts, commits, pull requests, or deployments. Use obviously fake placeholders in committed examples, keep real values only in approved ignored local secret stores, and inspect staged and generated output before publishing. If unsure, treat the value as secret and stop.

## Prerequisites

Set `CLOUDFLARE_ACCOUNT_ID` and authenticate Wrangler through `CLOUDFLARE_API_TOKEN` scoped to Pages Write. To manage a manifest's `customOrigins`, scope the same token to Zone Read and DNS Edit on the exact zones. These zones must be active in the account that owns the Pages project. Install `gitleaks` for the production artifact scan. [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)

Production planning and deployment use these public application values.

- `FV_RUNTIME_API_ORIGIN` when the app manifest does not supply it
- `FV_OIDC_AUTHORIZATION_ENDPOINT`
- `FV_OIDC_TOKEN_ENDPOINT`
- `FV_OIDC_CLIENT_ID`
- optional `FV_OIDC_AUDIENCE`

The endpoints use public HTTPS values. The primary app manifest declares `https://api.foundervillage.org`. Supply the signed and deployed runtime commit SHA in `FV_RUNTIME_REVISION` for a primary app deploy or production verification.

Register the exact `/auth/callback` URL and token exchange origin for `https://founder-village-app.pages.dev`, `https://founderhaus.org`, and `https://foundervillage.org` in the public SPA client. For another app, use the Pages origin and aliases in its manifest. Configure the resulting access token for the runtime's API audience. The runtime production workflow validates its matching registry, signed release and OIDC configuration before calling this Pages tooling.

## Lifecycle

Use `npm run pages -- plan --app <slug>` for a local artifact plan. It builds the app with a deliberately non-deployable `.test` runtime origin, validates Pages-only output, and writes an ignored receipt under `.state/pages/`.

Use `npm run pages -- provision --app <slug>` to reconcile the exact Direct Upload project with `main` as the production branch. The command checks ownership and existing web DNS on every managed alias before project creation.

Use `npm run pages -- deploy --app <slug>` from a clean Git checkout after the selected runtime revision and OIDC configuration are ready. Deploy checks live runtime revision, readiness and browser preflights, builds and scans isolated static output, and uploads it to Pages. After verifying the Pages host, it attaches each `customOrigins` entry and creates its proxied CNAME if needed. Existing web DNS conflicts halt the change for review. A legacy `customOrigin` is enrolled externally and included in HTTPS verification.

Use `npm run pages -- verify --app <slug> --production` from the frontend revision you deployed. It verifies the serving revision, deployed public configuration, SPA callback, required headers, and entry script on every origin, plus public runtime readiness. Deploy waits up to three minutes for alias activation. Rerun `verify` after Cloudflare finishes pending DNS or TLS activation.

The manual `Deploy Pages app` GitHub workflow calls the same commands. Supply the approved runtime commit as the `runtime_revision` input for primary app deployment and verification. Configure the protected `production` environment with the following settings.

- secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`;
- variables matching the `FV_*` public configuration above.

## Proof boundaries

Plan records the local artifact digest. Provision checks project identity and zone ownership. Deploy checks Cloudflare alias status and HTTPS on every origin. Production verification checks the exact frontend and runtime revisions. An end-to-end production result also requires a real signed-in journey against the intended database.
