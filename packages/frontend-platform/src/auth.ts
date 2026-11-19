import { hasOidc, type RuntimeConfig } from "./config.ts";

export type BrowserSession = {
  accessToken: string;
  expiresAt: number;
};

const sessionKey = "founder-village.session.v1";
const transactionKey = "founder-village.oidc.v1";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function randomValue(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
}

async function challenge(verifier: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
}

export function loadSession(): BrowserSession | undefined {
  const raw = sessionStorage.getItem(sessionKey);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<BrowserSession>;
    if (
      typeof value.accessToken !== "string" ||
      !value.accessToken ||
      value.accessToken.length > 16_384 ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= Date.now() + 5_000
    ) {
      clearSession();
      return undefined;
    }
    return { accessToken: value.accessToken, expiresAt: value.expiresAt };
  } catch {
    clearSession();
    return undefined;
  }
}

export function saveDevelopmentSession(accessToken: string, ttlSeconds = 3600) {
  if (!accessToken || accessToken.length > 16_384)
    throw new Error("Development access token is invalid.");
  const session = {
    accessToken,
    expiresAt: Date.now() + Math.min(Math.max(ttlSeconds, 60), 7200) * 1000,
  };
  sessionStorage.setItem(sessionKey, JSON.stringify(session));
  return session;
}

export function clearSession(): void {
  sessionStorage.removeItem(sessionKey);
  sessionStorage.removeItem(transactionKey);
}

export async function beginSignIn(config: RuntimeConfig): Promise<void> {
  if (!hasOidc(config)) throw new Error("Sign-in is not configured.");
  const verifier = randomValue(64);
  const state = randomValue();
  const redirectUri = `${window.location.origin}/auth/callback`;
  sessionStorage.setItem(
    transactionKey,
    JSON.stringify({ verifier, state, redirectUri }),
  );
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (config.audience) url.searchParams.set("audience", config.audience);
  window.location.assign(url);
}

export async function completeSignIn(
  config: RuntimeConfig,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<BrowserSession | undefined> {
  const current = new URL(window.location.href);
  const code = current.searchParams.get("code");
  const state = current.searchParams.get("state");
  if (!code && !state) return loadSession();
  if (!hasOidc(config) || !code || !state)
    throw new Error("Sign-in response is incomplete.");
  const raw = sessionStorage.getItem(transactionKey);
  sessionStorage.removeItem(transactionKey);
  if (!raw) throw new Error("Sign-in transaction expired.");
  const transaction = JSON.parse(raw) as {
    verifier?: unknown;
    state?: unknown;
    redirectUri?: unknown;
  };
  if (
    transaction.state !== state ||
    typeof transaction.verifier !== "string" ||
    typeof transaction.redirectUri !== "string"
  )
    throw new Error("Sign-in state did not match.");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    redirect_uri: transaction.redirectUri,
    code_verifier: transaction.verifier,
  });
  const response = await fetcher(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  const text = await response.text();
  if (!response.ok || text.length > 64_000)
    throw new Error("Sign-in token exchange failed.");
  const payload = JSON.parse(text) as Record<string, unknown>;
  if (
    typeof payload.access_token !== "string" ||
    !payload.access_token ||
    payload.access_token.length > 16_384 ||
    typeof payload.expires_in !== "number" ||
    payload.expires_in < 60 ||
    payload.expires_in > 7200
  )
    throw new Error("Sign-in token response was invalid.");
  const session = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  sessionStorage.setItem(sessionKey, JSON.stringify(session));
  history.replaceState({}, "", "/");
  return session;
}
