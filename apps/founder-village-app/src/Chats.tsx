import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { BotCatalog } from "./BotCatalog";
import {
  Empty,
  Field,
  Notice,
  PageControls,
  RequestFeedback,
} from "./feature-ui";
import type {
  Conversation,
  Message,
} from "./generated/contracts/features/founder-village-team/index";
import { usePage, useResource, useWrite } from "./requests";
import { styles } from "./theme";
import { Button, ErrorMessage } from "./ui";
import type { TeamApi, WorkspaceApi } from "./workspace-api";

export default function Chats({
  client,
  tenantId,
}: {
  client: WorkspaceApi;
  tenantId: string;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const api = useMemo(() => client.team(tenantId), [client, tenantId]);
  const list = usePage(api.conversations, "Could not load your conversations.");
  const [view, setView] = useState<"list" | "new" | Conversation>("list");
  const [manageBots, setManageBots] = useState(false);

  function opened(chat: Conversation) {
    setView(chat);
    list.restart();
  }

  if (manageBots)
    return <BotCatalog api={api} close={() => setManageBots(false)} />;

  return (
    <View style={[styles.featureSplit, wide && styles.featureSplitWide]}>
      {(wide || view === "list") && (
        <View
          style={[
            styles.featureColumn,
            wide && [styles.featureColumnWide, styles.chatSidebar],
          ]}
        >
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.subheading}>
              Your conversations
            </Text>
            <Button label="New conversation" onPress={() => setView("new")} />
            <Button
              label="Manage bots"
              variant="secondary"
              onPress={() => setManageBots(true)}
            />
            <RequestFeedback
              state={list.state}
              loading="Loading conversations…"
            />
            {list.state.status === "ready" &&
              (list.state.data.items.length ? (
                list.state.data.items.map((chat) => (
                  <Button
                    key={chat.id}
                    label={chat.title}
                    selected={typeof view === "object" && view.id === chat.id}
                    variant="secondary"
                    onPress={() => setView(chat)}
                  />
                ))
              ) : (
                <Text style={styles.text}>
                  You haven’t started a conversation yet.
                </Text>
              ))}
            <PageControls previous={list.previous} next={list.next} older />
          </View>
        </View>
      )}
      {(wide || view !== "list") && (
        <View style={[styles.featureColumn, wide && styles.featureColumnWide]}>
          {!wide && (
            <View style={styles.wrapRow}>
              <Button
                label="Back to conversations"
                variant="quiet"
                onPress={() => setView("list")}
              />
            </View>
          )}
          {view === "list" ? (
            <Empty>Choose a conversation or start a new one.</Empty>
          ) : view === "new" ? (
            <NewChat api={api} opened={opened} />
          ) : (
            <Thread key={view.id} api={api} chat={view} />
          )}
        </View>
      )}
    </View>
  );
}

function NewChat({
  api,
  opened,
}: {
  api: TeamApi;
  opened: (chat: Conversation) => void;
}) {
  const bots = usePage(api.bots, "Could not load team bots.");
  const write = useWrite("Could not start the conversation. Try again.");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(
    null,
  );

  async function start() {
    const input = { title: title.trim(), botId: selected?.id ?? null };
    if (!input.title) return;
    const chat = await write.run(input, (key) =>
      api.startChat(input.title, input.botId, key),
    );
    if (chat) opened(chat);
  }
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.subheading}>
        Start a conversation
      </Text>
      <Field
        label="Conversation title"
        value={title}
        onChangeText={setTitle}
        maxLength={240}
        editable={!write.busy}
      />
      <Text style={styles.label}>Bot</Text>
      <Text style={styles.text}>
        Selected bot: {selected?.name ?? "General chat"}
      </Text>
      <View style={styles.wrapRow}>
        <Button
          label="General chat"
          variant={selected ? "secondary" : "primary"}
          selected={!selected}
          disabled={write.busy}
          onPress={() => setSelected(null)}
        />
        {bots.state.status === "ready" &&
          bots.state.data.items.map((bot) => (
            <Button
              key={bot.id}
              label={bot.name}
              variant={selected?.id === bot.id ? "primary" : "secondary"}
              selected={selected?.id === bot.id}
              disabled={write.busy}
              onPress={() => setSelected(bot)}
            />
          ))}
      </View>
      <RequestFeedback state={bots.state} loading="Loading team bots…" />
      <PageControls previous={bots.previous} next={bots.next} />
      <ErrorMessage message={write.error} />
      <Button
        label="Start conversation"
        busy={write.busy}
        disabled={!title.trim()}
        onPress={() => void start()}
      />
    </View>
  );
}

