---
name: localize-founder-village-frontend
description: Build bilingual Founder Village interfaces with Brazilian Portuguese as the default. Use for app onboarding, localization rollouts, language switching, and edits to app-owned user-facing copy or journeys.
---

# Localize a Founder Village frontend

## Language behavior

- Support Brazilian Portuguese (`pt-BR`) and English (`en`). Accept only supported locale values. With no explicit selection, start in Portuguese even on an English browser or device.
- Keep a visible language control reachable on desktop and phone, including before sign-in. Give options their native names, **Português (Brasil)** and **English**, and expose the active choice. Use keyboard-operable links for distinct URLs and a native control or pressed buttons for in-place switching. Keep focus usable after a switch.
- For indexable public pages, follow NASA Space Apps Floripa. Serve Portuguese at `/` and English at `/en/`, with static, directly loadable peers for localizable pages. Keep the equivalent page and section when switching. Use each page's language in its HTML and metadata.
- For application SPAs and Expo, including the sign-in shell, resolve a supported explicit locale from a link if the app exposes one, then a saved user choice, then `pt-BR`. Persist choices made through the language control using the app's platform storage. Switch in place to retain the current screen, input, and session. Keep registered auth and payment return URLs intact.

Read the platform patterns for static Pages routing, language switching in signed-in web and Expo apps, and a TypeScript starter. [Platform patterns](references/platform-patterns.md)

## Implementation workflow

1. Find the app entry points and follow the affected journey through its initial, unauthenticated, loading, empty, denied, error, retry, and saved states. Include dialogs, accessibility names and announcements, and first-party help or downloads where the journey uses them. Check both the standalone app and the primary app when they show the same feature. For a scoped migration, finish the touched journey in both languages and identify remaining untranslated surfaces.
2. Reuse the app's localization layer if present. Give Portuguese and English the same typed message shape and check both catalogs for completeness in the build or typecheck. Store product copy with its feature and place helpers with multiple consumers in `packages/`. Use complete phrases with named or typed parameters so translators can reorder words and handle plurals. Author natural Brazilian Portuguese and English with consistent product terms, amounts, dates, and commitments.
3. Resolve language once for the app or route and derive visible copy, accessibility labels, validation, and metadata from it. Map structured runtime error codes or statuses to localized recovery messages and use a localized generic message for unknown failures. Keep user-authored content, official names, identifiers, generated contracts, and machine-readable values in their original form. Label linked resources whose language differs from the current page when the language is known.
4. Pass the active locale to `Intl` for dates, numbers, prices, and plural selection. Carry currency, units, and any product-defined time zone from their authoritative data. Keep calendar dates such as order dates distinct from timestamps. Keep form drafts and persisted values stable across a switch. For localized numeric input, validate the intended format and send the canonical value required by the contract.
5. Use the [localization review skill](../review-founder-village-localization/SKILL.md) to verify the changed journey in both languages. Confirm a clean Portuguese entry, an English switch, and language retention through the reload, deep link, or relaunch that the surface supports.
