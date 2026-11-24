import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { actionError, type MemberApi } from "./api";
import { communityArtwork } from "./art";
import type { DirectoryMember } from "./generated/contracts/members";
import { openExternal } from "./session";
import { palette, styles } from "./theme";
import { Button, ErrorMessage, LeafMark, Loading } from "./ui";

const avatarColors = ["#263c24", "#3a2f21", "#1c3832", "#312b40"];

function MemberRow({
  member,
  contacting,
  anyContacting,
  openChat,
}: {
  member: DirectoryMember;
  contacting: boolean;
  anyContacting: boolean;
  openChat: () => void;
}) {
  const initials = member.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toLocaleUpperCase();
  const color =
    avatarColors[
      Number.parseInt(member.id.slice(0, 2), 16) % avatarColors.length
    ];
  return (
    <View style={styles.member}>
      <View
        accessible={false}
        style={[styles.avatar, { backgroundColor: color }]}
      >
        <Text style={styles.initials}>{initials}</Text>
      </View>
      <View style={styles.memberDetails}>
        <Text style={styles.memberName}>{member.name}</Text>
        {member.headline && <Text style={styles.small}>{member.headline}</Text>}
        {member.location && <Text style={styles.small}>{member.location}</Text>}
      </View>
      {member.whatsappAvailable && (
        <Button
          variant="secondary"
          label="WhatsApp"
          a11yLabel={`Message ${member.name} on WhatsApp`}
          style={styles.memberAction}
          onPress={openChat}
          busy={contacting}
          disabled={anyContacting}
        />
      )}
    </View>
  );
}

export function Directory({
  api,
  compact,
  wide,
  onMembership,
}: {
  api: MemberApi;
  compact: boolean;
  wide: boolean;
  onMembership: () => void;
}) {
  const [query, setQuery] = useState("");
  const [list, setList] =
    useState<Awaited<ReturnType<MemberApi["directory"]>>>();
  const [error, setError] = useState("");
  const [contactError, setContactError] = useState("");
  const [more, setMore] = useState(false);
  const [contacting, setContacting] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    const timer = setTimeout(
      () => {
        void api
          .directory(query)
          .then((result) => {
            if (generation.current === current) setList(result);
          })
          .catch((failure: unknown) => {
            if (generation.current === current)
              setError(
                actionError(
                  failure,
                  "Could not load the directory. Try again.",
                ),
              );
          });
      },
      query ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      ++generation.current;
    };
  }, [api, query, refresh]);

  function updateSearch(value: string) {
    ++generation.current;
    setList(undefined);
    setError("");
    setMore(false);
    setContactError("");
    if (value === query) setRefresh((value) => value + 1);
    else setQuery(value);
  }

  async function loadMore() {
    if (!list?.next || more) return;
    const current = generation.current;
    setError("");
    setMore(true);
    try {
      const next = await api.directory(query, list.next);
      if (generation.current !== current) return;
      const seen = new Set(list.members.map(({ id }) => id));
      setList({
        members: [
          ...list.members,
          ...next.members.filter(({ id }) => !seen.has(id)),
        ],
        next: next.next,
      });
    } catch (error) {
      if (generation.current === current)
        setError(actionError(error, "Could not load more members. Try again."));
    } finally {
      if (generation.current === current) setMore(false);
    }
  }

  async function openChat(id: string) {
    if (contacting) return;
    setContactError("");
    setContacting(id);
    const current = generation.current;
    try {
      const url = await api.whatsapp(id);
      if (generation.current === current) await openExternal(url);
    } catch (error) {
      if (generation.current === current)
        setContactError(
          actionError(
            error,
            "This WhatsApp contact is unavailable. Refresh the directory and try again.",
          ),
        );
    } finally {
      setContacting(undefined);
    }
  }

  return (
    <View
      style={[
        styles.wrap,
        compact && styles.compactWrap,
        styles.directory,
        wide && styles.directoryWide,
      ]}
    >
      <FlatList
        style={styles.directoryList}
        contentContainerStyle={styles.directoryContent}
        keyboardShouldPersistTaps="handled"
        data={list?.members ?? []}
        keyExtractor={(member) => member.id}
        ListHeaderComponent={
          <View style={[styles.directoryIntro, { paddingTop: 28 }]}>
            <Text
              accessibilityRole="header"
              style={[styles.heading, wide && styles.headingWide]}
            >
              Member directory
            </Text>
            <Text style={styles.intro}>
              Find other founders and start a conversation.
            </Text>
            <View style={styles.searchBar}>
              <TextInput
                accessibilityLabel="Search members"
                placeholder="Search by name, work, or location"
                placeholderTextColor={palette.muted}
                value={query}
                onChangeText={updateSearch}
                maxLength={100}
                style={styles.searchInput}
                returnKeyType="search"
              />
              {query !== "" && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  style={({ pressed }) => [
                    styles.clearSearch,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => updateSearch("")}
                >
                  <Text style={styles.clearSearchLabel}>Clear</Text>
                </Pressable>
              )}
            </View>
            {list && (
              <Text
                accessibilityLiveRegion="polite"
                style={styles.searchHeading}
              >
                {list.next
                  ? `Showing ${list.members.length} members`
                  : `${list.members.length} ${list.members.length === 1 ? "member" : "members"}`}
              </Text>
            )}
            <ErrorMessage message={contactError} />
          </View>
        }
        ListEmptyComponent={
          error ? (
            <View style={styles.empty}>
              <ErrorMessage message={error} />
              <Button
                label="Retry"
                variant="secondary"
                onPress={() => updateSearch(query)}
              />
            </View>
          ) : !list ? (
            <Loading>Loading members…</Loading>
          ) : (
            <View style={styles.empty}>
              <LeafMark />
              <Text style={styles.subheading}>
                {query.trim()
                  ? "No matching members"
                  : "No other listed members yet"}
              </Text>
              <Text style={styles.text}>
                {query.trim()
                  ? "Try a different name, project, or location."
                  : "Profiles appear here when members choose to list them."}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          list?.next ? (
            <View style={styles.column}>
              <ErrorMessage message={error} />
              <Button
                label="Load more members"
                variant="secondary"
                busy={more}
                onPress={() => void loadMore()}
              />
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <MemberRow
            member={item}
            contacting={contacting === item.id}
            anyContacting={Boolean(contacting)}
            openChat={() => void openChat(item.id)}
          />
        )}
      />
      {wide && (
        <View style={styles.sidebar}>
          <View style={styles.card}>
            <Image
              source={communityArtwork}
              style={styles.sidebarImage}
              resizeMode="cover"
              accessible={false}
            />
            <Text style={styles.subheading}>Your membership</Text>
            <Text style={styles.text}>
              View your current plan and payment status.
            </Text>
            <Button
              label="Manage membership"
              variant="secondary"
              onPress={onMembership}
            />
          </View>
        </View>
      )}
    </View>
  );
}
