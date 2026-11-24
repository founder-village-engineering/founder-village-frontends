import type { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { leafArtwork } from "./art";
import { palette, styles } from "./theme";

export function LeafMark() {
  return (
    <Image source={leafArtwork} style={styles.leafMark} accessible={false} />
  );
}

export function Brand() {
  return (
    <View style={styles.brand}>
      <LeafMark />
      <Text style={styles.brandText}>Founder Village</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  busy,
  disabled,
  style,
  a11yLabel,
  selected,
  expanded,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  a11yLabel?: string;
  selected?: boolean;
  expanded?: boolean;
}) {
  const color =
    variant === "primary"
      ? palette.onAccent
      : variant === "danger"
        ? palette.danger
        : palette.accent;
  return (
    <Pressable
      {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{
        busy,
        disabled: disabled || busy,
        selected: Platform.OS === "web" ? undefined : selected,
        expanded,
      }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        style,
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
      ]}
    >
      {busy && <ActivityIndicator color={color} size="small" />}
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function ErrorMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <View style={styles.alert}>
      <Text accessibilityRole="alert" style={styles.alertText}>
        {message}
      </Text>
    </View>
  );
}

export function Loading({ children = "Loading…" }: PropsWithChildren) {
  return (
    <View style={styles.row}>
      <ActivityIndicator color={palette.accent} />
      <Text accessibilityLiveRegion="polite" style={styles.text}>
        {children}
      </Text>
    </View>
  );
}
