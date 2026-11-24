import {
  lazy,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { z } from "zod";
import {
  capabilitiesSchema,
  botsSchema,
  botSchema,
  conversationsSchema,
  conversationSchema,
  conversationInputSchema,
  type Bot,
  type Conversation,
} from "./generated/contracts/index.ts";
import { useAction, userError, type Client } from "./client.ts";
import { Collection, useEntity } from "./collection.ts";
import { Sidebar, BotPicker, type View } from "./Directories.tsx";
import { Thread } from "./Thread.tsx";
import { BotEditor, RequiredSubmit } from "./BotEditor.tsx";

const BotDirectory = lazy(() => import("./BotDirectory.tsx"));

const initialView = (): View => {
  const id = location.hash.slice(1);
  return z.uuid().safeParse(id).success
    ? { kind: "thread", id }
    : { kind: "new" };
};
export const Workspace = memo(function Workspace({
  client,
  name,
}: {
  client: Client;
  name: string;
}) {
  const [view, setView] = useState<View>(initialView);
  const chats = useMemo(
    () =>
      new Collection(
        client,
        "/team/conversations",
        conversationsSchema,
        conversationSchema,
      ),
    [client],
  );
  const bots = useMemo(
    () =>
      new Collection(client, "/team/bots", botsSchema, botSchema, "directory"),
    [client],
  );
  const capabilities = useMemo(() => {
    let pending: ReturnType<typeof load> | undefined;
    function load() {
      return client.get("/team/capabilities", capabilitiesSchema);
    }
    return () =>
      (pending ??= load().catch((error) => {
        pending = undefined;
        throw error;
      }));
  }, [client]);
  const open = useCallback((next: View) => {
    setView(next);
    history.replaceState(
      {},
      "",
      next.kind === "thread" ? "#" + next.id : location.pathname,
    );
  }, []);
  const showBots = useCallback(() => open({ kind: "bots" }), [open]);
  const saveBot = useCallback(
    (bot: Bot) => {
      bots.save({ ...bot, instructions: null, configuration: null });
      showBots();
    },
    [bots, showBots],
  );
  const saveConversation = useCallback(
    (chat: Conversation) => {
      chats.save(chat);
      open({ kind: "thread", id: chat.id });
    },
    [chats, open],
  );
  return (
    <div className="workspace">
      <Sidebar chats={chats} bots={bots} name={name} open={open} view={view} />
      <section className="panel">
        {view.kind === "bots" ? (
          <Suspense fallback={<p role="status">Loading bots…</p>}>
            <BotDirectory bots={bots} open={open} />
          </Suspense>
        ) : view.kind === "bot" ? (
          <BotPanel
            key={view.id ?? "create"}
            client={client}
            id={view.id}
            done={saveBot}
            cancel={showBots}
          />
        ) : view.kind === "new" ? (
          <NewConversation
            key={view.botId ?? "new"}
            client={client}
            bots={bots}
            initialBot={view.botId}
            done={saveConversation}
          />
        ) : (
          <ThreadPanel
            key={view.id}
            client={client}
            chats={chats}
            bots={bots}
            id={view.id}
            capabilities={capabilities}
          />
        )}
      </section>
    </div>
  );
});
function Failure({ error, retry }: { error: string; retry: () => void }) {
  return (
    <>
      <p role="alert">{error}</p>
      <button onClick={retry}>Try again</button>
    </>
  );
}
function ThreadPanel({
  client,
  chats,
  bots,
  id,
  capabilities,
}: {
  client: Client;
  chats: Collection<Conversation>;
  bots: Collection<Bot>;
  id: string;
  capabilities: () => Promise<{ repliesAvailable: boolean }>;
}) {
  const chat = useEntity(chats, id),
    bot = useEntity(bots, chat.record?.botId ?? undefined);
  const [info, setInfo] = useState<{ repliesAvailable: boolean }>();
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void capabilities()
      .then((cap) => {
        if (live) setInfo(cap);
      })
      .catch((e) => {
        if (live) setFailure(userError(e));
      });
    return () => {
      live = false;
    };
  }, [capabilities, attempt]);
  if (chat.error) return <Failure error={chat.error} retry={chat.retry} />;
  if (failure)
    return (
      <Failure
        error={failure}
        retry={() => {
          setFailure("");
          setAttempt((n) => n + 1);
        }}
      />
    );
  if (!chat.record || !info || (chat.record.botId && !bot.record && !bot.error))
    return <p role="status">Opening conversation…</p>;
  // A retained private chat remains readable when access to its bot has been revoked.
  return (
    <Thread
      client={client}
      chat={chat.record}
      bot={bot.record}
      replies={info.repliesAvailable}
    />
  );
}
function BotPanel({
  client,
  id,
  done,
  cancel,
}: {
  client: Client;
  id?: string;
  done: (bot: Bot) => void;
  cancel: () => void;
}) {
  // Manager instructions are requested only when opening the configuration editor.
  const [bot, setBot] = useState<Bot>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void client
      .get("/team/bots/" + encodeURIComponent(id), botSchema)
      .then((row) => {
        if (row.id !== id) throw new Error("Unexpected bot");
        if (live) setBot(row);
      })
      .catch((e) => {
        if (live) setError(userError(e));
      });
    return () => {
      live = false;
    };
  }, [id, client, attempt]);
  if (error)
    return (
      <Failure
        error={error}
        retry={() => {
          setError("");
          setAttempt((n) => n + 1);
        }}
      />
    );
  if (id && !bot) return <p role="status">Loading bot…</p>;
  if (bot && !bot.canManage)
    return <p role="alert">You no longer have access to configure this bot.</p>;
  return <BotEditor client={client} bot={bot} done={done} cancel={cancel} />;
}
function NewConversation({
  client,
  bots,
  initialBot,
  done,
}: {
  client: Client;
  bots: Collection<Bot>;
  initialBot?: string;
  done: (chat: Conversation) => void;
}) {
  const action = useAction();
  return (
    <section className="editor">
      <h1>New conversation</h1>
      <p>Only you can read this conversation.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const body = conversationInputSchema.parse({
            title: data.get("title"),
            botId: data.get("botId") || null,
          });
          void action.run(body, async (key) =>
            done(
              await client.post(
                "/team/conversations",
                body,
                key,
                conversationSchema,
              ),
            ),
          );
        }}
      >
        <label>
          Conversation title
          <input
            name="title"
            required
            pattern={".*\\S.*"}
            maxLength={240}
            autoComplete="off"
          />
        </label>
        <BotPicker bots={bots} initialBot={initialBot} />
        {action.error && <p role="alert">{action.error}</p>}
        <RequiredSubmit field="title" busy={action.busy}>
          Start conversation
        </RequiredSubmit>
      </form>
    </section>
  );
}
