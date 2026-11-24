import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import {
  runtimeJson,
  RuntimeRequestError,
  uuid,
  type BrowserSession,
  type RuntimeConfig,
} from "@founder-village/frontend-platform";
import { applicationId } from "./generated/contracts/index.ts";

export function teamClient(
  config: RuntimeConfig,
  session: BrowserSession,
  tenantId?: string,
) {
  async function get<T>(
    path: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return schema.parse(
      await runtimeJson(config, path, {
        application: applicationId,
        session,
        tenantId,
        signal,
      }),
    );
  }
  return {
    get,
    async post<T>(
      path: string,
      body: unknown,
      key: string,
      schema: z.ZodType<T>,
    ) {
      return schema.parse(
        await runtimeJson(config, path, {
          application: applicationId,
          session,
          tenantId,
          method: "POST",
          body,
          idempotencyKey: key,
          timeoutMs: path.endsWith("/replies") ? 32_000 : undefined,
        }),
      );
    },
  };
}
export type Client = ReturnType<typeof teamClient>;

export function userError(error: unknown) {
  if (error instanceof RuntimeRequestError) {
    if (error.status === 401) return "Your session expired. Sign in again.";
    if (error.status === 403 || error.status === 404)
      return "You no longer have access to this item.";
    if (error.status === 409)
      return "The record has changed. Refresh and try again.";
    if (error.status === 429) return "Too many requests. Try again shortly.";
  }
  return "The workspace could not complete that request. Try again.";
}

// Preserve the request key when an uncertain write is retried without edits.
export function useAction() {
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const active = useRef(false);
  const [status, setStatus] = useState<{ busy: boolean; error: string }>({
    busy: false,
    error: "",
  });
  const run = useCallback(
    async (input: unknown, perform: (key: string) => Promise<void>) => {
      if (active.current) return;
      active.current = true;
      setStatus({ busy: true, error: "" });
      try {
        const fingerprint = JSON.stringify(input);
        if (request.current?.fingerprint !== fingerprint)
          request.current = { fingerprint, key: uuid() };
        await perform(request.current.key);
        request.current = null;
        setStatus({ busy: false, error: "" });
      } catch (error) {
        setStatus({ busy: false, error: userError(error) });
      } finally {
        active.current = false;
      }
    },
    [],
  );
  return { run, ...status };
}
