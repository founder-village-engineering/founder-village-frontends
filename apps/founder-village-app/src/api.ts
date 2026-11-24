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
} from "./generated/contracts/features/founder-village-members/index.ts";

export function createRequester(
  config: RuntimeConfig,
  session: BrowserSession,
  expired: () => void,
): (
  path: string,
  request: Omit<RuntimeRequest, "session">,
) => Promise<unknown> {
  const fetchTransport: typeof fetch = (input, init) =>
    globalThis.fetch(input instanceof URL ? input.href : input, init);

  return async (path, request) => {
    try {
      return await runtimeJson(
        config,
        path,
        { ...request, session },
        fetchTransport,
      );
    } catch (error) {
      if (
        !request.signal?.aborted &&
        error instanceof RuntimeRequestError &&
        error.status === 401
      )
        expired();
      throw error;
    }
  };
}

export type Requester = ReturnType<typeof createRequester>;

export function memberApi(send: Requester) {
  const request = (
    path: string,
    options?: Partial<
      Pick<RuntimeRequest, "method" | "body" | "idempotencyKey" | "signal">
    >,
  ) =>
    send(`/v1/members/${path}`, {
      application: applicationId,
      tenantId: communityId,
      ...options,
    });

  return {
    async profile(signal?: AbortSignal) {
      return memberResponseSchema.parse(await request("me", { signal }))
        .profile;
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
