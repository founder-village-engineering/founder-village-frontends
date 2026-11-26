// @vitest-environment node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customOrigins, loadApp, pagesTargets } from "./manifest.ts";
import { aliasHasExpectedRecord, PagesDomains } from "./pages-domains.ts";
import {
  deploymentHeaders,
  pagesBuildEnvironment,
  pagesCredential,
  pagesUploaderEnvironment,
  projectNames,
} from "./pages.ts";

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

it("pins uploads to the verified Founder account and excludes inherited auth and provider endpoints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fv-pages-credentials-"));
  try {
    const account = "a".repeat(32);
    const token = randomUUID();
    const binding = join(directory, "binding.json");
    await writeFile(
      binding,
      JSON.stringify({ account_id: account, zone_name: "foundervillage.org" }),
      { mode: 0o600 },
    );
    const env = {
      CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_API_TOKEN: token,
      CF_API_TOKEN: randomUUID(),
      CLOUDFLARE_API_BASE_URL: "https://untrusted.invalid",
      FV_PAGES_CLOUDFLARE_BINDING: binding,
      DUPLICATE_CREDENTIAL: token,
      FV_RUNTIME_API_ORIGIN: "https://api.example.test",
    };
    await expect(
      pagesCredential({ ...env, CLOUDFLARE_AUTH_PROFILE: "foundervillage" }),
    ).rejects.toThrow(/explicit Founder account bearer/);
    await expect(
      pagesCredential({
        ...env,
        CLOUDFLARE_API_TOKEN: undefined,
        CREDENTIALS_DIRECTORY: directory,
        HOME: directory,
      }),
    ).rejects.toThrow(/npm run pages -- login/);
    await expect(
      pagesCredential({ ...env, CLOUDFLARE_ACCOUNT_ID: "b".repeat(32) }),
    ).rejects.toThrow(/bound Founder account/);
    await chmod(binding, 0o644);
    await expect(pagesCredential(env)).rejects.toThrow(/owner-only Founder/);
    await chmod(binding, 0o600);
    const verified = await pagesCredential(env);
    const uploader = pagesUploaderEnvironment(verified, directory);
    expect(uploader).toMatchObject({
      HOME: directory,
      XDG_CONFIG_HOME: directory,
      CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_API_BASE_URL: "https://api.cloudflare.com/client/v4",
    });
    expect(uploader).not.toHaveProperty("CF_API_TOKEN");
    expect(pagesBuildEnvironment(env)).toEqual({
      FV_PAGES_CLOUDFLARE_BINDING: binding,
      FV_RUNTIME_API_ORIGIN: "https://api.example.test",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("refuses a login-profile flag at the actual Pages deploy entry point", async () => {
  await expect(
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/pages.ts",
        "deploy",
        "--app",
        "founder-village-app",
        "--profile",
        "foundervillage",
      ],
      { env: {} },
    ),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("Supply Pages mutation credentials"),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("requires an exact Direct Upload project for each Pages hostname", async () => {
  const { manifest } = await loadApp("founder-village-app");
  const [primary, additional] = pagesTargets(manifest);
  expect([primary, additional]).toEqual([
    {
      pagesProject: "founder-village-app",
      productionOrigin: "https://founder-village-app.pages.dev",
    },
    {
      pagesProject: "founder-village-apps",
      productionOrigin: "https://founder-village-apps.pages.dev",
    },
  ]);
  const provider = new PagesDomains(manifest, {
    account: "a".repeat(32),
    token: randomUUID(),
  });
  let additionalSubdomain = "founder-village-apps.pages.dev";
  vi.stubGlobal("fetch", async (input: string, options: RequestInit) => {
    expect(options.method).toBe("GET");
    const name = new URL(input).pathname.split("/").at(-1);
    return Response.json({
      success: true,
      result: {
        name,
        subdomain:
          name === "founder-village-app"
            ? "founder-village-app.pages.dev"
            : additionalSubdomain,
        production_branch: "main",
        source: null,
        canonical_deployment: null,
      },
    });
  });
  await expect(provider.verifyProject(primary!)).resolves.toEqual({
    deployed: false,
  });
  await expect(provider.verifyProject(additional!)).resolves.toEqual({
    deployed: false,
  });
  additionalSubdomain = "founder-village-apps-example.pages.dev";
  await expect(provider.verifyProject(additional!)).rejects.toThrow(
    "Cloudflare project founder-village-apps does not match the exact Direct Upload production project",
  );
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
