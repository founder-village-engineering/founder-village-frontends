import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type {
  BrowserSession,
  RuntimeConfig,
} from "@founder-village/frontend-platform";
import { createRequester, memberApi, type Requester } from "./api";
import { communityArtwork } from "./art";
import { Directory } from "./Directory";
import {
  Empty,
  Notice,
  RequestFeedback,
  WorkspaceGate,
  type WorkspaceAccess,
} from "./feature-ui";
import type { Profile } from "./generated/contracts/members";
import { ProfileScreen } from "./Profile";
import { useResource } from "./requests";
import { screenNames, type Screen } from "./screens";
import {
  canSignIn,
  checkoutReturned,
  getConfig,
  initialScreen,
  restoreSession,
  showDeletion,
  signIn,
  signOut,
  watchScreen,
  writeScreen,
} from "./session";
import { styles } from "./theme";
import { Brand, Button, ErrorMessage, Loading } from "./ui";
import { Viewport } from "./Viewport";
import { workspaceApi } from "./workspace-api";

const Billing = lazy(() => import("./Billing"));
const Deliveries = lazy(() => import("./Deliveries"));
const Engineering = lazy(() => import("./Engineering"));
const Chats = lazy(() => import("./Chats"));

const descriptions: Record<Exclude<Screen, "home" | "profile">, string> = {
  directory: "Find other members and connect on WhatsApp.",
  membership: "See your plan, upgrade, and track payments.",
  deliveries: "Log iFood and 99Food orders and see your delivery history.",
  engineering: "Organize your team’s work from backlog to done.",
  chats: "Start a private conversation with a team bot.",
};

const teamAccessMessage =
  "This area is for internal team members. Ask your workspace owner for access.";
const deliveryAccessMessage =
  "Your account doesn’t have a delivery workspace yet. Ask your workspace owner for access.";

type Navigate = (screen: Screen) => void;

