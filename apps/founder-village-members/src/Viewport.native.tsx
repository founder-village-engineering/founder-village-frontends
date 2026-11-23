import { StatusBar } from "expo-status-bar";
import type { PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { styles } from "./theme";

export function Viewport({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.viewport}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.viewport}
        >
          {children}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
