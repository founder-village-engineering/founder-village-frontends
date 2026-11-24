import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { EngineeringItem } from "../../apps/founder-village-app/src/generated/contracts/index.ts";
import type { FoodDelivery } from "../../apps/founder-village-app/src/generated/contracts/features/founder-food-deliveries/index.ts";
import type { Profile } from "../../apps/founder-village-app/src/generated/contracts/features/founder-village-members/index.ts";
import type {
  Conversation,
  Message,
} from "../../apps/founder-village-app/src/generated/contracts/features/founder-village-team/index.ts";

const origin = "http://127.0.0.1:43913";
const team = { id: randomUUID(), name: "Synthetic engineering team" };
const village = { id: randomUUID(), name: "Synthetic village" };
const now = () => new Date().toISOString();
test.use({ baseURL: origin });

async function navigate(page: Page, section: string) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: section, exact: true })
    .click();
}

test("free enrollment, premium status, deliveries, engineering, and private chats share one session", async ({
  page,
}) => {
  test.setTimeout(45_000);
  let profile: Profile | null = null;
  let delivery: FoodDelivery | undefined;
  let item: EngineeringItem | undefined;
  let chat: Conversation | undefined;
  let premium = false;
  const sessionToken = randomUUID();
  const messages: Message[] = [];
  const bot = {
    id: randomUUID(),
    name: "Synthetic garden bot",
    description: "",
    visibility: "team",
    instructions: null,
    configuration: null,
    canManage: false,
    createdAt: now(),
  };
  const bots = [bot];

  await page.route("**/runtime-config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'window.__FOUNDER_VILLAGE_CONFIG__ = {apiOrigin:"https://api.fv",authorizationEndpoint:"https://identity.example.test/authorize",tokenEndpoint:"https://identity.example.test/token",clientId:"fixture-app"};',
    }),
  );
  await page.route("https://identity.example.test/authorize?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("redirect_uri")).toBe(`${origin}/auth/callback`);
    expect(query.get("code_challenge_method")).toBe("S256");
    return route.fulfill({
      status: 302,
      headers: {
        location: `${origin}/auth/callback?code=fixture&state=${query.get("state")}`,
      },
    });
  });
  await page.route("https://identity.example.test/token", (route) =>
    route.fulfill({
      json: { access_token: sessionToken, expires_in: 900 },
    }),
  );
  await page.route("https://api.fv/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(3);
    const write = request.method() === "POST";
    const data = write ? request.postDataJSON() : undefined;
    const headers = request.headers();
    expect(headers.authorization).toBe(`Bearer ${sessionToken}`);
    const json = (value: unknown) => route.fulfill({ json: value });

    if (path.startsWith("/members/")) {
      expect(headers["x-application-id"]).toBe("founder-village-members");
      if (path === "/members/me") {
        if (write) profile = { ...data, id: randomUUID() };
        return json({ profile });
      }
      if (path === "/members/directory")
        return json({ members: [], next: null });
      if (path === "/members/membership")
        return json({
          tier: premium ? "paid" : "free",
          checkout: null,
          offers: [],
        });
    }
    if (path === "/food-deliveries/tenants") return json([village]);
    if (path === "/team/tenants") return json([team]);
    if (path === "/founders/me" || path === "/food-deliveries") {
      expect(headers["x-application-id"]).toBe("founders");
      expect(headers["x-tenant-id"]).toBe(village.id);
      if (path === "/founders/me")
        return json({
          id: randomUUID(),
          tenantId: village.id,
          fullName: "Synthetic founder",
          email: "founder@example.test",
          companies: [],
          balance: { currency: "BRL", balanceCents: 0 },
        });
      if (!write) return json(delivery ? [delivery] : []);
      expect(headers["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/);
      expect(data.subtotalCents).toBe(4250);
      delivery = {
        ...data,
        id: randomUUID(),
        totalCents: 4250,
        currency: "BRL",
        status: "placed",
        placedAt: now(),
        createdAt: now(),
        expenseId: randomUUID(),
        expenseStatus: "posted",
      };
      return json(delivery);
    }

    expect(headers["x-application-id"]).toBe("founder-village-team");
    expect(headers["x-tenant-id"]).toBe(team.id);
    if (path === "/team/engineering/items") {
      if (!write) return json({ items: item ? [item] : [], next: null });
      item = {
        ...data,
        id: randomUUID(),
        status: "backlog",
        revision: 1,
        createdAt: now(),
        updatedAt: now(),
      };
      return json(item);
    }
    if (item && path === `/team/engineering/items/${item.id}/status`) {
      expect(data.revision).toBe(item.revision);
      item = {
        ...item,
        status: data.status,
        revision: item.revision + 1,
        updatedAt: now(),
      };
      return json(item);
    }
    if (path === "/team/bots") {
      if (!write) return json({ items: bots, next: null });
      expect(data.visibility).toBe("private");
      const created = { ...bot, ...data, id: randomUUID(), canManage: true };
      bots.unshift({ ...created, instructions: null });
      return json(created);
    }
    if (path === "/team/conversations") {
      if (!write) return json({ items: chat ? [chat] : [], next: null });
      expect(data.botId).toBe(bot.id);
      chat = { ...data, id: randomUUID(), createdAt: now() };
      return json(chat);
    }
    if (path === "/team/capabilities") return json({ repliesAvailable: true });
    if (chat && path === `/team/conversations/${chat.id}/messages`) {
      if (!write) return json({ items: [...messages].reverse(), next: null });
      const message: Message = {
        id: randomUUID(),
        conversationId: chat.id,
        content: data.content,
        authorName: null,
        role: "user",
        position: 1,
        createdAt: now(),
      };
      messages.push(message);
      return json(message);
    }
    if (chat && path === `/team/conversations/${chat.id}/replies`) {
      expect(data.messageId).toBe(messages[0]?.id);
      const reply: Message = {
        id: randomUUID(),
        conversationId: chat.id,
        content: "Synthetic bot reply.",
        authorName: null,
        role: "assistant",
        position: 2,
        createdAt: now(),
      };
      messages.push(reply);
      return json(reply);
    }
    return route.fulfill({ status: 404, json: { error: "fixture_path" } });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Good things grow together/i }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create free account" })
    .press("Enter");
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByLabel("Display name").fill("Synthetic Villager");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByLabel("Search members")).toBeVisible();

  await navigate(page, "Membership");
  await expect(page.getByText("Free member", { exact: true })).toBeVisible();
  premium = true;
  await page.reload();
  await expect(page.getByText("Premium member", { exact: true })).toBeVisible();

  await navigate(page, "Food deliveries");
  await page.getByLabel("Provider order ID").fill("SYNTHETIC-ORDER");
  await page
    .getByLabel("Restaurant", { exact: true })
    .fill("Synthetic Kitchen");
  await page.getByLabel("Delivery address").fill("Synthetic reception");
  await page.getByLabel("Subtotal (BRL)").fill("42,50");
  await page.getByRole("button", { name: "Log delivery" }).click();
  await expect(page.getByText("Delivery and expense saved.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Synthetic Kitchen", { exact: true }),
  ).toBeVisible();

  await navigate(page, "Engineering");
  await page
    .getByLabel("Title", { exact: true })
    .fill("Synthetic deployment review");
  await page.getByRole("button", { name: "Add work item" }).click();
  await page
    .getByRole("button", { name: "Move Synthetic deployment review to Done" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Done", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Done", exact: true }),
  ).toBeVisible();

  await navigate(page, "Bot chats");
  await page.getByRole("button", { name: "Manage bots" }).click();
  await page.getByRole("button", { name: "Create bot" }).click();
  await page.getByLabel("Bot name").fill("Synthetic private bot");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Use synthetic examples.");
  await page.getByRole("button", { name: "Save bot" }).click();
  await expect(
    page.getByRole("button", { name: "Edit Synthetic private bot" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to conversations" }).click();
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByLabel("Conversation title").fill("Synthetic conversation");
  await page.getByRole("button", { name: bot.name }).click();
  await page.getByRole("button", { name: "Start conversation" }).click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Synthetic private message.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Generate bot reply" }).click();
  await expect(
    page.getByText("Synthetic bot reply.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Synthetic conversation", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic private message.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic bot reply.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("members without a team see an access message on a bookmarked engineering page", async ({
  page,
}) => {
  await page.addInitScript(
    (accessToken) =>
      sessionStorage.setItem(
        "founder-village.session.v1",
        JSON.stringify({ accessToken, expiresAt: Date.now() + 900_000 }),
      ),
    randomUUID(),
  );
  await page.route("https://api.fv/v1/**", async (route) => {
    expect(["/v1/team/tenants", "/v1/food-deliveries/tenants"]).toContain(
      new URL(route.request().url()).pathname,
    );
    await route.fulfill({ json: [] });
  });
  await page.goto("/engineering");
  await expect(
    page.getByText("This area is for internal team members.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add work item" })).toHaveCount(
    0,
  );
  await navigate(page, "Home");
  await expect(
    page.getByRole("button", { name: "Bot chats", exact: true }),
  ).toHaveCount(0);
});
