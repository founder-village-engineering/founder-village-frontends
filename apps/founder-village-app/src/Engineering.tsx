import { useMemo, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import {
  Empty,
  Field,
  Notice,
  PageControls,
  RequestFeedback,
} from "./feature-ui";
import {
  engineeringInputSchema,
  engineeringStatuses,
  type EngineeringItem,
  type EngineeringStatus,
} from "./generated/contracts/features/founder-village-team/engineering";
import { usePage, useWrite } from "./requests";
import { styles } from "./theme";
import { Button, ErrorMessage } from "./ui";
import type { TeamApi, WorkspaceApi } from "./workspace-api";

const labels: Record<EngineeringStatus, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  done: "Done",
};

export default function Engineering({
  client,
  tenantId,
}: {
  client: WorkspaceApi;
  tenantId: string;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const api = useMemo(() => client.team(tenantId), [client, tenantId]);
  const { state, previous, next, restart } = usePage(
    api.items,
    "Could not load the engineering board.",
  );
  const write = useWrite("Could not create the work item. Try again.");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [notice, setNotice] = useState("");

  async function create() {
    const input = engineeringInputSchema.safeParse({ title, detail });
    if (!input.success) return;
    setNotice("");
    if (await write.run(input.data, (key) => api.createItem(input.data, key))) {
      setTitle("");
      setDetail("");
      setNotice("Work item added to Backlog.");
      restart();
    }
  }

  function updated() {
    setNotice("Work item updated.");
    state.retry();
  }

  return (
    <View style={[styles.featureSplit, wide && styles.featureSplitWide]}>
      <View
        style={[
          styles.featureColumn,
          wide && [styles.featureColumnWide, styles.formColumnWide],
        ]}
      >
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.subheading}>
            New work item
          </Text>
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            editable={!write.busy}
          />
          <Field
            label="Details (optional)"
            value={detail}
            onChangeText={setDetail}
            maxLength={1400}
            multiline
            editable={!write.busy}
          />
          <ErrorMessage message={write.error} />
          <Button
            label="Add work item"
            busy={write.busy}
            disabled={!title.trim()}
            onPress={() => void create()}
          />
        </View>
      </View>
      <View style={[styles.featureColumn, wide && styles.featureColumnWide]}>
        <View style={styles.wrapRow}>
          <Text
            accessibilityRole="header"
            style={[styles.subheading, styles.filler]}
          >
            Work board
          </Text>
          <Button label="Refresh board" onPress={restart} variant="quiet" />
        </View>
        {notice !== "" && <Notice>{notice}</Notice>}
        <RequestFeedback state={state} loading="Loading engineering items…" />
        {state.status === "ready" &&
          (state.data.items.length ? (
            engineeringStatuses.map((status) => {
              const items = state.data.items.filter(
                (item) => item.status === status,
              );
              return items.length ? (
                <View key={status} style={styles.column}>
                  <Text accessibilityRole="header" style={styles.sectionLabel}>
                    {labels[status]}
                  </Text>
                  {items.map((item) => (
                    <Item
                      key={item.id}
                      item={item}
                      api={api}
                      updated={updated}
                    />
                  ))}
                </View>
              ) : null;
            })
          ) : (
            <Empty>Your team hasn’t added any work items yet.</Empty>
          ))}
        <PageControls previous={previous} next={next} />
      </View>
    </View>
  );
}

function Item({
  item,
  api,
  updated,
}: {
  item: EngineeringItem;
  api: TeamApi;
  updated: () => void;
}) {
  const write = useWrite("Could not update this work item. Try again.");
  async function move(status: EngineeringStatus) {
    const input = { status, revision: item.revision };
    if (
      await write.run(input, (key) =>
        api.updateStatus(item.id, status, item.revision, key),
      )
    )
      updated();
  }
  return (
    <View style={[styles.card, styles.distinctCard]}>
      <Text style={styles.label}>{item.title}</Text>
      {item.detail !== "" && <Text style={styles.text}>{item.detail}</Text>}
      <ErrorMessage message={write.error} />
      <View style={styles.wrapRow}>
        {engineeringStatuses
          .filter((status) => status !== item.status)
          .map((status) => (
            <Button
              key={status}
              label={`Move to ${labels[status]}`}
              a11yLabel={`Move ${item.title} to ${labels[status]}`}
              variant="secondary"
              disabled={write.busy}
              onPress={() => void move(status)}
            />
          ))}
      </View>
    </View>
  );
}
