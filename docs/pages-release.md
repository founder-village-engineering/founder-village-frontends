# Cloudflare Pages release

## Prerequisites

Authenticate Wrangler with an API token scoped to Pages and set `CLOUDFLARE_ACCOUNT_ID`. Production planning/deployment also requires these public, non-secret application values:

- `FV_RUNTIME_API_ORIGIN`
- `FV_OIDC_AUTHORIZATION_ENDPOINT`
- `FV_OIDC_TOKEN_ENDPOINT`
- `FV_OIDC_CLIENT_ID`
- optional `FV_OIDC_AUDIENCE`

The endpoints must be public HTTPS values. `.fv`, `.test`, and example runtime API hosts are rejected for deployment.

At the identity provider, register the exact `https://<pagesProject>.pages.dev/auth/callback` redirect URI for the public SPA client and allow the exact Pages origin at the token endpoint. The resulting access token must target the runtime's configured API audience; a successful provider redirect alone does not prove the backend will accept it.

## Lifecycle

Use `npm run pages -- plan --app <slug>` for a local artifact plan. It builds the app with a deliberately non-deployable `.test` runtime origin, validates Pages-only output, and writes an ignored receipt under `.state/pages/`.

Use `provision` once to create the exact manifest project with `main` as the production branch. Provisioning does not upload the site. Use `deploy` only after public runtime and OIDC configuration exist; it rebuilds, hashes, checks project inventory, uploads the static `dist/` directory, and immediately runs live verification. `verify` can be rerun independently.

The manual `Deploy Pages app` GitHub workflow calls these same commands. Configure a protected `production` environment with:

- secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`;
- variables matching the `FV_*` public configuration above.

## Proof boundaries

A Pages plan proves only a local static artifact. Provision proves project existence. Deploy proves an upload completed. Verify proves the exact `pages.dev` response and static headers. A real signed-in journey against the public runtime and intended database remains separate end-to-end proof.
