import { describe, expect, it } from "vitest";
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
