import { useState } from "react";
import { ScrollView, Switch, Text, TextInput, View } from "react-native";
import { actionError, type MemberApi } from "./api";
import {
  profileInputSchema,
  type Profile,
} from "./generated/contracts/members";
import { palette, styles } from "./theme";
import { Button, ErrorMessage } from "./ui";

const switchTrack = { true: palette.accent, false: palette.controlBorder };

type Props = {
  api: MemberApi;
  profile: Profile | null;
  compact: boolean;
  deletionIntent: boolean;
  onSave: (profile: Profile) => void;
  onDelete: () => void;
  onCancelDeletion: () => void;
};

export function ProfileScreen({
  api,
  profile,
  compact,
  deletionIntent,
  onSave,
  onDelete,
  onCancelDeletion,
}: Props) {
  const [name, setName] = useState(profile?.name ?? "");
  const [headline, setHeadline] = useState(profile?.headline ?? "");
  const [location, setLocation] = useState(profile?.location ?? "");
  const [listed, setListed] = useState(profile?.listed ?? true);
  const [sharesWhatsApp, setSharesWhatsApp] = useState(
    Boolean(profile?.whatsappNumber),
  );
  const [phone, setPhone] = useState(profile?.whatsappNumber ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(deletionIntent);
  const alreadyDeleted = !profile && deletionIntent;

  async function save() {
    if (busy) return;
    setSaved(false);
    const input = profileInputSchema.safeParse({
      name,
      headline: headline.trim() || null,
      location: location.trim() || null,
      listed,
      whatsappNumber: sharesWhatsApp ? phone.replace(/[\s().-]/g, "") : null,
    });
    if (!input.success) {
      setError(
        input.error.issues.some((issue) => issue.path[0] === "whatsappNumber")
          ? "Enter your WhatsApp number with a plus sign and country code."
          : "Enter a display name with at least two characters.",
      );
      return;
    }
    setError("");
    setBusy(true);
    try {
      const stored = await api.saveProfile(input.data, !profile);
      if (!stored) throw new Error();
      onSave(stored);
      setSaved(true);
    } catch (error) {
      setError(
        actionError(error, "Your profile could not be saved. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await api.deleteAccount();
      onDelete();
    } catch (error) {
      setError(
        actionError(
          error,
          "Your member profile could not be deleted. Try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.wrap,
        styles.folder,
        compact && styles.compactWrap,
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.heading, !compact && styles.headingWide]}
      >
        {deletionIntent
          ? "Delete your member profile"
          : profile
            ? "Your profile"
            : "Create your free account"}
      </Text>
      {alreadyDeleted ? (
        <View style={styles.card}>
          <Text style={styles.text}>
            This sign-in has no Founder Village member profile.
          </Text>
          <Button
            variant="secondary"
            label="Back to profile"
            onPress={onCancelDeletion}
          />
        </View>
      ) : (
        <>
          {!deletionIntent && (
            <View style={[styles.card, !compact && styles.cardWide]}>
              <Text style={styles.text}>
                Choose what other members can see in the directory.
              </Text>
              <View style={styles.inputWrap}>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  accessibilityLabel="Display name"
                  autoComplete="name"
                  maxLength={60}
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  editable={!busy}
                />
              </View>
              <View style={styles.inputWrap}>
                <Text style={styles.label}>
                  What you’re building (optional)
                </Text>
                <TextInput
                  accessibilityLabel="What you are building"
                  maxLength={100}
                  style={styles.input}
                  placeholder="e.g. A neighborhood garden"
                  placeholderTextColor={palette.muted}
                  value={headline}
                  onChangeText={setHeadline}
                  editable={!busy}
                />
              </View>
              <View style={styles.inputWrap}>
                <Text style={styles.label}>Location (optional)</Text>
                <TextInput
                  accessibilityLabel="Location"
                  maxLength={60}
                  style={styles.input}
                  value={location}
                  onChangeText={setLocation}
                  editable={!busy}
                />
              </View>
              <View style={styles.separator} />
              <View style={styles.switchRow}>
                <View style={styles.filler}>
                  <Text style={styles.label}>Show me in the directory</Text>
                  <Text style={styles.small}>
                    Other signed-in members can find your profile.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Show me in the directory"
                  value={listed}
                  onValueChange={setListed}
                  disabled={busy}
                  trackColor={switchTrack}
                  ios_backgroundColor={switchTrack.false}
                  thumbColor={listed ? palette.onAccent : palette.text}
                />
              </View>
              <View style={styles.switchRow}>
                <View style={styles.filler}>
                  <Text style={styles.label}>Share my WhatsApp number</Text>
                  <Text style={styles.small}>
                    Members can open a chat with you from your listed profile.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Share my WhatsApp number"
                  value={sharesWhatsApp}
                  onValueChange={setSharesWhatsApp}
                  disabled={busy}
                  trackColor={switchTrack}
                  ios_backgroundColor={switchTrack.false}
                  thumbColor={sharesWhatsApp ? palette.onAccent : palette.text}
                />
              </View>
              {sharesWhatsApp && (
                <View style={styles.inputWrap}>
                  <Text style={styles.label}>
                    WhatsApp number with country code
                  </Text>
                  <TextInput
                    accessibilityLabel="WhatsApp number"
                    autoComplete="tel"
                    keyboardType="phone-pad"
                    maxLength={26}
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    editable={!busy}
                  />
                </View>
              )}
              {!confirm && <ErrorMessage message={error} />}
              {saved && (
                <Text accessibilityLiveRegion="polite" style={styles.success}>
                  Profile saved.
                </Text>
              )}
              <View style={styles.wrapRow}>
                <Button
                  label={profile ? "Save profile" : "Create account"}
                  onPress={() => void save()}
                  busy={busy && !confirm}
                  disabled={confirm}
                />
              </View>
            </View>
          )}
          {profile && (
            <View style={styles.card}>
              {!deletionIntent && (
                <Text accessibilityRole="header" style={styles.subheading}>
                  Member profile deletion
                </Text>
              )}
              <Text style={styles.text}>
                Delete your profile and remove your WhatsApp details from the
                directory. Payment records may be retained for reconciliation.
              </Text>
              {confirm && (
                <Text style={styles.label}>
                  Your membership and profile will be removed permanently.
                </Text>
              )}
              {confirm && <ErrorMessage message={error} />}
              <View style={styles.wrapRow}>
                <Button
                  label={
                    confirm
                      ? "Permanently delete member profile"
                      : "Delete member profile"
                  }
                  variant="danger"
                  busy={busy && confirm}
                  disabled={busy && !confirm}
                  onPress={
                    confirm
                      ? () => void remove()
                      : () => {
                          setConfirm(true);
                          setError("");
                        }
                  }
                />
                {confirm && (
                  <Button
                    label="Cancel"
                    variant="quiet"
                    disabled={busy}
                    onPress={
                      deletionIntent
                        ? onCancelDeletion
                        : () => {
                            setConfirm(false);
                            setError("");
                          }
                    }
                  />
                )}
              </View>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
