import { describe, expect, it, vi } from "vitest";
import { runtimeJson, RuntimeRequestError } from "./api.ts";

const config = { apiOrigin: "https://api.example.test" };
const session = {
  accessToken: "synthetic-token",
  expiresAt: Date.now() + 60_000,
};

describe("runtimeJson", () => {
  it("keeps credentials on the configured origin and adds scoped headers", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.example.test/food-deliveries");
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer synthetic-token");
        expect(headers.get("x-application-id")).toBe("founders");
        expect(headers.get("x-tenant-id")).toBe("tenant");
        expect(init?.credentials).toBe("omit");
        expect(init?.redirect).toBe("error");
        return Response.json([]);
      },
    );
    await runtimeJson(
      config,
      "/food-deliveries",
      {
        session,
        application: "founders",
        tenantId: "tenant",
      },
      fetcher as typeof fetch,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects destination injection and sanitizes API failures", async () => {
    await expect(
      runtimeJson(config, "//evil.example/steal", {
        session,
        application: "founders",
      }),
    ).rejects.toThrow("Runtime path is invalid");
    await expect(
      runtimeJson(
        config,
        "/food-deliveries",
        { session, application: "founders" },
        (async () =>
          new Response('{"error":"secret diagnostic","requestId":"safe-id"}', {
            status: 503,
            headers: { "content-type": "application/json" },
          })) as typeof fetch,
      ),
    ).rejects.toEqual(new RuntimeRequestError(503, "safe-id"));
  });
});
