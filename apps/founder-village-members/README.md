# Founder Village Members

This repository is public. Keep credentials, payment keys, session tokens, private wallet material, real member data, and unredacted provider output in approved private stores. Use synthetic data for checks and inspect built assets before publishing.

## Product contract

- A verified Founder Village OIDC identity can create one free profile. The membership database persists it across devices. Account creation and sign-in use the same provider, with self-registration enabled there.
- Free and paid members both have access to the private directory. Members can hide their entry at any time. Sharing a WhatsApp number requires separate consent. The contact button opens a new chat in WhatsApp.
- Web checkout is a one-time upgrade. Prices come from the runtime. Stripe Checkout handles credit card and Apple Pay, and Solana Pay accepts SOL or native USDC on Solana. Only the runtime can mark an upgrade paid after verified settlement. The native app shows account status and supports account deletion.
- Account deletion removes the directory entry and contact details and clears the app session. The runtime retains payment records without a profile link for reconciliation.

## Acceptance checks

- Two independently authenticated members can create and reload their profiles, find each other, control visibility, and start a WhatsApp chat. Anonymous and unregistered identities are denied private directory access. Toggling consent or deleting a profile removes the corresponding contact access.
- Parallel checkout starts produce one active order. Duplicate callbacks and replays cannot grant extra upgrades. Wrong owner, amount, recipient, mint, reference, network, and unfinalized transactions cannot grant membership. A confirmed refund or dispute revokes the corresponding Stripe upgrade.
- Phone and desktop layouts support profile setup, search, loading, empty, retry, profile editing, checkout status, and account deletion. Public web account deletion uses `/account/delete`.
- Production verification requires the exact Cloudflare Pages origin, a real OIDC sign-up, another signed-in session, Stripe and Solana test payments, an Apple Pay device, and native store review for the configured product.

## Run locally

From the frontends root, install the workspace dependencies and start the web app.

```sh
npm ci
npm run dev:members
```

Open `http://127.0.0.1:43911`. The frontend uses `https://api.fv` by default. Start the sibling runtime with `bin/fv start` and follow its local DNS and trust setup where needed. The standard local runtime uses synthetic identities for integration checks. A live login requires an issuer that the API verifies.

For a configured local dev issuer, put the public `VITE_FV_OIDC_AUTHORIZATION_ENDPOINT`, `VITE_FV_OIDC_TOKEN_ENDPOINT`, `VITE_FV_OIDC_CLIENT_ID`, and optional `VITE_FV_OIDC_AUDIENCE` in the app’s ignored `.env.local`. Set `VITE_FV_RUNTIME_API_ORIGIN` if using a different approved API. Register the exact `http://127.0.0.1:43911/auth/callback` redirect and token endpoint CORS origin. Keep the auth provider’s account choice and signup flow enabled.

Use `npm run test:e2e -- tests/e2e/members.spec.ts` for the desktop and mobile-browser journey. The runtime’s `npm run test:integration` exercises the real member database with synthetic JWTs and provider responses.

## Web release

```sh
npm run pages -- plan --app founder-village-members
```

The shared Pages workflow builds and publishes the exact `https://founder-village-members.pages.dev` origin. Production requires the public runtime configuration documented in [Pages release](../../docs/pages-release.md), the `https://founder-village-members.pages.dev/auth/callback` OIDC redirect, token endpoint CORS for the exact site, and the correct API issuer and audience. Release the runtime namespace and migration before the frontend. The hosted app’s account deletion link is `/account/delete`.

### Payment configuration

The runtime operates free accounts with payments disabled until its operator configures the relevant values in its ignored `secrets/<environment>.env` catalog. These settings belong to the API service. Keep them out of frontend configuration.

| Setting                         | Purpose                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `MEMBERS_PRICE_USD_CENTS`       | One-time price in USD cents. USDC uses the same numeric price in USDC.    |
| `MEMBERS_STRIPE_KEY`            | Stripe API key for the environment. Use the sandbox outside production.   |
| `MEMBERS_STRIPE_WEBHOOK_SECRET` | Signing secret for the exact `/members/webhooks/stripe` API endpoint.     |
| `MEMBERS_SOLANA_RECIPIENT`      | Merchant’s Solana wallet public address for that environment.             |
| `MEMBERS_SOLANA_RPC_URL`        | Trusted HTTPS RPC endpoint on mainnet in production and devnet elsewhere. |
| `MEMBERS_SOL_LAMPORTS`          | Fixed SOL price in lamports. Existing quotes keep their original amount.  |

