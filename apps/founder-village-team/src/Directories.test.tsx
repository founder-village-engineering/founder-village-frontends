import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Collection } from "./collection.ts";
import { ConversationList } from "./Directories.tsx";
import type { Client } from "./client.ts";
import {
  conversationSchema,
  conversationsSchema,
  teamPageSize,
  type Conversation,
} from "./generated/contracts/index.ts";

afterEach(cleanup);

it.each(["kept", "cleared"] as const)(
  "loads older matching conversations only while the search is %s",
  async (mode) => {
    function chat(n: number, title: string): Conversation {
      return {
        id: `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`,
        title,
        botId: null,
        createdAt: "2026-01-01T12:00:00.000Z",
      };
    }
    const items = Array.from({ length: teamPageSize }, (_, i) =>
      chat(i, "Conversation " + (i + 1)),
    );
    const cursor = items.at(-1)!.id;
    const match = chat(teamPageSize, "Older budget review");
    const calls: string[] = [];
    let release!: () => void;
    const waiting = new Promise<void>((done) => {
      release = done;
    });
    const client: Client = {
      async get(path, schema) {
        calls.push(path);
        if (path === "/team/conversations")
          return schema.parse({ items, next: cursor });
        if (path === "/team/conversations?after=" + cursor) {
          await waiting;
          return schema.parse({
            items: [match],
            next: mode === "cleared" ? match.id : null,
          });
        }
        throw new Error("Unrequested fixture page");
      },
      post: vi.fn(),
    };
    const chats = new Collection(
      client,
      "/team/conversations",
      conversationsSchema,
      conversationSchema,
    );
    render(<ConversationList chats={chats} open={vi.fn()} />);
    await screen.findByRole("button", { name: "Conversation 1" });
    expect(calls).toEqual(["/team/conversations"]);
    const input = screen.getByLabelText("Find a conversation");
    vi.useFakeTimers();
    try {
      fireEvent.input(input, { target: { value: "budget" } });
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      expect(calls).toEqual([
        "/team/conversations",
        "/team/conversations?after=" + cursor,
      ]);
      if (mode === "cleared") fireEvent.input(input, { target: { value: "" } });
      await act(async () => {
        release();
        await waiting;
      });
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      expect(calls).toHaveLength(2);
      expect(
        screen.getByRole("button", {
          name: mode === "cleared" ? "Conversation 1" : "Older budget review",
        }),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  },
);
