export type RuntimeConfig = {
  apiOrigin: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  clientId?: string;
  audience?: string;
};

declare global {
  interface Window {
    __FOUNDER_VILLAGE_CONFIG__?: unknown;
  }
}

function exactHttpsOrigin(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Runtime API origin is missing.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Runtime API origin is invalid.");
  return value;
}

function exactHttpsUrl(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is missing.`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error(`${label} is invalid.`);
  return value;
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Runtime configuration is unavailable.");
  const input = value as Record<string, unknown>;
  const apiOrigin = exactHttpsOrigin(input.apiOrigin);
  const authValues = [
    input.authorizationEndpoint,
    input.tokenEndpoint,
    input.clientId,
  ];
  if (authValues.every((entry) => entry === undefined)) return { apiOrigin };
  if (authValues.some((entry) => typeof entry !== "string" || !entry))
    throw new Error("OIDC configuration is incomplete.");
  return {
    apiOrigin,
    authorizationEndpoint: exactHttpsUrl(
      input.authorizationEndpoint,
      "Authorization endpoint",
    ),
    tokenEndpoint: exactHttpsUrl(input.tokenEndpoint, "Token endpoint"),
    clientId: String(input.clientId),
    audience:
      typeof input.audience === "string" && input.audience
        ? input.audience
        : undefined,
  };
}

export function runtimeConfig(): RuntimeConfig {
  return parseRuntimeConfig(window.__FOUNDER_VILLAGE_CONFIG__);
}

export function hasOidc(config: RuntimeConfig): config is RuntimeConfig & {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
} {
  return Boolean(
    config.authorizationEndpoint && config.tokenEndpoint && config.clientId,
  );
}