function Header({
  screen,
  sections,
  navigate,
  sessionAction,
}: {
  screen: Screen;
  sections?: Screen[];
  navigate: Navigate;
  sessionAction?: {
    label: string;
    run: () => void;
    busy?: boolean;
    disabled?: boolean;
  };
}) {
  const { width } = useWindowDimensions();
  const compact = width < 1100;
  const [open, setOpen] = useState(false);
  const menu = sections && (
    <View
      accessibilityRole="navigation"
      accessibilityLabel="App navigation"
      style={[styles.nav, compact && styles.navMobile]}
    >
      {sections.map((id) => (
        <Pressable
          key={id}
          {...(Platform.OS === "web" && screen === id
            ? { "aria-current": "page" }
            : {})}
          accessibilityRole="button"
          accessibilityState={{
            selected: Platform.OS === "web" ? undefined : screen === id,
          }}
          style={({ pressed }) => [
            styles.navButton,
            screen === id && styles.navActive,
            pressed && styles.pressed,
          ]}
          onPress={() => {
            navigate(id);
            setOpen(false);
          }}
        >
          <Text style={[styles.navText, screen === id && styles.navActiveText]}>
            {screenNames[id]}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={styles.headerBar}>
      <View style={[styles.wrap, styles.header, compact && styles.compactWrap]}>
        <Brand />
        {!compact && menu}
        {compact && sections ? (
          <Button
            variant="quiet"
            label={open ? "Close menu" : "Menu"}
            expanded={open}
            onPress={() => setOpen(!open)}
          />
        ) : (
          sessionAction && (
            <Button
              variant="quiet"
              label={sessionAction.label}
              busy={sessionAction.busy}
              disabled={sessionAction.disabled}
              onPress={sessionAction.run}
            />
          )
        )}
      </View>
      {compact && open && sections && (
        <View style={[styles.wrap, styles.compactWrap]}>
          {menu}
          {sessionAction && (
            <View style={styles.wrapRow}>
              <Button
                variant="quiet"
                label={sessionAction.label}
                onPress={sessionAction.run}
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export function App() {
  return (
    <Viewport>
      <Village />
    </Viewport>
  );
}

function Village() {
  const { width } = useWindowDimensions();
  const compact = width < 650;
  const wide = width >= 900;
  const [config] = useState(() => {
    try {
      return getConfig();
    } catch {
      return undefined;
    }
  });
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [deletionIntent, setDeletionIntent] = useState(showDeletion);
  const [returning, setReturning] = useState(checkoutReturned);
  const [session, setSession] = useState<BrowserSession>();
  const activeSession = useRef<BrowserSession | undefined>(undefined);
  const [restoring, setRestoring] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const acceptSession = useCallback((value: BrowserSession | undefined) => {
    activeSession.current = value;
    setSession(value);
  }, []);

  useEffect(() => {
    let active = true;
    if (!config) {
      setRestoring(false);
      return;
    }
    void restoreSession(config)
      .then((value) => {
        if (active) acceptSession(value);
      })
      .catch(() => {
        if (active) setError("Sign-in could not be completed. Try again.");
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [config, acceptSession]);

  useEffect(
    () =>
      watchScreen((next, deletion) => {
        setScreen(next);
        setDeletionIntent(deletion);
        setReturning(checkoutReturned());
      }),
    [],
  );

  const leave = useCallback(
    async (message = "", reason = "") => {
      acceptSession(undefined);
      setNotice(message);
      setError(reason);
      try {
        await signOut();
      } catch {
        setError("Could not clear the saved session. Reload to try again.");
      }
    },
    [acceptSession],
  );

  const expire = useCallback(() => {
    if (activeSession.current === session)
      void leave("", "Your session expired. Sign in again.");
  }, [leave, session]);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      expire,
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session, expire]);

  const navigate = useCallback<Navigate>((next) => {
    setScreen(next);
    setDeletionIntent(false);
    setReturning(false);
    writeScreen(next);
  }, []);

  const configured = config && canSignIn(config);
  async function login(next = screen) {
    if (!config || !configured || signingIn) return;
    setSigningIn(true);
    setError("");
    setNotice("");
    try {
      const value = await signIn(config, next);
      if (value) {
        acceptSession(value);
        if (!deletionIntent) navigate(next);
      }
    } catch {
      setError("Sign-in could not be completed. Try again.");
    } finally {
      setSigningIn(false);
    }
  }

  if (config && session && !restoring) {
    return (
      <SignedIn
        config={config}
        session={session}
        screen={screen}
        navigate={navigate}
        expire={expire}
        leave={leave}
        deletionIntent={deletionIntent}
        returning={returning}
        compact={compact}
        wide={wide}
      />
    );
  }

  return (
    <>
      <Header
        screen={screen}
        navigate={navigate}
        sessionAction={
          restoring
            ? undefined
            : {
                label: "Sign in",
                run: () => void login(),
                busy: signingIn,
                disabled: !configured,
              }
        }
      />
      {restoring ? (
        <View style={styles.center}>
          <Loading>Opening Founder Village…</Loading>
        </View>
      ) : (
        <ScrollView
          role="main"
          style={styles.scroll}
          contentContainerStyle={[
            styles.wrap,
            styles.welcome,
            compact && [styles.compactWrap, styles.welcomeCompact],
          ]}
        >
          <Hero
            wide={wide}
            fontSize={
              wide
                ? Math.min(74, Math.round(width * 0.058))
                : Math.min(46, Math.round(width * 0.118))
            }
            title={
              deletionIntent ? (
                "Delete your member profile"
              ) : (
                <>
                  {"Good things\n"}
                  <Text style={styles.heroAccent}>grow together.</Text>
                </>
              )
            }
          >
            <Text style={styles.intro}>
              {deletionIntent
                ? "Sign in to remove your directory profile and contact details."
                : "Meet your community, manage your membership, and find the Founder Village workspaces you use."}
            </Text>
            {notice !== "" && <Notice>{notice}</Notice>}
            <ErrorMessage message={error} />
            {!configured && (
              <Text style={styles.small}>
                Sign-in is unavailable in this environment.
              </Text>
            )}
            <View style={styles.wrapRow}>
              <Button
                label={
                  deletionIntent
                    ? "Sign in to continue"
                    : screen !== "home"
                      ? "Sign in"
                      : "Create free account"
                }
                onPress={() =>
                  void login(screen === "home" ? "profile" : screen)
                }
                busy={signingIn}
                disabled={!configured}
              />
            </View>
          </Hero>
        </ScrollView>
      )}
    </>
  );
}

function allowsNavigation(access: WorkspaceAccess) {
  return (
    access.status === "error" ||
    (access.status === "ready" && access.data.length > 0)
  );
}

function SignedIn({
  config,
  session,
  screen,
  navigate,
  expire,
  leave,
  deletionIntent,
  returning,
  compact,
  wide,
}: {
  config: RuntimeConfig;
  session: BrowserSession;
  screen: Screen;
  navigate: Navigate;
  expire: () => void;
  leave: (notice?: string) => Promise<void>;
  deletionIntent: boolean;
  returning: boolean;
  compact: boolean;
  wide: boolean;
}) {
  const send = useMemo(
    () => createRequester(config, session, expire),
    [config, session, expire],
  );
  const client = useMemo(() => workspaceApi(send), [send]);
  const deliveries = useResource(
    client.deliveryWorkspaces,
    "Could not check access to food deliveries.",
  );
  const teams = useResource(
    client.teamWorkspaces,
    "Could not check access to your team.",
  );
  const sections: Screen[] = ["home", "directory", "membership"];
  if (allowsNavigation(deliveries)) sections.push("deliveries");
  if (allowsNavigation(teams)) sections.push("engineering", "chats");
  sections.push("profile");

  return (
    <>
      <Header
        sections={sections}
        screen={screen}
        navigate={navigate}
        sessionAction={{ label: "Sign out", run: () => void leave() }}
      />
      <View role="main" style={styles.scroll}>
        <Suspense
          fallback={
            <View style={styles.center}>
              <Loading>Opening {screenNames[screen].toLowerCase()}…</Loading>
            </View>
          }
        >
          {screen === "home" ? (
            <Home
              sections={sections}
              wide={wide}
              compact={compact}
              navigate={navigate}
            />
          ) : screen === "deliveries" ? (
            <WorkspaceGate
              key="deliveries"
              title="Food deliveries"
              noAccess={deliveryAccessMessage}
              access={deliveries}
              compact={compact}
            >
              {(workspace) => (
                <Deliveries client={client} tenantId={workspace.id} />
              )}
            </WorkspaceGate>
          ) : screen === "engineering" ? (
            <WorkspaceGate
              key="engineering"
              title="Team engineering"
              noAccess={teamAccessMessage}
              access={teams}
              compact={compact}
            >
              {(workspace) => (
                <Engineering client={client} tenantId={workspace.id} />
              )}
            </WorkspaceGate>
          ) : screen === "chats" ? (
            <WorkspaceGate
              key="chats"
              title="Bot chats"
              noAccess={teamAccessMessage}
              access={teams}
              compact={compact}
            >
              {(workspace) => <Chats client={client} tenantId={workspace.id} />}
            </WorkspaceGate>
          ) : (
            <MemberArea
              send={send}
              screen={screen}
              navigate={navigate}
              leave={leave}
              deletionIntent={deletionIntent}
              returning={returning}
              compact={compact}
              wide={wide}
            />
          )}
        </Suspense>
      </View>
    </>
  );
}

function MemberArea({
  send,
  screen,
  navigate,
  leave,
  deletionIntent,
  returning,
  compact,
  wide,
}: {
  send: Requester;
  screen: "directory" | "membership" | "profile";
  navigate: Navigate;
  leave: (notice?: string) => Promise<void>;
  deletionIntent: boolean;
  returning: boolean;
  compact: boolean;
  wide: boolean;
}) {
  const api = useMemo(() => memberApi(send), [send]);
  const initial = useResource(
    api.profile,
    "Could not load your profile. Try again.",
  );
  const [saved, setSaved] = useState<Profile>();
  const profile =
    saved ?? (initial.status === "ready" ? initial.data : undefined);
  if (profile === undefined)
    return (
      <View style={styles.center}>
        <RequestFeedback state={initial} loading="Opening your membership…" />
      </View>
    );

  if (!profile || screen === "profile")
    return (
      <ProfileScreen
        key={`${profile?.id ?? "new"}:${deletionIntent}`}
        api={api}
        profile={profile}
        compact={compact}
        deletionIntent={deletionIntent}
        onSave={(value) => {
          setSaved(value);
          if (!profile && screen === "profile") navigate("directory");
        }}
        onDelete={() => void leave("Your member profile was deleted.")}
        onCancelDeletion={() => navigate("profile")}
      />
    );
  if (screen === "membership")
    return <Billing api={api} compact={compact} returning={returning} />;
  return (
    <Directory
      api={api}
      compact={compact}
      wide={wide}
      onMembership={() => navigate("membership")}
    />
  );
}

function Hero({
  title,
  wide,
  fontSize,
  home = false,
  children,
}: {
  title: React.ReactNode;
  wide: boolean;
  fontSize: number;
  home?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.hero,
        wide && (home ? styles.homeHeroWide : styles.heroWide),
      ]}
    >
      <View style={[styles.heroCopy, wide && styles.heroCopyWide]}>
        <Text
          accessibilityRole="header"
          style={[
            styles.heroTitle,
            {
              fontSize,
              lineHeight: fontSize + 2,
              letterSpacing: -fontSize * 0.05,
            },
          ]}
        >
          {title}
        </Text>
        {children}
      </View>
      <View
        style={[
          styles.heroImage,
          home
            ? [styles.homeImage, wide && styles.homeImageWide]
            : wide && styles.heroImageWide,
        ]}
      >
        <Image
          source={communityArtwork}
          style={styles.imageFill}
          resizeMode="cover"
          accessible={false}
        />
      </View>
    </View>
  );
}

function Home({
  sections,
  wide,
  compact,
  navigate,
}: {
  sections: Screen[];
  wide: boolean;
  compact: boolean;
  navigate: Navigate;
}) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.wrap,
        styles.home,
        compact && styles.compactWrap,
      ]}
    >
      <Hero
        home
        wide={wide}
        fontSize={wide ? 61 : 43}
        title={
          <>
            {"Welcome to\n"}
            <Text style={styles.heroAccent}>the Village.</Text>
          </>
        }
      />
      <View style={styles.featureCards}>
        {sections
          .filter((id) => id !== "home" && id !== "profile")
          .map((id) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={screenNames[id]}
              onPress={() => navigate(id)}
              style={({ pressed }) => [
                styles.card,
                styles.featureCard,
                wide && styles.featureCardWide,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.row}>
                <Text style={[styles.subheading, styles.featureCardTitle]}>
                  {screenNames[id]}
                </Text>
                <Text accessible={false} style={styles.optionLabel}>
                  ↗
                </Text>
              </View>
              <Text style={styles.text}>{descriptions[id]}</Text>
            </Pressable>
          ))}
      </View>
    </ScrollView>
  );
}
