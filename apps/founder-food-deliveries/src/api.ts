import {
  runtimeJson,
  type BrowserSession,
  type RuntimeConfig,
} from "@founder-village/frontend-platform";
import {
  foodDeliveriesResponseSchema,
  foodDeliveryInputSchema,
  foodDeliverySchema,
  founderExpensesResponseSchema,
  founderProfileSchema,
  founderTenantsResponseSchema,
  foundersApplicationId,
  type FoodDeliveryInput,
} from "./generated/contracts/index.ts";

export function foodDeliveryApi(
  config: RuntimeConfig,
  session: BrowserSession,
) {
  return {
    async tenants() {
      return founderTenantsResponseSchema.parse(
        await runtimeJson(config, "/food-deliveries/tenants", {
          session,
          application: foundersApplicationId,
        }),
      );
    },
    async profile(tenantId: string) {
      return founderProfileSchema.parse(
        await runtimeJson(config, "/founders/me", {
          session,
          application: foundersApplicationId,
          tenantId,
        }),
      );
    },
    async expenses(tenantId: string) {
      return founderExpensesResponseSchema.parse(
        await runtimeJson(config, "/expenses", {
          session,
          application: foundersApplicationId,
          tenantId,
        }),
      );
    },
    async deliveries(tenantId: string) {
      return foodDeliveriesResponseSchema.parse(
        await runtimeJson(config, "/food-deliveries", {
          session,
          application: foundersApplicationId,
          tenantId,
        }),
      );
    },
    async create(
      tenantId: string,
      input: FoodDeliveryInput,
      idempotencyKey: string,
    ) {
      return foodDeliverySchema.parse(
        await runtimeJson(config, "/food-deliveries", {
          session,
          application: foundersApplicationId,
          tenantId,
          method: "POST",
          body: foodDeliveryInputSchema.parse(input),
          idempotencyKey,
        }),
      );
    },
  };
}
