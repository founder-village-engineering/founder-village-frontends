import { memo, useCallback, useEffect, useReducer, useRef } from "react";
import {
  messagesSchema,
  teamPageSize,
  type Bot,
  type Conversation,
  type Message,
} from "./generated/contracts/index.ts";
import { LongMessage } from "./LongMessage.tsx";
import { Composer } from "./Composer.tsx";
import { userError, type Client } from "./client.ts";

const formatDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const MessageRow = memo(function MessageRow({
  message,
  client,
  botName,
}: {
  message: Message;
  client: Client;
  botName?: string;
}) {
  const { authorName, role, createdAt } = message;
  const author =
    authorName ||
    (role === "user"
      ? "You"
      : role === "assistant"
        ? (botName ?? "Bot")
        : role);
  return (
    <article className={"message " + role}>
      <header>
        <strong>{author}</strong>{" "}
        <time dateTime={createdAt}>
          {formatDate.format(new Date(createdAt))}
        </time>
      </header>
      {message.nextOffset ? (
        <LongMessage client={client} message={message} />
      ) : (
        <p>{message.content}</p>
      )}
    </article>
  );
});

const Transcript = memo(function Transcript({
  rows,
  client,
  botName,
}: {
  rows: Message[];
  client: Client;
  botName?: string;
}) {
  return (
    <div
      className="messages"
      aria-label="Message history"
      role="log"
      aria-live="off"
    >
      {!rows.length && <p className="muted">Send the first message.</p>}
      {rows.map((message) => (
        <MessageRow
          client={client}
          key={message.id}
          message={message}
          botName={botName}
        />
      ))}
    </div>
  );
});

type HistoryPage = { rows: Message[]; next: string | null };
type State = {
  cursors: (string | null)[];
  page: HistoryPage | null;
  error: string;
};
type Action =
  | { type: "page"; page: HistoryPage }
  | { type: "error"; error: string }
  | { type: "go"; cursors: (string | null)[] }
  | { type: "saved"; message: Message };

const first: State = { cursors: [null], page: null, error: "" };
function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "page":
      return { ...state, page: action.page, error: "" };
    case "error":
      return { ...state, error: action.error };
    case "go":
      return { cursors: action.cursors, page: null, error: "" };
    case "saved": {
      if (state.cursors.length !== 1 || !state.page) return state;
      const { rows, next } = state.page;
      if (rows.some((m) => m.id === action.message.id)) return state;
      // Keep a bounded window on the latest page. Its cursor follows the earliest visible row.
      const updated = [...rows, action.message].sort(
        (a, b) => a.position - b.position,
      );
      const clipped = updated.length > teamPageSize;
      const visible = clipped ? updated.slice(-teamPageSize) : updated;
      return {
        ...state,
        page: { rows: visible, next: clipped ? visible[0]!.id : next },
      };
    }
  }
}

export const Thread = memo(function Thread({
  client,
  chat,
  bot,
  replies,
}: {
  client: Client;
  chat: Conversation;
  bot?: Bot;
  replies: boolean;
}) {
  return (
    <div className="thread">
      <header className="threadHead">
        <span className="context">
          {bot?.name ?? (chat.botId ? "Bot conversation" : "Private notes")}
        </span>
        <h1>{chat.title}</h1>
      </header>
      <History
        key={chat.id}
        client={client}
        base={"/team/conversations/" + chat.id}
        botName={bot?.name}
        replies={replies}
      />
    </div>
  );
});

function History({
  client,
  base,
  botName,
  replies,
}: {
  client: Client;
  base: string;
  botName?: string;
  replies: boolean;
}) {
  const [state, dispatch] = useReducer(reduce, first);
  const { page, cursors, error } = state;
  const atLatest = cursors.length === 1;
  const end = useRef<HTMLDivElement>(null);
  const onSaved = useCallback((message: Message) => {
    dispatch({ type: "saved", message });
    requestAnimationFrame(() =>
      end.current?.scrollIntoView({ block: "nearest" }),
    );
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const cursor = cursors.at(-1);
    const path =
      base +
      "/messages?order=newest" +
      (cursor ? "&after=" + encodeURIComponent(cursor) : "");
    void client
      .get(path, messagesSchema, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          dispatch({
            type: "page",
            page: { rows: result.items.toReversed(), next: result.next },
          });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          dispatch({ type: "error", error: userError(e) });
      });
    return () => controller.abort();
  }, [base, client, cursors]);
  const last = page?.rows.at(-1);
  return (
    <>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            onClick={() => dispatch({ type: "go", cursors: [...cursors] })}
          >
            Try again
          </button>
        </p>
      ) : !page ? (
        <p role="status">Loading messages…</p>
      ) : (
        <>
          {(page.next || !atLatest) && (
            <nav className="historyNav" aria-label="Message history pages">
              {page.next && (
                <button
                  onClick={() =>
                    dispatch({ type: "go", cursors: [...cursors, page.next] })
                  }
                >
                  Older messages
                </button>
              )}
              {!atLatest && (
                <button
                  onClick={() =>
                    dispatch({ type: "go", cursors: cursors.slice(0, -1) })
                  }
                >
                  Newer messages
                </button>
              )}
            </nav>
          )}
          <Transcript client={client} rows={page.rows} botName={botName} />
        </>
      )}
      <div ref={end} />
      <div hidden={!page || !atLatest}>
        <Composer
          client={client}
          base={base}
          botName={botName}
          replies={replies}
          replyTo={last?.role === "user" ? last.id : undefined}
          onSaved={onSaved}
        />
      </div>
    </>
  );
}