function Thread({ chat, api }: { chat: Conversation; api: TeamApi }) {
  const load = useCallback(
    (after: string | undefined, signal: AbortSignal) =>
      api.messages(chat.id, after, signal),
    [api, chat.id],
  );
  const history = usePage(load, "Could not load conversation history.");
  const capabilities = useResource(
    api.capabilities,
    "Could not check bot reply availability.",
  );
  const send = useWrite("Could not send your message. Try again.");
  const reply = useWrite(
    "Could not generate the bot reply. Refresh the conversation before retrying.",
  );
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const messages =
    history.state.status === "ready" ? history.state.data.items : undefined;
  const latest = !history.previous ? messages?.[0] : undefined;
  const canReply =
    capabilities.status === "ready" && capabilities.data.repliesAvailable;
  const locked = send.busy || reply.busy;

  async function post() {
    const content = draft.trim();
    if (!content || locked) return;
    setNotice("");
    if (
      await send.run(content, (key) => api.sendMessage(chat.id, content, key))
    ) {
      setDraft("");
      setNotice("Message saved.");
      history.restart();
    }
  }

  async function generate(message: Message) {
    if (locked) return;
    setNotice("");
    if (
      await reply.run(message.id, (key) => api.reply(chat.id, message.id, key))
    ) {
      setNotice("Bot reply saved.");
      history.restart();
    }
  }

  return (
    <View style={styles.column}>
      <View style={styles.wrapRow}>
        <Text
          accessibilityRole="header"
          style={[styles.subheading, styles.filler]}
        >
          {chat.title}
        </Text>
        <Button
          label="Refresh conversation"
          variant="quiet"
          disabled={locked}
          onPress={history.restart}
        />
      </View>
      <RequestFeedback state={history.state} loading="Loading your messages…" />
      {messages &&
        (messages.length ? (
          [...messages]
            .reverse()
            .map((message) => (
              <TranscriptMessage
                key={message.id}
                chatId={chat.id}
                api={api}
                message={message}
              />
            ))
        ) : (
          <Empty>Send the first message to start this conversation.</Empty>
        ))}
      <PageControls previous={history.previous} next={history.next} older />
      <View style={styles.card}>
        <RequestFeedback
          state={capabilities}
          loading="Checking bot reply availability…"
        />
        {capabilities.status === "ready" && !canReply && (
          <Text style={styles.text}>
            Bot replies are unavailable. You can still save messages and read
            your history.
          </Text>
        )}
        {canReply && latest?.role === "user" && (
          <>
            <Text style={styles.small}>
              Generating a reply shares recent messages with the configured bot
              provider.
            </Text>
            <Button
              label="Generate bot reply"
              variant="secondary"
              busy={reply.busy}
              disabled={send.busy}
              onPress={() => void generate(latest)}
            />
          </>
        )}
        {notice !== "" && <Notice>{notice}</Notice>}
        <ErrorMessage message={reply.error} />
        <Field
          label="Message"
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={12000}
          editable={!locked}
        />
        <ErrorMessage message={send.error} />
        <Button
          label="Send message"
          busy={send.busy}
          disabled={!draft.trim() || reply.busy}
          onPress={() => void post()}
        />
      </View>
    </View>
  );
}

const roleName = {
  user: "You",
  assistant: "Bot",
  system: "System",
  tool: "Tool",
} as const;

function TranscriptMessage({
  chatId,
  message,
  api,
}: {
  chatId: string;
  message: Message;
  api: TeamApi;
}) {
  const [content, setContent] = useState(message.content);
  const [offset, setOffset] = useState(message.nextOffset);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function more() {
    if (offset === undefined || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const chunk = await api.messageContent(
        chatId,
        message.id,
        offset,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setContent((text) => text + chunk.content);
        setOffset(chunk.nextOffset ?? undefined);
      }
    } catch {
      if (!controller.signal.aborted)
        setError("Could not load the rest of this message. Try again.");
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const long = content.length > 800 || offset !== undefined;
  const author = message.authorName || roleName[message.role];
  return (
    <View style={[styles.card, message.role === "user" && styles.messageOwn]}>
      <Text style={styles.label}>
        {author.length > 120 ? `${author.slice(0, 120)}…` : author}
      </Text>
      <Text selectable style={styles.messageText}>
        {long && !expanded ? `${content.slice(0, 800)}…` : content}
      </Text>
      {long && (
        <Button
          label={expanded ? "Show less" : "Read message"}
          expanded={expanded}
          variant="quiet"
          onPress={() => setExpanded(!expanded)}
        />
      )}
      {expanded && offset !== undefined && (
        <Button
          label="Load more of this message"
          busy={loading}
          variant="secondary"
          onPress={() => void more()}
        />
      )}
      <ErrorMessage message={error} />
    </View>
  );
}
