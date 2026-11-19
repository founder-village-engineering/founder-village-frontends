import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

const tenantId = "11111111-1111-4111-8111-111111111111";
const founderId = "33333333-3333-4333-8333-333333333333";
const companyId = "55555555-5555-4555-8555-555555555555";
const deliveryId = "77777777-7777-4777-8777-777777777777";
const expenseId = "88888888-8888-4888-8888-888888888888";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("food delivery expense journey", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.__FOUNDER_VILLAGE_CONFIG__ = {
      apiOrigin: "https://api.example.test",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an honest sign-in state before private founder data loads", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", {
        name: /record food orders.*keep the village tab clear/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /connect your founder account/i }),
    ).toBeVisible();
    expect(
      screen.getByText(/production sign-in has not been configured/i),
    ).toBeVisible();
  });

  it("loads the founder profile and creates one matching food expense", async () => {
    sessionStorage.setItem(
      "founder-village.session.v1",
      JSON.stringify({
        accessToken: "synthetic",
        expiresAt: Date.now() + 60_000,
      }),
    );
    const placedAt = new Date().toISOString();
    const expectedAt = new Date(Date.now() + 3_600_000).toISOString();
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        expect(headers.get("x-application-id")).toBe("founders");
        if (url.pathname === "/food-deliveries/tenants")
          return response([{ id: tenantId, name: "Garden House" }]);
        if (url.pathname === "/founders/me")
          return response({
            id: founderId,
            tenantId,
            fullName: "Alex Founder",
            email: "alex@example.test",
            room: "Room 8",
            companies: [{ id: companyId, name: "Canopy Labs" }],
            balance: { currency: "BRL", balanceCents: 0 },
          });
        if (url.pathname === "/food-deliveries" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            provider: string;
            subtotalCents: number;
            deliveryFeeCents: number;
            serviceFeeCents: number;
          };
          expect(body).toMatchObject({
            provider: "ifood",
            subtotalCents: 5400,
            deliveryFeeCents: 700,
            serviceFeeCents: 300,
          });
          return response(
            {
              id: deliveryId,
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
              expectedAt,
              expenseId,
              expenseStatus: "posted",
              placedAt,
              createdAt: placedAt,
            },
            201,
          );
        }
        if (url.pathname === "/food-deliveries") return response([]);
        return response({ error: "not_found" }, 404);
      },
    );
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    const user = userEvent.setup();

    expect(await screen.findByText("Alex Founder")).toBeVisible();
    expect(screen.getByText("Canopy Labs")).toBeVisible();
    await user.type(screen.getByLabelText(/ifood order id/i), "IFOOD-1234");
    await user.type(screen.getByLabelText(/restaurant/i), "Synthetic Kitchen");
    await user.type(screen.getByLabelText("Food subtotal"), "54");
    await user.clear(screen.getByLabelText("Delivery fee"));
    await user.type(screen.getByLabelText("Delivery fee"), "7");
    await user.clear(screen.getByLabelText("Service fee"));
    await user.type(screen.getByLabelText("Service fee"), "3");
    await user.click(
      screen.getByRole("button", { name: /record delivery & expense/i }),
    );

    expect(
      await screen.findByText(/one posted expense was added/i),
    ).toBeVisible();
    expect(screen.getByText("Synthetic Kitchen")).toBeVisible();
    expect(screen.getByText(/expense posted/i)).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getAllByText((text) => text.replace(/\s/g, "") === "R$64,00")
          .length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/food-deliveries" }),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
