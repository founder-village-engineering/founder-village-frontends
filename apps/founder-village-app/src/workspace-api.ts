import { applicationId } from "./generated/contracts/index";
import type { z } from "zod";
import type { Requester } from "./api";
import {
  founderTenantsResponseSchema,
  founderProfileSchema,
  foodDeliveriesResponseSchema,
  foodDeliveryInputSchema,
  foodDeliverySchema,
  type FoodDeliveryInput,
} from "./generated/contracts/food-deliveries";
import {
  applicationId as teamApplicationId,
  tenantsSchema,
  capabilitiesSchema,
  botInputSchema,
  botUpdateSchema,
  botSchema,
  botsSchema,
  conversationsSchema,
  conversationSchema,
  conversationInputSchema,
  messagesSchema,
  messageSchema,
  messageInputSchema,
  messageContentChunkSchema,
  replyInputSchema,
  type Bot,
} from "./generated/contracts/features/founder-village-team/index";
import {
  engineeringInputSchema,
  engineeringItemSchema,
  engineeringPageSchema,
  engineeringUpdateSchema,
  type EngineeringInput,
  type EngineeringStatus,
} from "./generated/contracts/features/founder-village-team/engineering";

export type Workspace = { id: string; name: string };

function query(
  path: string,
  after: string | undefined,
  params?: Record<string, string>,
) {
  const search = new URLSearchParams(params);
  if (after) search.set("after", after);
  const encoded = search.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function workspaceApi(send: Requester) {
  const get = async <T>(
    application: string,
    path: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    tenantId?: string,
  ) =>
    schema.parse(await send(`/v1${path}`, { application, tenantId, signal }));

  const post = async <T>(
    application: string,
    tenantId: string,
    path: string,
    schema: z.ZodType<T>,
    body: unknown,
    idempotencyKey: string,
    timeoutMs?: number,
  ) =>
    schema.parse(
      await send(`/v1${path}`, {
        application,
        tenantId,
        body,
        idempotencyKey,
        timeoutMs,
        method: "POST",
      }),
    );

  return {
    deliveryWorkspaces: (signal: AbortSignal) =>
      get(
        applicationId,
        "/food-deliveries/tenants",
        founderTenantsResponseSchema,
        signal,
      ),
    teamWorkspaces: (signal: AbortSignal) =>
      get(teamApplicationId, "/team/tenants", tenantsSchema, signal),
    deliveries(tenantId: string) {
      return {
        profile: (signal: AbortSignal) =>
          get(
            applicationId,
            "/founders/me",
            founderProfileSchema,
            signal,
            tenantId,
          ),
        orders: (signal: AbortSignal) =>
          get(
            applicationId,
            "/food-deliveries",
            foodDeliveriesResponseSchema,
            signal,
            tenantId,
          ),
        create: (input: FoodDeliveryInput, key: string) =>
          post(
            applicationId,
            tenantId,
            "/food-deliveries",
            foodDeliverySchema,
            foodDeliveryInputSchema.parse(input),
            key,
          ),
      };
    },
    team(tenantId: string) {
      const read = <T>(
        path: string,
        schema: z.ZodType<T>,
        signal?: AbortSignal,
      ) => get(teamApplicationId, `/team${path}`, schema, signal, tenantId);
      const write = <T>(
        path: string,
        schema: z.ZodType<T>,
        body: unknown,
        key: string,
        timeout?: number,
      ) =>
        post(
          teamApplicationId,
          tenantId,
          `/team${path}`,
          schema,
          body,
          key,
          timeout,
        );
      const itemsPath = "/engineering/items";
      const chatsPath = "/conversations";
      return {
        items: (after: string | undefined, signal: AbortSignal) =>
          read(query(itemsPath, after), engineeringPageSchema, signal),
        createItem: (input: EngineeringInput, key: string) =>
          write(
            itemsPath,
            engineeringItemSchema,
            engineeringInputSchema.parse(input),
            key,
          ),
        updateStatus: (
          id: string,
          status: EngineeringStatus,
          revision: number,
          key: string,
        ) =>
          write(
            `${itemsPath}/${id}/status`,
            engineeringItemSchema,
            engineeringUpdateSchema.parse({ status, revision }),
            key,
          ),
        capabilities: (signal: AbortSignal) =>
          read("/capabilities", capabilitiesSchema, signal),
        bots: (after: string | undefined, signal: AbortSignal) =>
          read(
            query("/bots", after, { view: "directory" }),
            botsSchema,
            signal,
          ),
        bot: (id: string, signal: AbortSignal) =>
          read(`/bots/${id}`, botSchema, signal),
        saveBot: (
          input: {
            name: string;
            description: string;
            instructions: string;
            visibility: "private" | "team";
          },
          key: string,
          existing?: Bot,
        ) => {
          if (existing) {
            const { name, description, instructions } = input;
            return write(
              `/bots/${existing.id}`,
              botSchema,
              botUpdateSchema.parse({ name, description, instructions }),
              key,
            );
          }
          return write("/bots", botSchema, botInputSchema.parse(input), key);
        },
        conversations: (after: string | undefined, signal: AbortSignal) =>
          read(query(chatsPath, after), conversationsSchema, signal),
        startChat: (title: string, botId: string | null, key: string) =>
          write(
            chatsPath,
            conversationSchema,
            conversationInputSchema.parse({ title, botId }),
            key,
          ),
        messages: (
          id: string,
          after: string | undefined,
          signal: AbortSignal,
        ) =>
          read(
            query(`${chatsPath}/${id}/messages`, after, { order: "newest" }),
            messagesSchema,
            signal,
          ),
        messageContent: (
          id: string,
          messageId: string,
          offset: number,
          signal: AbortSignal,
        ) =>
          read(
            `${chatsPath}/${id}/messages/${messageId}/content?offset=${offset}`,
            messageContentChunkSchema,
            signal,
          ),
        sendMessage: (id: string, content: string, key: string) =>
          write(
            `${chatsPath}/${id}/messages`,
            messageSchema,
            messageInputSchema.parse({ content }),
            key,
          ),
        reply: (id: string, messageId: string, key: string) =>
          write(
            `${chatsPath}/${id}/replies`,
            messageSchema,
            replyInputSchema.parse({ messageId }),
            key,
            32_000,
          ),
      };
    },
  };
}

export type WorkspaceApi = ReturnType<typeof workspaceApi>;
export type DeliveriesApi = ReturnType<WorkspaceApi["deliveries"]>;
export type TeamApi = ReturnType<WorkspaceApi["team"]>;
