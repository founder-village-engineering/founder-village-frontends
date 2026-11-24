import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { styles } from "./theme";

export function Viewport({ children }: PropsWithChildren) {
  return <View style={styles.viewport}>{children}</View>;
}
