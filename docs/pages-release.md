# Cloudflare Pages release

> **Public repository safety:** This repository and its full Git history are public. Be 100% careful not to leak secrets, API keys or tokens, credentials, passwords, private keys, session material, personal or customer data, or sensitive operational details in source, documentation, examples, fixtures, logs, screenshots, generated artifacts, commits, pull requests, or deployments. Use obviously fake placeholders in committed examples, keep real values only in approved ignored local secret stores, and inspect staged and generated output before publishing. If unsure, treat the value as secret and stop.

## Prerequisites

Open the Cloudflare dashboard from the Founder Village Google Chrome profile and check the active Cloudflare account before managing Pages projects.

Run `npm run pages -- login` and open Wrangler’s device authorization in the Founder Chrome profile. Select the Founder Cloudflare account and grant Pages Write. The release tool keeps this login in the workstation’s private Founder Wrangler directory, refreshes it through Wrangler, and pins every release to the protected Founder account binding. Install Gitleaks for the production artifact scan. [Wrangler authentication](https://developers.cloudflare.com/workers/wrangler/commands/general/#login)

Unattended releases can supply an account-scoped Pages Write token through `FV_PAGES_API_TOKEN_FILE` or the workstation credential store. Full custom-domain reconciliation also requires Zone Read and DNS Edit for the manifest's active zones. [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)

Production planning and deployment use these public application values.

- `FV_RUNTIME_API_ORIGIN` when the app manifest does not supply it
- `FV_OIDC_AUTHORIZATION_ENDPOINT`
- `FV_OIDC_TOKEN_ENDPOINT`
- `FV_OIDC_CLIENT_ID`
- optional `FV_OIDC_AUDIENCE`

The endpoints use public HTTPS values. The primary app manifest declares `https://api.foundervillage.org`. Supply the signed and deployed runtime commit SHA in `FV_RUNTIME_REVISION` for a primary app deploy or production verification.

Register the exact `/auth/callback` URL and token exchange origin for `https://founder-village-app.pages.dev`, `https://founder-village-apps.pages.dev`, `https://founderhaus.org`, and `https://foundervillage.org` in the public SPA client. For another app, use the Pages origins and aliases in its manifest. Configure the resulting access token for the runtime's API audience. The runtime production workflow validates its matching registry, signed release and OIDC configuration before calling this Pages tooling.

## Lifecycle

Use `npm run pages -- plan --app <slug>` for a local artifact plan. It builds the app with a deliberately non-deployable `.test` runtime origin, validates Pages-only output, and writes an ignored receipt under `.state/pages/`.

Use `npm run pages -- provision --app <slug>` to reconcile the exact Direct Upload projects with `main` as the production branch. The primary app declares `founder-village-app` as its primary project and `founder-village-apps` in `additionalPagesProjects`. Each name has its own Cloudflare-managed `pages.dev` hostname. The command checks ownership and existing web DNS on every managed alias before project creation. [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

Use `npm run pages -- deploy --app <slug>` from a clean Git checkout after the selected runtime revision and OIDC configuration are ready. Deploy checks live runtime revision, readiness and browser preflights. It builds and scans the static output once, uploads the same artifact to each Pages project, and verifies the release on every Pages hostname. It attaches each `customOrigins` entry to the primary project and creates its proxied CNAME if needed. Existing web DNS conflicts halt the change for review. A legacy `customOrigin` is enrolled externally and included in HTTPS verification.

`deploy --pages-only` can publish the static site to the manifest's Pages projects independently of the runtime. It can provision missing Pages projects and reuses matching public sign-in settings from existing releases when no explicit OIDC configuration is supplied. `verify --pages-only` checks that both Pages hostnames serve the same release from the clean checkout.

For a dashboard Direct Upload, run `npm run pages -- bundle --app founder-village-app --cf-profile foundervillage` from a clean checkout. The shared tool reads both exact projects through `cf`, preserves existing public sign-in settings, and produces one scanned ZIP for both projects. Run `verify --pages-only` after uploading it to production. [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## Deploy after a main push

Enable the tracked hooks on each release workstation with `git config --local core.hooksPath .githooks`. The workstation needs Node 24, Gitleaks, the Founder account binding, and a saved Founder Wrangler login or a protected Pages Write token.

A push to `origin/main` starts a background release. The hook waits for the remote to advertise the pushed commit, installs its locked dependencies in a temporary Git worktree, and runs the shared Pages-only upload for `founder-village-app`. Both Pages hostnames must verify before the release records success. The last verified revision and release lock live in the Git common directory, so worktrees share the same release state.

Read the release log or retry the current remote revision on the release workstation.

```sh
tail -f "$(git rev-parse --git-common-dir)/founder-village-pages-autodeploy.log"
node scripts/pages-autodeploy.ts watch "$(git ls-remote --refs origin refs/heads/main | cut -f1)"
```

## Verify production

Use `npm run pages -- verify --app <slug> --production` from the frontend revision you deployed. It verifies the serving revision, deployed public configuration, SPA callback, required headers, and entry script on every origin, plus public runtime readiness. Deploy waits up to three minutes for alias activation. Rerun `verify` after Cloudflare finishes pending DNS or TLS activation.

Run the frontend checks on the Mac with `npm run check:local`. For a release, set the public `FV_*` configuration and serving revision before invoking the scoped uploader from this checkout. The same verified input can wrap the runtime checkout's `npm run frontend:production` command. The Mac builds the static files for Pages Direct Upload. [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

```sh
npm run pages -- deploy --app founder-village-app --pages-only
```

## Proof boundaries

Plan records the local artifact digest. Provision checks project identity and zone ownership. Deploy checks Cloudflare alias status and HTTPS on every origin. Production verification checks the exact frontend and runtime revisions. An end-to-end production result also requires a real signed-in journey against the intended database.
