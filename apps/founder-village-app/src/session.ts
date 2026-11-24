import {
  beginSignIn,
  clearSession,
  completeSignIn,
  hasOidc,
  loadSession,
  parseRuntimeConfig,
  runtimeConfig,
  uuid,
  type BrowserSession,
  type RuntimeConfig,
} from "@founder-village/frontend-platform";
import { screenPaths, type Screen } from "./screens";

const returnPath = "founder-village-app.auth-return.v1";
const deletionPath = "/account/delete";

export { uuid as newRequestKey };

export function getConfig() {
  if (import.meta.env.DEV && import.meta.env.VITE_FV_OIDC_CLIENT_ID) {
    return parseRuntimeConfig({
      apiOrigin:
        import.meta.env.VITE_FV_RUNTIME_API_ORIGIN || runtimeConfig().apiOrigin,
      authorizationEndpoint: import.meta.env
        .VITE_FV_OIDC_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: import.meta.env.VITE_FV_OIDC_TOKEN_ENDPOINT,
      clientId: import.meta.env.VITE_FV_OIDC_CLIENT_ID,
      audience: import.meta.env.VITE_FV_OIDC_AUDIENCE,
    });
  }
  return runtimeConfig();
}

function requestedPath() {
  if (window.location.pathname !== "/auth/callback")
    return window.location.pathname;
  const saved = sessionStorage.getItem(returnPath);
  return saved === deletionPath ||
    Object.values(screenPaths).some((path) => path === saved)
    ? saved!
    : "/";
}

export function showDeletion() {
  return requestedPath() === deletionPath;
}

export function initialScreen(): Screen {
  if (showDeletion()) return "profile";
  if (new URLSearchParams(window.location.search).has("checkout"))
    return "membership";
  const pathname = requestedPath();
  return (
    (Object.keys(screenPaths) as Screen[]).find(
      (screen) => screenPaths[screen] === pathname,
    ) ?? "home"
  );
}

export function watchScreen(
  change: (screen: Screen, deletion: boolean) => void,
) {
  const update = () => change(initialScreen(), showDeletion());
  window.addEventListener("popstate", update);
  return () => window.removeEventListener("popstate", update);
}

export function writeScreen(screen: Screen) {
  const url = screenPaths[screen];
  if (window.location.pathname !== url || window.location.search)
    window.history.pushState({}, "", url);
}

export function checkoutReturned() {
  return (
    new URLSearchParams(window.location.search).get("checkout") === "return"
  );
}

export async function restoreSession(config: RuntimeConfig) {
  if (window.location.pathname !== "/auth/callback") return loadSession();
  const next = requestedPath();
  try {
    if (new URLSearchParams(window.location.search).has("error"))
      throw new Error("Sign-in was canceled or declined.");
    return await completeSignIn(config);
  } finally {
    sessionStorage.removeItem(returnPath);
    window.history.replaceState({}, "", next);
  }
}

export async function signIn(
  config: RuntimeConfig,
  screen: Screen,
): Promise<BrowserSession | undefined> {
  sessionStorage.setItem(
    returnPath,
    showDeletion() ? deletionPath : screenPaths[screen],
  );
  await beginSignIn(config);
  return undefined;
}

export async function signOut() {
  clearSession();
  sessionStorage.removeItem(returnPath);
}

export function canSignIn(config: RuntimeConfig) {
  return hasOidc(config);
}

export function openExternal(url: string) {
  window.location.assign(url);
  return Promise.resolve();
}
