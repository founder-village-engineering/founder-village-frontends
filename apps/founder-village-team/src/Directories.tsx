import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Conversation, Bot } from "./generated/contracts/index.ts";
import { Collection, usePage } from "./collection.ts";
export type View =
  | { kind: "new"; botId?: string }
  | { kind: "thread"; id: string }
  | { kind: "bots" }
  | { kind: "bot"; id?: string };
export type Navigate = (view: View) => void;
const PAGE_SIZE = 30;

const ChatRow = memo(function ChatRow({
  chat,
  active,
  open,
}: {
  chat: Conversation;
  active: boolean;
  open: Navigate;
}) {
  return (
    <button
      className={"navItem " + (active ? "active" : "")}
      aria-current={active ? "page" : undefined}
      onClick={() => open({ kind: "thread", id: chat.id })}
    >
      {chat.title}
    </button>
  );
});
const chatTitle = (chat: Conversation) => chat.title;
export const botName = (bot: Bot) => bot.name;

// Titles are encrypted in the database. Search authorized pages only while a query is active.
// Each result page shows a bounded set of rows. Changing the query cancels further page scans.
export function useDirectory<T extends { id: string }>(
  collection: Collection<T>,
  label: (row: T) => string,
) {
  const state = usePage(collection);
  const [filter, setFilter] = useState("");
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets.at(-1)!;
  const page = offsets.length - 1;
  const draft = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function updateFilter(value: string) {
    clearTimeout(timer.current);
    draft.current = value.trim().toLocaleLowerCase();
    timer.current = setTimeout(() => {
      setFilter(draft.current);
      setOffsets((old) => (old.length === 1 ? old : [0]));
      if (draft.current === filter && scanning && !collection.read().loading)
        void collection.nextPage();
    }, 200);
  }
  const labels = useMemo(() => new WeakMap<T, string>(), [label]);
  const matches = useMemo(
    () =>
      filter
        ? state.items.filter((row) => {
            let folded = labels.get(row);
            if (folded === undefined) {
              folded = label(row).toLocaleLowerCase();
              labels.set(row, folded);
            }
            return folded.includes(filter);
          })
        : state.items,
    [filter, state.items, labels, label],
  );
  const items = useMemo(
    () => matches.slice(offset, offset + PAGE_SIZE),
    [offset, matches],
  );
  const scanning = Boolean(
    filter &&
    state.next &&
    !state.error &&
    matches.length <= offset + PAGE_SIZE,
  );
  const needPage = Boolean(
    !filter && page > 0 && state.next && matches.length < offset + PAGE_SIZE,
  );
  useEffect(() => {
    if (
      draft.current === filter &&
      !state.loading &&
      !state.error &&
      (scanning || needPage)
    )
      void collection.nextPage();
  }, [
    collection,
    filter,
    scanning,
    needPage,
    state.loading,
    state.error,
    state.next,
  ]);
  const searching = Boolean(
    filter &&
    state.next &&
    matches.length <= offset + PAGE_SIZE &&
    !state.error,
  );
  const canAdvance =
    matches.length > offset + PAGE_SIZE || (!filter && Boolean(state.next));
  return {
    items,
    filter,
    updateFilter,
    page,
    canAdvance: canAdvance && items.length > 0,
    back: () => setOffsets((old) => (old.length > 1 ? old.slice(0, -1) : old)),
    next: () =>
      setOffsets((old) =>
        items.length ? [...old, offset + items.length] : old,
      ),
    loading: state.loading || searching,
    ready: state.ready,
    error: state.error,
    retry: collection.nextPage,
  };
}
type Controls = {
  page: number;
  canAdvance: boolean;
  back: () => void;
  next: () => void;
  loading: boolean;
  error: string;
  retry: () => Promise<void>;
};
export function PageControls({
  list,
  label,
}: {
  list: Controls;
  label: string;
}) {
  return (
    <>
      {list.error && (
        <div>
          <p role="alert">{list.error}</p>
          <button onClick={() => void list.retry()}>Try again</button>
        </div>
      )}
      {list.loading && !list.error && (
        <small role="status">Loading {label}…</small>
      )}
      {(list.page > 0 || list.canAdvance) && (
        <div className="actions" aria-label={label + " pages"}>
          <button
            aria-label={"Previous " + label + " page"}
            disabled={!list.page}
            onClick={list.back}
          >
            Previous
          </button>
          <small>Page {list.page + 1}</small>
          <button
            aria-label={"Next " + label + " page"}
            disabled={!list.canAdvance}
            onClick={list.next}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
export const ConversationList = memo(function ConversationList({
  chats,
  selected,
  open,
}: {
  chats: Collection<Conversation>;
  selected?: string;
  open: Navigate;
}) {
  const list = useDirectory(chats, chatTitle);
  return (
    <>
      <h2>Your conversations</h2>
      <label className="sr" htmlFor="find">
        Find a conversation
      </label>
      <input
        type="search"
        id="find"
        placeholder="Find a conversation"
        defaultValue=""
        onChange={(e) => list.updateFilter(e.target.value)}
      />
      <nav aria-label="Your conversations">
        {list.items.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            open={open}
            active={selected === chat.id}
          />
        ))}
      </nav>
      {list.ready && !list.items.length && !list.loading && !list.error && (
        <p className="muted">
          {list.filter ? "No matching conversations." : "No conversations yet."}
        </p>
      )}
      <PageControls list={list} label="conversations" />
    </>
  );
});
export function BotPicker({
  bots,
  initialBot,
}: {
  bots: Collection<Bot>;
  initialBot?: string;
}) {
  const list = useDirectory(bots, botName);
  const [selected, setSelected] = useState(initialBot ?? "");
  const selection = bots.cached(selected);
  const options = useMemo(
    () =>
      list.items.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      )),
    [list.items],
  );
  return (
    <>
      {list.filter || list.page || list.canAdvance ? (
        <label>
          Find a bot{" "}
          <input
            type="search"
            defaultValue=""
            onChange={(e) => list.updateFilter(e.target.value)}
          />
        </label>
      ) : null}
      <label>
        Bot
        <select
          name="botId"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Private notes</option>
          {selected && !list.items.some((b) => b.id === selected) && (
            <option value={selected}>
              {selection?.name ?? "Selected bot"}
            </option>
          )}
          {options}
        </select>
      </label>
      <PageControls list={list} label="bots" />
    </>
  );
}
const BotCount = memo(function BotCount({ bots }: { bots: Collection<Bot> }) {
  const read = useCallback(() => {
    const { items, next, ready } = bots.read();
    return ready && !next ? items.length : null;
  }, [bots]);
  const count = useSyncExternalStore(bots.subscribe, read);
  useEffect(() => {
    if (!bots.read().ready && !bots.read().error) void bots.nextPage();
  }, [bots]);
  return count === null ? null : <span>{count}</span>;
});
export const Sidebar = memo(function Sidebar({
  name,
  chats,
  bots,
  open,
  view,
}: {
  name: string;
  chats: Collection<Conversation>;
  bots: Collection<Bot>;
  open: Navigate;
  view: View;
}) {
  const [expandedFor, setExpandedFor] = useState<View | null>(null);
  const expanded = expandedFor === view;
  const navigate = useCallback(
    (next: View) => {
      setExpandedFor(null);
      open(next);
    },
    [open],
  );
  return (
    <>
      <button
        className="mobileNav quiet"
        aria-expanded={expanded}
        aria-controls="workspace-nav"
        onClick={() => setExpandedFor(expanded ? null : view)}
      >
        {expanded ? "Close navigation" : "Workspace menu"}
      </button>
      <aside
        id="workspace-nav"
        className={expanded ? "sidebar expanded" : "sidebar"}
      >
        <div className="teamName">{name}</div>
        <button className="primary" onClick={() => navigate({ kind: "new" })}>
          <span aria-hidden="true">＋</span> New conversation
        </button>
        <button
          className={
            "navItem " +
            (view.kind === "bots" || view.kind === "bot" ? "active" : "")
          }
          onClick={() => navigate({ kind: "bots" })}
        >
          Team bots <BotCount bots={bots} />
        </button>
        <ConversationList
          chats={chats}
          selected={view.kind === "thread" ? view.id : undefined}
          open={navigate}
        />
      </aside>
    </>
  );
});