In Stripe, enable cards and Apple Pay for hosted Checkout. Send `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`, and `charge.dispute.created` to the runtime webhook. A full refund or dispute reverses that payment’s upgrade. Evaluate dispute wins and exceptional charges through the merchant account. [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment) · [Stripe Apple Pay](https://docs.stripe.com/apple-pay)

Provision the merchant’s Circle-issued USDC associated token account for the configured wallet, and use a Solana Pay wallet on the matching cluster. The API verifies finality, recipient, mint, exact amount and checkout reference. Confirmed transfers can be reconciled by signature. Late, duplicate, and misdirected transfers require merchant reconciliation. [Solana Pay transfer requests](https://solana.com/docs/tools/solana-pay/quickstart/transfer-requests) · [Circle USDC mint addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)

## iOS and Android

The Expo app uses `com.foundervillage.members` as its provisional iOS bundle identifier, Android package, and URL scheme. Register `com.foundervillage.members://auth/callback` for a public native OIDC client using authorization code with PKCE. The web and native clients must resolve to the same issuer and member subject. In the app’s ignored Expo environment, configure `EXPO_PUBLIC_FV_API_ORIGIN`, `EXPO_PUBLIC_FV_OIDC_AUTHORIZATION_ENDPOINT`, `EXPO_PUBLIC_FV_OIDC_TOKEN_ENDPOINT`, `EXPO_PUBLIC_FV_OIDC_CLIENT_ID`, and optional `EXPO_PUBLIC_FV_OIDC_AUDIENCE` as public values. Use an API the devices can reach and trust.

```sh
npm run native:export -w @founder-village/founder-village-members
npm run ios -w @founder-village/founder-village-members
npm run android -w @founder-village/founder-village-members
```

The native apps support sign-up, the directory, WhatsApp handoff, account deletion, and membership status. Checkout is available on the web. Confirm store review requirements for the actual paid benefits, OIDC login methods, privacy policy, and directory moderation before submitting signed builds. [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) · [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/9858738) · [Google Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111)

## Artwork

[Greenhouse photograph](src/assets/community-greenhouse.jpg) was generated with built-in ImageGen for the dark theme. The [Monstera deliciosa mark](src/assets/monstera.svg) supplies the in-app logo and the browser and native icon assets.

<details>
<summary>Greenhouse ImageGen prompt</summary>

> Photorealistic editorial hero for Founder Village Members in dark solarpunk, plantpunk and electricitypunk style. Show four founders deep in conversation around a worktable in a lush tropical greenhouse at night. Frame them with glossy split Monstera leaves, glass ribs, subtle electric-lime grow lights and warm amber task lighting. Keep faces clear and natural, the central group within the middle half for responsive cropping, and the edges in deep forest shadow. Landscape 4:3 composition with strong foreground foliage and architectural depth. No text, logos or watermarks.

</details>

[Community photograph](src/assets/community.jpg) was generated with built-in ImageGen as illustrative app artwork.

<details>
<summary>ImageGen prompt</summary>

> Photorealistic-natural editorial photograph for a Founder Village community app, wide landscape 3:2 aspect. Four diverse adult founders in their late 20s to 40s in a candid conversation around a wooden outdoor table, one sharing an idea, others naturally attentive and smiling, coffee and one closed notebook. Airy tropical courtyard with palms and lush leaves, simple wood and cream plaster architecture, warm late afternoon sunlight, crafted documentary photography, soft natural grain, quiet earthy tones with dark forest green and warm amber. Subjects gathered center-right with some breathing room, gently shaded foreground, faces realistic, no crowd. Useful as appreciation of the community and not as personal profile imagery. No logo, no typography, no watermarks, no phones, no staged stock handshake.

</details>
