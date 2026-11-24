import { useCallback, useEffect, useRef, useState } from "react";
import { RuntimeRequestError } from "@founder-village/frontend-platform";
import { newRequestKey } from "./session";

type Loader<T> = (signal: AbortSignal) => Promise<T>;
type Result<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

function requestError(error: unknown, fallback: string) {
  if (error instanceof RuntimeRequestError) {
    if (error.status === 401) return "Your session expired. Sign in again.";
    if (error.status === 403 || error.status === 404)
      return "Your account cannot access this item.";
    if (error.status === 409)
      return "The request conflicts with a saved record. Refresh and try again.";
    if (error.status === 429)
      return "Too many requests. Wait a moment and try again.";
  }
  return fallback;
}

export function useResource<T>(load: Loader<T>, fallback: string) {
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{
    load: Loader<T>;
    attempt: number;
    result: Result<T>;
  }>();
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    function finish(result: Result<T>) {
      if (!controller.signal.aborted) setResponse({ load, attempt, result });
    }
    void load(controller.signal)
      .then((data) => finish({ status: "ready", data }))
      .catch((error: unknown) =>
        finish({ status: "error", message: requestError(error, fallback) }),
      );
    return () => controller.abort();
  }, [load, fallback, attempt]);

  const result: Result<T> =
    response?.load === load && response.attempt === attempt
      ? response.result
      : { status: "loading" };
  return { ...result, retry };
}

type Page<T> = { items: T[]; next: string | null };

export function usePage<T>(
  load: (after: string | undefined, signal: AbortSignal) => Promise<Page<T>>,
  fallback: string,
) {
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors.at(-1);
  const read = useCallback(
    (signal: AbortSignal) => load(after, signal),
    [load, after],
  );
  const state = useResource(read, fallback);
  return {
    state,
    previous: cursors.length
      ? () => setCursors(cursors.slice(0, -1))
      : undefined,
    next:
      state.status === "ready" && state.data.next
        ? () => setCursors([...cursors, state.data.next!])
        : undefined,
    restart: () => {
      setCursors([]);
      state.retry();
    },
  };
}

export function useWrite(fallback: string) {
  const last = useRef<{ fingerprint: string; key: string } | undefined>(
    undefined,
  );
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run<T>(
    input: object | string,
    perform: (key: string) => Promise<T>,
  ): Promise<T | undefined> {
    if (pending.current) return undefined;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const fingerprint = JSON.stringify(input);
      if (last.current?.fingerprint !== fingerprint)
        last.current = { fingerprint, key: newRequestKey() };
      const result = await perform(last.current.key);
      last.current = undefined;
      return result;
    } catch (error) {
      setError(requestError(error, fallback));
      return undefined;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error };
}
