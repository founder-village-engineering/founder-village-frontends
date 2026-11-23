import {
  runtimeJson,
  RuntimeRequestError,
  type BrowserSession,
  type RuntimeConfig,
  type RuntimeRequest,
} from "@founder-village/frontend-platform";
import {
  applicationId,
  communityId,
  memberResponseSchema,
  directoryResponseSchema,
  contactResponseSchema,
  membershipSchema,
  checkoutResponseSchema,
  checkoutSchema,
  deletionResponseSchema,
  type ProfileInput,
  type PaymentMethod,
} from "./generated/contracts/index.ts";

export function memberApi(
  config: RuntimeConfig,
  session: BrowserSession,
  expired: () => void,
) {
  const fetchTransport: typeof fetch = (input, init) =>
    globalThis.fetch(input instanceof URL ? input.href : input, init);

  async function request(
    path: string,
    options?: Partial<
      Pick<RuntimeRequest, "method" | "body" | "idempotencyKey">
    >,
  ) {
    try {
      return await runtimeJson(
        config,
        `/members/${path}`,
        {
          application: applicationId,
          tenantId: communityId,
          session,
          ...options,
        },
        fetchTransport,
      );
    } catch (error) {
      if (error instanceof RuntimeRequestError && error.status === 401)
        expired();
      throw error;
    }
  }

  return {
    async profile() {
      return memberResponseSchema.parse(await request("me")).profile;
    },
    async saveProfile(profile: ProfileInput, create: boolean) {
      return memberResponseSchema.parse(
        await request(create ? "me" : "profile", {
          method: "POST",
          body: profile,
        }),
      ).profile;
    },
    async directory(query: string, after?: string) {
      const params = new URLSearchParams({ q: query });
      if (after) params.set("after", after);
      return directoryResponseSchema.parse(
        await request(`directory?${params}`),
      );
    },
    async whatsapp(id: string) {
      const { number } = contactResponseSchema.parse(
        await request(`directory/${id}/whatsapp`),
      );
      return `https://wa.me/${number.slice(1)}`;
    },
    async membership() {
      return membershipSchema.parse(await request("membership"));
    },
    async start(method: PaymentMethod, key: string) {
      return checkoutResponseSchema.parse(
        await request("checkout", {
          method: "POST",
          body: { method },
          idempotencyKey: key,
        }),
      );
    },
    async open(id: string) {
      return checkoutResponseSchema.parse(
        await request(`checkout/${id}/open`, { method: "POST" }),
      );
    },
    async check(id: string, signature?: string) {
      return checkoutSchema.parse(
        await request(`checkout/${id}/check`, {
          method: "POST",
          body: signature ? { signature } : {},
        }),
      );
    },
    async cancel(id: string) {
      return membershipSchema.parse(
        await request(`checkout/${id}/cancel`, { method: "POST" }),
      );
    },
    async deleteAccount() {
      return deletionResponseSchema.parse(
        await request("delete", { method: "POST", body: { confirm: true } }),
      );
    },
  };
}

export type MemberApi = ReturnType<typeof memberApi>;

export function actionError(error: unknown, fallback: string) {
  if (error instanceof RuntimeRequestError) {
    if (error.status === 401) return "Your session expired. Sign in again.";
    if (error.status === 429)
      return "Too many requests. Wait a moment and try again.";
    if (error.status === 409)
      return "The account or payment changed. Refresh and try again.";
  }
  return fallback;
}
