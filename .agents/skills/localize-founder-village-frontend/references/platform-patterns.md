# Platform patterns

## Catalogs and locale resolution

Adapt this small TypeScript pattern when the app has no localization layer. The explicit locale input represents a locale from an app-owned link, where supported. Pass `undefined` for link-free surfaces. A static public page selects its locale directly from the route.

```ts
export const locales = ["pt-BR", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pt-BR";

function supportedLocale(value: unknown): Locale | undefined {
  return locales.find((locale) => locale === value);
}

export function resolveLocale(explicit: unknown, saved: unknown): Locale {
  return supportedLocale(explicit) ?? supportedLocale(saved) ?? defaultLocale;
}

type Messages = {
  signIn: string;
  retry: string;
  welcome: (name: string) => string;
};

export const messages = {
  "pt-BR": {
    signIn: "Entrar",
    retry: "Tentar novamente",
    welcome: (name) => `Boas-vindas, ${name}!`,
  },
  en: {
    signIn: "Sign in",
    retry: "Try again",
    welcome: (name) => `Welcome, ${name}!`,
  },
} satisfies Record<Locale, Messages>;
```

Use the selected catalog directly. A new key in the message type requires both languages. For live messages that need to change language, keep the message key and parameters in state and render the localized copy from the current catalog.

## Indexable public pages

The NASA Space Apps Floripa guide uses one page component, typed interface copy, and translated presentation data keyed by stable event identifiers. It exports `/` and `/en/` with real language links. The switch preserves the section and shared checklist progress. The calendar and agenda use the selected language and retain the same event facts. In the sibling `nasa_space_apps_2026` checkout, see `site-document.tsx`, `event-guide.tsx`, `translations.ts`, and `event-data.pt.ts` under `frontend/site/app/`.

- Make the built HTML at each locale URL usable as a direct entry. Set `<html lang>`, page title, description, and social metadata for that locale. For equivalent indexable pages, use a self-canonical URL and publish the same `hreflang` set on both pages. Map `pt-BR` and `x-default` to the Portuguese URL and `en` to the English URL. Build absolute URLs from the intended public origin.
- Use ordinary links with `hrefLang`, `lang`, and `aria-current="page"` on the current language. Map stable shared fragments such as `#schedule` to the corresponding locale route. Mark known other-language passages or link labels with their language where needed for pronunciation.
- Keep the existing static Pages build and the root `pages` command. Check that a directly requested English URL serves its English artifact and that the app's SPA fallback rules allow the intended static route to resolve. Check both artifacts even when the shared release plan validates the root.

[Localized versions of pages](https://developers.google.com/search/docs/specialty/international/localized-versions) · [WCAG page language](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html) · [WCAG language of parts](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html)

## Authenticated web and React Native Web

- Resolve one locale at the app shell before rendering the translated view. Update `document.documentElement.lang`, title, and app-owned description when it changes. Set the language of `index.html` to match its static content.
- Store only a supported locale tag under an app-scoped key. Recover gracefully from unavailable storage or invalid values. A Pages app's browser storage belongs to that origin. Public route links remain deterministic, while a signed-in SPA can remember a choice on subsequent neutral entries.
- Use the existing router or location handling. If the app needs shareable language-specific links, a query such as `?lang=en` can carry the supported locale on ordinary app routes. Coordinate with navigation and Back/Forward. Preserve the current path, fragment, and functional query parameters on those routes. Validate return destinations and keep provider-controlled callback parameters and sign-in fragments out of language links and saved state.
- Keep `/auth/callback` and the existing checkout and account deletion destinations working. Read the app session module and `packages/frontend-platform/src/auth.ts` before changing location handling. Restore the chosen language when the original journey resumes and let the existing auth flow consume and clear its callback parameters.
- Map `RuntimeRequestError.status` from `packages/frontend-platform/src/api.ts` to a message key at the UI boundary. Localize an expired session or retryable service error from the current catalog so recovery text updates during a language switch.

## Expo on iOS and Android

- Share the active locale, catalogs, and formatting with React Native Web. Keep browser document updates and native storage in their platform entry points or adapters. Use the app's preference storage, allow for asynchronous reads, and render a neutral loading shell while restoring a choice if that avoids flashing the wrong language.
- Use localized accessibility labels, hints, and selected state. Use native speech-language properties where supported, such as `accessibilityLanguage` on iOS. Verify native-only billing, auth, and external-link states when the affected journey reaches them.
- Retain the registered callback scheme, navigation state, and form state. On next launch, load the saved locale or start in Portuguese when no choice is available.

[React Native accessibility](https://reactnative.dev/docs/accessibility#accessibilitylanguage)
