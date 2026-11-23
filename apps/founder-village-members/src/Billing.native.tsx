import { ScrollView, Text, View } from "react-native";
import { useMembership, type BillingProps } from "./membership";
import { styles } from "./theme";
import { Button, ErrorMessage, Loading } from "./ui";

export default function Billing({ api, compact }: BillingProps) {
  const { membership, error, reload } = useMembership(api);
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.wrap,
        styles.folder,
        compact && styles.compactWrap,
      ]}
    >
      <Text accessibilityRole="header" style={styles.heading}>
        Membership
      </Text>
      {!membership && !error && <Loading>Loading your membership…</Loading>}
      <ErrorMessage message={error} />
      {membership && (
        <View style={styles.statusCard}>
          <Text style={styles.available}>
            {membership.tier === "paid" ? "Paid member" : "Free member"}
          </Text>
          <Text style={styles.text}>
            {membership.tier === "paid"
              ? "Your upgrade is active."
              : "Browse the directory and connect with other members."}
          </Text>
        </View>
      )}
      <Button
        label={error ? "Retry" : "Refresh status"}
        onPress={() => void reload()}
        variant="secondary"
      />
    </ScrollView>
  );
}
