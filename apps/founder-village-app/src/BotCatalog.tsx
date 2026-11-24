import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { Empty, Field, PageControls, RequestFeedback } from "./feature-ui";
import type { Bot } from "./generated/contracts/features/founder-village-team/index";
import { usePage, useResource, useWrite } from "./requests";
import { styles } from "./theme";
import { Button, ErrorMessage } from "./ui";
import type { TeamApi } from "./workspace-api";

export function BotCatalog({
  api,
  close,
}: {
  api: TeamApi;
  close: () => void;
}) {
  const [view, setView] = useState<"list" | "new" | Bot>("list");
  const bots = usePage(api.bots, "Could not load team bots.");
  const done = () => {
    bots.restart();
    setView("list");
  };
  return (
    <View style={styles.column}>
      <View style={styles.wrapRow}>
        <Button label="Back to conversations" variant="quiet" onPress={close} />
        {view === "list" ? (
          <Button label="Create bot" onPress={() => setView("new")} />
        ) : (
          <Button
            label="Back to bots"
            variant="secondary"
            onPress={() => setView("list")}
          />
        )}
      </View>
      {view === "list" ? (
        <>
          <Text accessibilityRole="header" style={styles.subheading}>
            Bots
          </Text>
          <RequestFeedback state={bots.state} loading="Loading team bots…" />
          {bots.state.status === "ready" &&
            (bots.state.data.items.length ? (
              bots.state.data.items.map((bot) => (
                <View key={bot.id} style={styles.card}>
                  <Text style={styles.label}>{bot.name}</Text>
                  {bot.description !== "" && (
                    <Text style={styles.text}>{bot.description}</Text>
                  )}
                  {bot.canManage && (
                    <View style={styles.wrapRow}>
                      <Button
                        label="Edit bot"
                        a11yLabel={`Edit ${bot.name}`}
                        variant="secondary"
                        onPress={() => setView(bot)}
                      />
                    </View>
                  )}
                </View>
              ))
            ) : (
              <Empty>No bots are available in this workspace.</Empty>
            ))}
          <PageControls previous={bots.previous} next={bots.next} older />
        </>
      ) : view === "new" ? (
        <BotForm api={api} done={done} />
      ) : (
        <ExistingBot key={view.id} id={view.id} api={api} done={done} />
      )}
    </View>
  );
}

function ExistingBot({
  id,
  api,
  done,
}: {
  id: string;
  api: TeamApi;
  done: () => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => api.bot(id, signal),
    [api, id],
  );
  const bot = useResource(load, "Could not load this bot.");
  if (bot.status !== "ready")
    return <RequestFeedback state={bot} loading="Opening bot settings…" />;
  if (!bot.data.canManage || bot.data.instructions === null)
    return <Empty>Your account can no longer edit this bot.</Empty>;
  return <BotForm api={api} done={done} bot={bot.data} />;
}

function BotForm({
  api,
  done,
  bot,
}: {
  api: TeamApi;
  done: () => void;
  bot?: Bot;
}) {
  const write = useWrite("Could not save this bot. Try again.");
  const [name, setName] = useState(bot?.name ?? "");
  const [description, setDescription] = useState(bot?.description ?? "");
  const [instructions, setInstructions] = useState(bot?.instructions ?? "");
  const [visibility, setVisibility] = useState<"private" | "team">("private");
  async function submit() {
    const input = { name: name.trim(), description, instructions, visibility };
    if (
      input.name &&
      (await write.run(input, (key) => api.saveBot(input, key, bot)))
    )
      done();
  }
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.subheading}>
        {bot ? "Edit bot" : "New bot"}
      </Text>
      <Field
        label="Bot name"
        value={name}
        onChangeText={setName}
        maxLength={240}
        editable={!write.busy}
      />
      <Field
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        maxLength={2000}
        multiline
        editable={!write.busy}
      />
      <Field
        label="Instructions"
        value={instructions}
        onChangeText={setInstructions}
        maxLength={10000}
        multiline
        editable={!write.busy}
      />
      {!bot && (
        <View style={styles.inputWrap}>
          <Text style={styles.label}>Visibility</Text>
          <View style={styles.wrapRow}>
            <Button
              label="Only me"
              selected={visibility === "private"}
              variant={visibility === "private" ? "primary" : "secondary"}
              disabled={write.busy}
              onPress={() => setVisibility("private")}
            />
            <Button
              label="Team"
              selected={visibility === "team"}
              variant={visibility === "team" ? "primary" : "secondary"}
              disabled={write.busy}
              onPress={() => setVisibility("team")}
            />
          </View>
        </View>
      )}
      <ErrorMessage message={write.error} />
      <Button
        label="Save bot"
        disabled={!name.trim()}
        busy={write.busy}
        onPress={() => void submit()}
      />
    </View>
  );
}
