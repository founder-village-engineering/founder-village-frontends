import type { BrowserSession } from "./auth.ts";
import type { RuntimeConfig } from "./config.ts";

export class RuntimeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(
      status === 401
        ? "Your session expired. Sign in again."
        : status === 403
          ? "This account cannot access that village."
          : status === 409
            ? "That request was already used with different details."
            : status >= 500
              ? "The delivery service is temporarily unavailable."
              : "We could not complete that request.",
    );
    this.name = "RuntimeRequestError";
  }
}

export type RuntimeRequest = {
  session: BrowserSession;
  application: string;
  tenantId?: string;
  method?: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string;
};

export async function runtimeJson(
  config: RuntimeConfig,
  path: string,
  request: RuntimeRequest,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<unknown> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new Error("Runtime path is invalid.");
  const url = new URL(path, `${config.apiOrigin}/`);
  if (url.origin !== config.apiOrigin)
    throw new Error("Runtime origin changed.");
  const headers = new Headers({
    authorization: `Bearer ${request.session.accessToken}`,
    "x-application-id": request.application,
  });
  if (request.tenantId) headers.set("x-tenant-id", request.tenantId);
  if (request.idempotencyKey)
    headers.set("idempotency-key", request.idempotencyKey);
  let body: string | undefined;
  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(request.body);
  }
  const response = await fetcher(url, {
    method: request.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (text.length > 1_048_576)
    throw new Error("Runtime response was too large.");
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Runtime response was not JSON.");
  }
  if (!response.ok) {
    const requestId =
      payload && typeof payload === "object" && "requestId" in payload
        ? String((payload as { requestId: unknown }).requestId)
        : undefined;
    throw new RuntimeRequestError(response.status, requestId);
  }
  return payload;
}

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
