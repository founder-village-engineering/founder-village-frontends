---
name: review-founder-village-localization
description: Audit Founder Village frontends for Portuguese-first behavior, English coverage, accessible switching, and locale regressions across static web, signed-in web, and Expo.
---

# Review Founder Village localization

Use the [frontend localization standard](../localize-founder-village-frontend/SKILL.md) as the baseline. For a whole-repository audit, inventory `apps/*/founder-village-app.json` and check the shared app scaffold in `templates/app/`. Include web and native entry points for `founder-village-app` and `founder-village-members`. Inspect standalone and integrated journeys where both apps expose the same feature. Scope a change review to the affected surfaces and their shared consumers.

## Verify behavior

| Check                        | Evidence to collect                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh entry                  | Use a clean browser context configured for English, or reset the native preference. Confirm Portuguese copy and accessible names in the first usable view, with language options named in their own languages. Confirm `lang="pt-BR"` on web.                                                                                  |
| Both directions              | Switch to English and back on a substantive screen. Check visible copy, labels, active selection, focus and layout on desktop and a narrow viewport. Confirm `lang` changes on web and test keyboard activation.                                                                                                               |
| Direct entry and persistence | For public static pages, request `/` and `/en/` directly and inspect localized HTML, metadata, alternates and fragment navigation. For an app with a saved choice, reload or relaunch and verify it restores the choice, a supported direct locale wins where exposed, and invalid inputs fall back according to the standard. |
| Journey and state            | Check both catalogs and cover the affected loading, empty, unauthenticated, error, and success states. Seed a draft, selection or stored record where relevant and verify it stays intact across a switch. Confirm localized errors can be understood and acted on.                                                            |
| Auth and billing             | If routing or session behavior is touched, exercise sign-in return, deep links and checkout return as applicable. Check exact callback URLs, preserved scope, and safe removal of provider callback parameters. Use synthetic fixtures for repeatable local proof.                                                             |
| Data and exports             | Check both languages display the same records, amounts, currencies and dates with the intended formatting. Where localized downloads exist, compare their record identity and factual content. Check that user-authored text and stable API values are preserved.                                                              |

## Choose proportionate checks

- Use the affected workspace typecheck for message parity. If translations are loaded dynamically, run the app's completeness check for both locale bundles. Inspect app-owned strings that can bypass the catalog, including server status messages displayed by the UI, native-only screens, metadata and accessibility hints.
- Reuse focused tests under `tests/e2e/` and the root Playwright desktop and mobile projects for web journeys. Add a behavior check when the existing suite misses a locale regression. Use the root `npm run pages -- plan --app <slug>` and inspect the built output when static routes or metadata change. Browser fixtures, built artifacts, live providers and native devices prove different parts of the experience.
- Report each gap with the app, route or platform, language, observed behavior, and reproduction or relevant file. State which checks ran, their results and any unverified layers. For a partial rollout, identify remaining untranslated surfaces.
