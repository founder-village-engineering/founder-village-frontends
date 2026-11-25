// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { customOrigins, loadApp } from "./manifest.ts";
import { aliasHasExpectedRecord, PagesDomains } from "./pages-domains.ts";
import { deploymentHeaders, projectNames } from "./pages.ts";

describe("Pages security headers", () => {
  it("allows only the configured API and token endpoint origins", () => {
    const headers = deploymentHeaders({
      apiOrigin: "https://api.founder-village.example",
      authorizationEndpoint: "https://identity.example/authorize",
      tokenEndpoint: "https://identity.example/oauth/token",
      clientId: "public-client",
    });
    expect(headers).toContain(
      "connect-src 'self' https://api.founder-village.example https://identity.example",
    );
    expect(headers).not.toMatch(/connect-src[^;]*\shttps:(?:\s|;)/);
  });
});

it("reads project names from the installed Wrangler inventory and rejects unknown shapes", () => {
  expect(
    projectNames([
      { "Project Name": "sample-project" },
      { name: "another-project" },
    ]),
  ).toEqual(["sample-project", "another-project"]);
  expect(() => projectNames([{}])).toThrow(/invalid name/);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("requires both production apexes to belong to the selected Pages account before mutation", async () => {
  const { manifest } = await loadApp("founder-village-app");
  expect(customOrigins(manifest)).toEqual([
    "https://founderhaus.org",
    "https://foundervillage.org",
  ]);
  const accountId = "a".repeat(32);
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", accountId);
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic-token-fixture");
  const request = vi.fn(async (input: string, options: RequestInit) => {
    expect(options.method).toBe("GET");
    const url = new URL(input);
    expect(url.pathname).toBe("/client/v4/zones");
    expect(url.searchParams.get("account.id")).toBe(accountId);
    const name = url.searchParams.get("name");
    return Response.json({
      success: true,
      result:
        name === "founderhaus.org"
          ? [
              {
                id: "b".repeat(32),
                name,
                status: "active",
                account: { id: accountId },
              },
            ]
          : [],
    });
  });
  vi.stubGlobal("fetch", request);
  await expect(new PagesDomains(manifest).preflight()).rejects.toThrow(
    "the active zone for foundervillage.org must belong to the Pages account",
  );
  expect(request).toHaveBeenCalledTimes(2);
});

it("adopts an exact proxied alias and refuses live web DNS conflicts", () => {
  const hostname = "founderhaus.org";
  const target = "founder-village-app.pages.dev";
  const email = { name: hostname, type: "MX", content: "mail.example.test" };
  const alias = {
    name: hostname,
    type: "CNAME",
    content: target,
    proxied: true,
  };
  expect(aliasHasExpectedRecord([email], hostname, target)).toBe(false);
  expect(aliasHasExpectedRecord([email, alias], hostname, target)).toBe(true);
  expect(() =>
    aliasHasExpectedRecord(
      [email, { ...alias, content: "other.pages.dev" }],
      hostname,
      target,
    ),
  ).toThrow("existing web DNS records conflict");
});
