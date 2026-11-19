import { expect, test } from "@playwright/test";

const tenantId = "11111111-1111-4111-8111-111111111111";
const founderId = "33333333-3333-4333-8333-333333333333";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "founder-village.session.v1",
      JSON.stringify({
        accessToken: "synthetic",
        expiresAt: Date.now() + 3_600_000,
      }),
    );
  });
  await page.route("https://api.fv/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    expect(await request.headerValue("x-application-id")).toBe("founders");
    if (path === "/food-deliveries/tenants")
      return route.fulfill({ json: [{ id: tenantId, name: "Garden House" }] });
    if (path === "/founders/me")
      return route.fulfill({
        json: {
          id: founderId,
          tenantId,
          fullName: "Alex Founder",
          email: "alex@example.test",
          room: "Room 8",
          companies: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              name: "Canopy Labs",
            },
            {
              id: "66666666-6666-4666-8666-666666666666",
              name: "Open Courtyard",
            },
          ],
          balance: { currency: "BRL", balanceCents: 1250 },
        },
      });
    if (path === "/food-deliveries" && request.method() === "POST")
      return route.fulfill({
        status: 201,
        json: {
          id: "77777777-7777-4777-8777-777777777777",
          provider: "ifood",
          providerOrderId: "IFOOD-1234",
          restaurantName: "Synthetic Kitchen",
          deliveryAddress: "Founder Village reception",
          subtotalCents: 5400,
          deliveryFeeCents: 700,
          serviceFeeCents: 300,
          totalCents: 6400,
          currency: "BRL",
          status: "placed",
          expectedAt: new Date(Date.now() + 3_600_000).toISOString(),
          expenseId: "88888888-8888-4888-8888-888888888888",
          expenseStatus: "posted",
          placedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      });
    if (path === "/food-deliveries") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
});

test("records a food delivery and its matching expense", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /record food orders.*keep the village tab clear/i,
    }),
  ).toBeVisible();
  await expect(page.getByText("Alex Founder")).toBeVisible();
  await expect(page.getByText("Canopy Labs")).toBeVisible();

  await page.getByLabel(/ifood order id/i).fill("IFOOD-1234");
  await page.getByLabel(/restaurant/i).fill("Synthetic Kitchen");
  await page.getByLabel("Food subtotal").fill("54");
  await page.getByLabel("Delivery fee").fill("7");
  await page.getByLabel("Service fee").fill("3");
  await page
    .getByRole("button", { name: /record delivery & expense/i })
    .click();

  await expect(page.getByText(/one posted expense was added/i)).toBeVisible();
  await expect(
    page.getByRole("list").getByText("Synthetic Kitchen"),
  ).toBeVisible();
  await expect(
    page.getByRole("list").getByText(/expense posted/i),
  ).toBeVisible();
  if (process.env.FV_CAPTURE_QA === "1")
    await page.screenshot({
      path: testInfo.outputPath("food-deliveries.png"),
      fullPage: true,
    });
});
