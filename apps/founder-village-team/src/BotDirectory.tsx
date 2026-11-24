import { memo, useCallback } from "react";
import { FlatList } from "react-native";
import { type Bot } from "./generated/contracts/index.ts";
import type { Collection } from "./collection.ts";
import {
  useDirectory,
  PageControls,
  botName,
  type Navigate,
} from "./Directories.tsx";
const keyForBot = (bot: Bot) => bot.id;
const BotRow = memo(function BotRow({
  bot,
  open,
}: {
  bot: Bot;
  open: Navigate;
}) {
  return (
    <article className="botRow">
      <div className="botIcon" aria-hidden="true">
        ✳
      </div>
      <div>
        <h2>{bot.name}</h2>
        {bot.description && <p>{bot.description}</p>}
        <small>
          {bot.visibility === "team"
            ? "Team-wide"
            : bot.visibility === "selected"
              ? "Selected members"
              : "Private"}
        </small>
      </div>
      <div className="actions">
        {bot.canManage && (
          <button onClick={() => open({ kind: "bot", id: bot.id })}>
            Configure
          </button>
        )}
        <button onClick={() => open({ kind: "new", botId: bot.id })}>
          Chat
        </button>
      </div>
    </article>
  );
});
export default memo(function BotDirectory({
  bots,
  open,
}: {
  bots: Collection<Bot>;
  open: Navigate;
}) {
  const list = useDirectory(bots, botName);
  const renderItem = useCallback(
    ({ item }: { item: Bot }) => <BotRow bot={item} open={open} />,
    [open],
  );
  return (
    <>
      <div className="sectionHead">
        <div>
          <h1>Team bots</h1>
          <p>Choose a bot to start a private conversation.</p>
        </div>
        <button onClick={() => open({ kind: "bot" })}>Create bot</button>
      </div>
      <label>
        Find a bot{" "}
        <input
          type="search"
          defaultValue=""
          onChange={(e) => list.updateFilter(e.target.value)}
        />
      </label>
      <FlatList
        data={list.items}
        keyExtractor={keyForBot}
        renderItem={renderItem}
      />
      {list.ready && !list.items.length && !list.loading && !list.error && (
        <p className="notice">
          {list.filter ? "No matching bots." : "You don’t have any bots yet."}
        </p>
      )}
      <PageControls list={list} label="bots" />
    </>
  );
});
