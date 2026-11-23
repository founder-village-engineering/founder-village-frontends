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

const deletionIntent = "founder-village-members.delete-intent";

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

export function initialScreen(): "directory" | "membership" | "profile" {
  if (
    window.location.pathname === "/account/delete" ||
    sessionStorage.getItem(deletionIntent)
  )
    return "profile";
  if (new URLSearchParams(window.location.search).has("checkout"))
    return "membership";
  return "directory";
}

export function checkoutReturned() {
  return (
    new URLSearchParams(window.location.search).get("checkout") === "return"
  );
}

export function showDeletion() {
  return (
    window.location.pathname === "/account/delete" ||
    sessionStorage.getItem(deletionIntent) === "true"
  );
}

export async function restoreSession(config: RuntimeConfig) {
  if (window.location.pathname !== "/auth/callback") return loadSession();
  try {
    if (new URLSearchParams(window.location.search).has("error"))
      throw new Error("Sign-in was canceled or declined.");
    return await completeSignIn(config);
  } finally {
    const deletion = sessionStorage.getItem(deletionIntent) === "true";
    sessionStorage.removeItem(deletionIntent);
    window.history.replaceState({}, "", deletion ? "/account/delete" : "/");
  }
}

export async function signIn(
  config: RuntimeConfig,
): Promise<BrowserSession | undefined> {
  if (showDeletion()) sessionStorage.setItem(deletionIntent, "true");
  await beginSignIn(config);
  return undefined;
}

export async function signOut() {
  clearSession();
  sessionStorage.removeItem(deletionIntent);
}

export function canSignIn(config: RuntimeConfig) {
  return hasOidc(config);
}

export function openExternal(url: string) {
  window.location.assign(url);
  return Promise.resolve();
}
