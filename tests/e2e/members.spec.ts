import { expect, test } from "@playwright/test";
import type {
  Checkout,
  Membership,
  Profile,
} from "../../apps/founder-village-members/src/generated/contracts/index.ts";

const origin = "http://127.0.0.1:43911";
const profileId = "2c11d8c7-bad6-495f-a39a-e86256340ea0";
const contactId = "6146a7a6-9eba-49b1-967c-1ca12139ed86";
const checkoutId = "f8c25417-701c-4113-aae3-00ccbe9405a3";

test.use({ baseURL: origin });

test("creates a free profile, opens a WhatsApp chat, and upgrades after verified checkout", async ({
  page,
}, testInfo) => {
  let account: Profile | null = null;
  let checkout: Checkout | null = null;
  const offers: Membership["offers"] = [
    { method: "card", amount: "25.00", currency: "USD", test: true },
    { method: "sol", amount: "0.09", currency: "SOL", test: true },
    { method: "usdc", amount: "25", currency: "USDC", test: true },
  ];
  await page.route("**/runtime-config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'window.__FOUNDER_VILLAGE_CONFIG__ = {apiOrigin:"https://api.fv",authorizationEndpoint:"https://identity.example.test/authorize",tokenEndpoint:"https://identity.example.test/token",clientId:"public-fixture"};',
    }),
  );
  let verifierChallenge = "";
  await page.route(
    "https://identity.example.test/authorize?*",
    async (route) => {
      const params = new URL(route.request().url()).searchParams;
      expect(params.get("redirect_uri")).toBe(`${origin}/auth/callback`);
      expect(params.get("code_challenge_method")).toBe("S256");
      verifierChallenge = params.get("code_challenge") ?? "";
      await route.fulfill({
        status: 302,
        headers: {
          location: `${origin}/auth/callback?code=fixture&state=${params.get("state")}`,
        },
      });
    },
  );
  await page.route("https://identity.example.test/token", async (route) => {
    const params = new URLSearchParams(route.request().postData() ?? "");
    expect(params.get("code")).toBe("fixture");
    expect(verifierChallenge).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(params.get("code_verifier")).toBeTruthy();
    await route.fulfill({
      json: { access_token: "synthetic-access-token", expires_in: 3600 },
      headers: { "access-control-allow-origin": origin },
    });
  });
  await page.route("https://api.fv/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(await request.headerValue("x-application-id")).toBe(
      "founder-village-members",
    );
    if (url.pathname === "/members/me") {
      if (request.method() === "POST")
        account = { ...request.postDataJSON(), id: profileId };
      return route.fulfill({ json: { profile: account } });
    }
    if (url.pathname === "/members/directory") {
      const member = {
        id: contactId,
        name: "Jordan Example",
        headline: "Community gardens",
        location: "Example City",
        whatsappAvailable: true,
      };
      return route.fulfill({
        json: {
          members: member.name
            .toLowerCase()
            .includes(url.searchParams.get("q")?.toLowerCase() ?? "")
            ? [member]
            : [],
          next: null,
        },
      });
    }
    if (url.pathname === `/members/directory/${contactId}/whatsapp`)
      return route.fulfill({ json: { number: "+12025550123" } });
    if (url.pathname === "/members/membership")
      return route.fulfill({
        json: {
          tier: checkout?.status === "paid" ? "paid" : "free",
          checkout,
          offers,
        },
      });
    if (url.pathname === "/members/checkout" && request.method() === "POST") {
      const { method } = request.postDataJSON() as { method: "card" | "usdc" };
      expect(await request.headerValue("idempotency-key")).toMatch(
        /^[a-f0-9-]{36}$/,
      );
      checkout = {
        ...offers.find((offer) => offer.method === method)!,
        id: checkoutId,
        status: "pending",
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      return route.fulfill({
        json: {
          checkout,
          action:
            method === "card"
              ? {
                  kind: "stripe",
                  url: "https://checkout.stripe.com/c/pay/synthetic_fixture_only",
                }
              : {
                  kind: "solana",
                  network: "devnet",
                  url: "solana:11111111111111111111111111111111?amount=25&label=Fixture",
                },
        },
      });
    }
    if (url.pathname === `/members/checkout/${checkoutId}/check` && checkout) {
      checkout = {
        ...checkout,
        status: checkout.method === "card" ? "paid" : "expired",
      };
      return route.fulfill({ json: checkout });
    }
    if (url.pathname === "/members/delete") {
      expect(request.postDataJSON()).toEqual({ confirm: true });
      account = null;
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  await page.route("https://wa.me/12025550123", (route) =>
    route.fulfill({
      contentType: "text/plain",
      body: "Synthetic WhatsApp handoff",
    }),
  );
  await page.route(
    "https://checkout.stripe.com/c/pay/synthetic_fixture_only",
    (route) =>
      route.fulfill({
        contentType: "text/plain",
        body: "Synthetic hosted checkout",
      }),
  );

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good things grow together." }),
  ).toBeVisible();
  if (process.env.FV_CAPTURE_QA === "1")
    await page.screenshot({ path: testInfo.outputPath("members-welcome.png") });
  await page.getByRole("button", { name: "Create free account" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Create your free account" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Enter a display name");
  await page.getByLabel("Display name").fill("Alex Example");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Member directory" }),
  ).toBeVisible();
  await expect(page.getByText("Jordan Example")).toBeVisible();
  if (process.env.FV_CAPTURE_QA === "1")
    await page.screenshot({
      path: testInfo.outputPath("members-directory.png"),
    });
  await page.getByLabel("Search members").fill("unknown");
  await expect(page.getByText("No matching members")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page
    .getByRole("button", { name: "Message Jordan Example on WhatsApp" })
    .click();
  await expect(page).toHaveURL("https://wa.me/12025550123");
  await page.goBack();
  await page.getByRole("button", { name: "Membership", exact: true }).click();
  await expect(page.getByText("Free member", { exact: true })).toBeVisible();
  await expect(page.getByText("Solana (SOL)")).toBeVisible();
  await expect(page.getByText("USDC on Solana")).toBeVisible();
  await page.getByText("USDC on Solana", { exact: true }).click();
  await expect(page.getByLabel("Solana Pay QR code")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Solana wallet" }),
  ).toBeVisible();
  await expect(page.getByText("Free member", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check payment status" }).click();
  await expect(
    page.getByText("The previous payment request expired."),
  ).toBeVisible();
  await page.getByText("Credit card or Apple Pay", { exact: true }).click();
  await expect(page).toHaveURL(
    "https://checkout.stripe.com/c/pay/synthetic_fixture_only",
  );
  await page.goto("/?checkout=return");
  await expect(page.getByText("Paid member", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Paid member", { exact: true })).toBeVisible();
  await page.goto("/account/delete");
  await page
    .getByRole("button", { name: "Permanently delete account" })
    .click();
  await expect(page.getByText("Your account was deleted.")).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("founder-village.session.v1"),
    ),
  ).toBeNull();
});
