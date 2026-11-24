# Founder Village

One app for the Founder Village member directory, free and premium membership, food delivery records, and internal workspaces. The app uses the Members design, including the dark theme, Monstera mark, and greenhouse artwork.

## Run locally

Run this from the frontends repository.

```sh
npm run dev:app
```

Open `http://127.0.0.1:43913`. The local Founder Village edge also serves `https://app.fv` after its configuration is applied. The landing page works with the default configuration. For browser sign-in, use the existing Founder Village OIDC provider. Configure the public `VITE_FV_RUNTIME_API_ORIGIN`, `VITE_FV_OIDC_AUTHORIZATION_ENDPOINT`, `VITE_FV_OIDC_TOKEN_ENDPOINT`, `VITE_FV_OIDC_CLIENT_ID`, and optional `VITE_FV_OIDC_AUDIENCE` in an ignored local environment file. The provider must allow the exact browser origin and its `/auth/callback` URL. The API must accept the same verified issuer and audience used by the existing accounts.

## Workspaces

| Area                               | Data owner                | Behavior                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory, profile, and membership | `founder-village-members` | Create a free profile, find members, open WhatsApp when a member shares their number, and use the existing verified checkout for premium.                                                                                 |
| Food deliveries                    | `founders`                | Save an existing iFood or 99Food order and its expense together. View delivery history and the workspace balance.                                                                                                         |
| Engineering and bot chats          | `founder-village-team`    | Create shared engineering items and move them through the work board. Manage authorized bots and resume private conversations. Generating a reply sends recent conversation context to the runtime’s configured provider. |

The app uses the same data as the standalone frontends. The runtime checks access for each feature and workspace. Apply the checked-in membership checkout and team engineering migrations through the runtime migration command before serving the integrated app.

The engineering API stores encrypted item content and records revision, actor, and request ID in its private history. Team routes and provider configuration remain runtime-owned. Feature data is intended for community, delivery, and internal work.

## Verify and release

Run these checks from the frontends repository.

```sh
npm run test:e2e -- tests/e2e/founder-village-app.spec.ts
npm run pages -- plan --app founder-village-app
```

Refresh this app’s generated contracts from the sibling runtime.

```sh
npm run frontend-contracts:sync -- --app founder-village-app --frontends-root ../founder-village-frontends
```

The release target is `https://founder-village-app.pages.dev`. Register `https://founder-village-app.pages.dev/auth/callback` and allow the exact Pages origin at the token endpoint. Use the root Pages tooling and the matching public API and OIDC settings for an authorized release.

The Expo source has its own `com.foundervillage.app` identifier. Native provider registration, signing, and distribution use that identifier. Hosted premium checkout is available in the browser.
