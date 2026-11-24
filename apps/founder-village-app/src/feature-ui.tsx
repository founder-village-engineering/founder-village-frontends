import type { PropsWithChildren, ReactNode } from "react";
import { useState } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { palette, styles } from "./theme";
import { Button, ErrorMessage, Loading } from "./ui";
import type { Workspace } from "./workspace-api";

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={palette.muted}
        style={[styles.input, props.multiline && styles.multiline]}
      />
    </View>
  );
}

export function Notice({ children }: PropsWithChildren) {
  return (
    <Text accessibilityLiveRegion="polite" style={styles.success}>
      {children}
    </Text>
  );
}

export function Empty({ children }: PropsWithChildren) {
  return (
    <View style={styles.empty}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

export function FeatureFrame({
  title,
  compact,
  children,
}: PropsWithChildren<{ title: string; compact: boolean }>) {
  return (
    <ScrollView
      style={styles.scroll}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.wrap,
        styles.section,
        compact && styles.compactWrap,
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.heading, !compact && styles.headingWide]}
      >
        {title}
      </Text>
      {children}
    </ScrollView>
  );
}

type RequestState =
  | { status: "loading"; retry: () => void }
  | { status: "error"; message: string; retry: () => void }
  | { status: "ready"; retry: () => void };

export function RequestFeedback({
  state,
  loading,
}: {
  state: RequestState;
  loading: string;
}) {
  if (state.status === "loading") return <Loading>{loading}</Loading>;
  if (state.status === "error")
    return (
      <View style={styles.column}>
        <ErrorMessage message={state.message} />
        <View style={styles.wrapRow}>
          <Button label="Try again" variant="secondary" onPress={state.retry} />
        </View>
      </View>
    );
  return null;
}

export function PageControls({
  previous,
  next,
  older = false,
}: {
  previous?: () => void;
  next?: () => void;
  older?: boolean;
}) {
  if (!previous && !next) return null;
  return (
    <View style={styles.wrapRow}>
      {previous && (
        <Button
          label={older ? "Newer" : "Previous page"}
          variant="secondary"
          onPress={previous}
        />
      )}
      {next && (
        <Button
          label={older ? "Older" : "Next page"}
          variant="secondary"
          onPress={next}
        />
      )}
    </View>
  );
}

export type WorkspaceAccess =
  | Exclude<RequestState, { status: "ready" }>
  | {
      status: "ready";
      retry: () => void;
      data: Workspace[];
    };

export function WorkspaceGate({
  title,
  access,
  compact,
  noAccess,
  children,
}: {
  title: string;
  access: WorkspaceAccess;
  compact: boolean;
  noAccess: string;
  children: (workspace: Workspace) => ReactNode;
}) {
  const [selected, setSelected] = useState("");
  const workspaces = access.status === "ready" ? access.data : [];
  const workspace =
    workspaces.find((entry) => entry.id === selected) ?? workspaces[0];
  return (
    <FeatureFrame title={title} compact={compact}>
      <RequestFeedback state={access} loading="Checking workspace access…" />
      {access.status === "ready" && !workspace && <Empty>{noAccess}</Empty>}
      {workspace && (
        <>
          {workspaces.length > 1 ? (
            <View style={styles.inputWrap}>
              <Text style={styles.label}>Workspace</Text>
              <View style={styles.wrapRow}>
                {workspaces.map((entry) => (
                  <Button
                    key={entry.id}
                    label={entry.name}
                    variant={
                      entry.id === workspace.id ? "primary" : "secondary"
                    }
                    selected={entry.id === workspace.id}
                    onPress={() => setSelected(entry.id)}
                  />
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.text}>{workspace.name}</Text>
          )}
          <View key={workspace.id}>{children(workspace)}</View>
        </>
      )}
    </FeatureFrame>
  );
}
