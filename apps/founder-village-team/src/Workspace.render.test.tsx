import { Profiler } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  teamPageSize,
  type Bot,
  type Conversation,
  type Message,
} from "./generated/contracts/index.ts";
import type { Client } from "./client.ts";
import { Workspace } from "./Workspace.tsx";

// Match the application's Vite alias in the shared Vitest environment.
vi.mock("react-native", async () => await vi.importActual("react-native-web"));

afterEach(() => {
  cleanup();
  history.replaceState({}, "", "/");
});

it("keeps transcript rows and bot configuration out of typing updates", async () => {
  const user = userEvent.setup();
  const counts = { rowReads: 0, configReads: 0, commits: 0 };
  const chatId = "11111111-1111-4111-8111-111111111111";
  const createdAt = "2026-01-01T12:00:00.000Z";
  const bot: Bot = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Fixture bot",
    description: "",
    configuration: {
      get skills() {
        counts.configReads++;
        return ["fixture"];
      },
    },
    instructions: "Fixture instructions",
    visibility: "private",
    canManage: true,
    createdAt,
  };
  const chat: Conversation = {
    id: chatId,
    title: "Workspace chat",
    botId: bot.id,
    createdAt,
  };
  // A read of content constructs a message row's JSX, even when React retains its DOM node.
  const messages: Message[] = Array.from({ length: 300 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    conversationId: chatId,
    role: "user",
    position: index + 1,
    authorName: null,
    createdAt,
    get content() {
      counts.rowReads++;
      return "Fixture message " + (index + 1);
    },
  }));
  const directoryBot = { ...bot, instructions: null, configuration: null };
  const client = {
    get: vi.fn(async (path: string) => {
      switch (path) {
        case "/team/capabilities":
          return { repliesAvailable: false };
        case "/team/bots?view=directory":
          return { items: [directoryBot], next: null };
        case "/team/bots/" + bot.id + "?view=directory":
          return directoryBot;
        case "/team/conversations":
          return {
            items: [
              chat,
              {
                ...chat,
                id: "44444444-4444-4444-8444-444444444444",
                title: "Planning",
              },
            ],
            next: null,
          };
        case "/team/conversations/" + chatId:
          return chat;
        case "/team/bots/" + bot.id:
          return bot;
        case "/team/conversations/" + chatId + "/messages?order=newest": {
          const items = messages.slice(-teamPageSize).reverse();
          return { items, next: items.at(-1)!.id };
        }
        default:
          throw new Error("Unexpected fixture route");
      }
    }),
    post: vi.fn(),
  } as unknown as Client;
  history.replaceState({}, "", "#" + chatId);
  render(
    <Profiler
      id="workspace"
      onRender={() => {
        counts.commits++;
      }}
    >
      <Workspace client={client} name="Test team" />
    </Profiler>,
  );
  await screen.findByText("Fixture message 300");
  expect(counts.rowReads).toBe(teamPageSize);
  async function typeFour(
    input: HTMLInputElement | HTMLTextAreaElement,
    text: string,
  ) {
    const before = { ...counts };
    // Count deferred filter work against the interaction that scheduled it.
    vi.useFakeTimers();
    try {
      for (const char of text) {
        fireEvent.input(input, { target: { value: input.value + char } });
      }
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
    } finally {
      vi.useRealTimers();
    }
    return {
      rowReads: counts.rowReads - before.rowReads,
      configReads: counts.configReads - before.configReads,
      commits: counts.commits - before.commits,
    };
  }
  await screen.findByRole("button", { name: "Planning" });
  const filter = await typeFour(
    screen.getByLabelText("Find a conversation"),
    "work",
  );
  expect(screen.queryByRole("button", { name: "Planning" })).toBeNull();
  const composer = await typeFour(screen.getByLabelText("Message"), "note");
  expect(screen.getByLabelText<HTMLTextAreaElement>("Message").value).toBe(
    "note",
  );
  await user.click(screen.getByRole("button", { name: /Team bots/i }));
  const configure = await screen.findByRole("button", { name: "Configure" });
  expect(counts.configReads).toBe(0);
  await user.click(configure);
  await screen.findByText("Imported configuration");
  expect(counts.configReads).toBeGreaterThan(0);
  const edit = await typeFour(screen.getByLabelText("Description"), "edit");
  expect(screen.getByLabelText<HTMLInputElement>("Description").value).toBe(
    "edit",
  );
  expect({ filter, composer, edit }).toEqual({
    filter: { rowReads: 0, configReads: 0, commits: 1 },
    composer: { rowReads: 0, configReads: 0, commits: 0 },
    edit: { rowReads: 0, configReads: 0, commits: 0 },
  });
});
