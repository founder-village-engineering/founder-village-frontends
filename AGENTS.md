# Founder Village frontends

- Author source and automation in TypeScript (`.ts`/`.tsx`). Keep every app under `apps/<slug>` and reusable browser/runtime logic under `packages/`.
- All public frontends deploy as static Cloudflare Pages projects on their exact `*.pages.dev` origin. Do not add a Worker entrypoint, Worker route, Pages Function, `_worker.js`, or `wrangler deploy` path.
- `founder-village-app.json` is each app's manifest. Pages commands must go through the shared root tooling, which builds first and verifies the exact project/origin.
- Runtime contracts under `src/generated/contracts/` are generated copies owned by the sibling runtime. Never edit them directly; update the matching runtime `packages/frontend-contracts/<slug>/` source and run the scoped sync.
- The runtime's `config/frontends.json` is the backend origin allowlist. A Pages deployment is not ready until its exact origin, application database, contract source, and generated copy all agree.
- Keep frontends responsive on phones and computers, keyboard accessible, and explicit about loading, empty, error, unauthenticated, and persisted states.
- Preserve unrelated work. Building or checking does not imply permission to commit, push, provision a Pages project, deploy, or mutate a live runtime/database.
