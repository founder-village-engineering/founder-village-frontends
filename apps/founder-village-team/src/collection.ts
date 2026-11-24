import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { userError, type Client } from "./client.ts";
type Entity = { id: string };
type Page<T> = { items: T[]; next: string | null };
type Snapshot<T> = Page<T> & {
  ready: boolean;
  loading: boolean;
  error: string;
};

// Each mounted tenant owns its cache. Paging the sidebar never updates the workspace or the active chat.
export class Collection<T extends Entity> {
  private snapshot: Snapshot<T> = {
    items: [],
    next: null,
    ready: false,
    loading: false,
    error: "",
  };
  private readonly listeners = new Set<() => void>();
  private readonly listed = new Set<string>();
  private readonly byId = new Map<string, T>();
  private readonly cursors = new Set<string>();
  private readonly individual = new Map<string, Promise<T>>();
  private pending?: Promise<void>;
  constructor(
    private client: Client,
    private path: string,
    private pageSchema: z.ZodType<Page<T>>,
    private itemSchema: z.ZodType<T>,
    private view?: "directory",
  ) {}
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };
  read = () => this.snapshot;
  cached = (id: string) => this.byId.get(id);
  private notify() {
    for (const notify of this.listeners) notify();
  }
  private update(next: Snapshot<T>) {
    this.snapshot = next;
    this.notify();
  }
  private url(id?: string, after?: string) {
    const params = new URLSearchParams();
    if (this.view) params.set("view", this.view);
    if (after) params.set("after", after);
    const query = params.toString();
    return (
      this.path +
      (id ? "/" + encodeURIComponent(id) : "") +
      (query ? "?" + query : "")
    );
  }
  nextPage = (): Promise<void> => {
    if (this.pending) return this.pending;
    const { ready, next } = this.snapshot;
    if (ready && !next) return Promise.resolve();
    this.pending = this.client
      .get(this.url(undefined, next ?? undefined), this.pageSchema)
      .then((page) => {
        if (page.next && this.cursors.has(page.next))
          throw new Error("Invalid page cursor");
        if (page.next) this.cursors.add(page.next);
        const added: T[] = [];
        for (const row of page.items) {
          if (this.listed.has(row.id)) continue;
          const value = this.byId.get(row.id) ?? row;
          this.listed.add(value.id);
          this.byId.set(value.id, value);
          added.push(value);
        }
        this.pending = undefined;
        this.update({
          items: [...this.snapshot.items, ...added],
          next: page.next,
          ready: true,
          loading: false,
          error: "",
        });
      })
      .catch((error) => {
        this.pending = undefined;
        this.update({
          ...this.snapshot,
          loading: false,
          error: userError(error),
        });
      });
    this.update({ ...this.snapshot, loading: true, error: "" });
    return this.pending;
  };
  async one(id: string): Promise<T> {
    // The opening page may already contain a bookmarked record.
    if (!this.byId.has(id) && this.pending) await this.pending;
    const cached = this.byId.get(id);
    if (cached) return cached;
    let request = this.individual.get(id);
    if (!request) {
      request = this.client
        .get(this.url(id), this.itemSchema)
        .then((row) => {
          if (row.id !== id) throw new Error("Unexpected record identifier");
          const current = this.byId.get(id) ?? row;
          this.byId.set(id, current);
          this.notify();
          return current;
        })
        .finally(() => {
          this.individual.delete(id);
        });
      this.individual.set(id, request);
    }
    return request;
  }
  save(row: T) {
    this.listed.add(row.id);
    this.byId.set(row.id, row);
    this.update({
      ...this.snapshot,
      items: [
        row,
        ...this.snapshot.items.filter((other) => other.id !== row.id),
      ],
    });
  }
}
export function usePage<T extends Entity>(collection: Collection<T>) {
  const state = useSyncExternalStore(collection.subscribe, collection.read);
  useEffect(() => {
    if (!collection.read().ready && !collection.read().error)
      void collection.nextPage();
  }, [collection]);
  return state;
}
export function useEntity<T extends Entity>(
  collection: Collection<T>,
  id?: string,
) {
  const snapshot = useCallback(
    () => (id ? collection.cached(id) : undefined),
    [collection, id],
  );
  const record = useSyncExternalStore(collection.subscribe, snapshot);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id || record) return;
    let live = true;
    setError("");
    void collection.one(id).catch((e) => {
      if (live) setError(userError(e));
    });
    return () => {
      live = false;
    };
  }, [collection, id, record, attempt]);
  return { record, error, retry: () => setAttempt((n) => n + 1) };
}
