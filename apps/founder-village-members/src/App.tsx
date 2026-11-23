import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { BrowserSession } from "@founder-village/frontend-platform";
import { actionError, memberApi } from "./api";
import { communityArtwork } from "./art";
import { Directory } from "./Directory";
import type { Profile } from "./generated/contracts/index";
import { ProfileScreen } from "./Profile";
import {
  canSignIn,
  checkoutReturned,
  getConfig,
  initialScreen,
  restoreSession,
  showDeletion,
  signIn,
  signOut,
} from "./session";
import { styles } from "./theme";
import { Brand, Button, ErrorMessage, Loading } from "./ui";
import { Viewport } from "./Viewport";

const Billing = lazy(() => import("./Billing"));

type Screen = "directory" | "membership" | "profile";
const screens: { id: Screen; name: string }[] = [
  { id: "directory", name: "Directory" },
  { id: "membership", name: "Membership" },
  { id: "profile", name: "Profile" },
];

function Navigation({
  screen,
  setScreen,
  small,
}: {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  small?: boolean;
}) {
  return (
    <View
      accessibilityRole="navigation"
      style={[styles.nav, small && styles.navMobile]}
    >
      {screens.map(({ id, name }) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          accessibilityState={{ selected: screen === id }}
          style={({ pressed }) => [
            styles.navButton,
            screen === id && styles.navActive,
            pressed && styles.pressed,
          ]}
          onPress={() => setScreen(id)}
        >
          <Text style={[styles.navText, screen === id && styles.navActiveText]}>
            {name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function App() {
  return (
    <Viewport>
      <MembersApp />
    </Viewport>
  );
}

function MembersApp() {
  const { width } = useWindowDimensions();
  const compact = width < 650;
  const wide = width >= 900;
  const heroFontSize = wide
    ? Math.min(74, Math.round(width * 0.058))
    : Math.min(46, Math.round(width * 0.118));
  const [config] = useState(() => {
    try {
      return getConfig();
    } catch {
      return undefined;
    }
  });
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [deletionIntent, setDeletionIntent] = useState(showDeletion);
  const [returning] = useState(checkoutReturned);
  const [session, setSession] = useState<BrowserSession>();
  const [restoring, setRestoring] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [profile, setProfile] = useState<Profile | null>();
  const [sessionError, setSessionError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    if (!config) {
      setRestoring(false);
      return;
    }
    void restoreSession(config)
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active)
          setSessionError("Sign-in could not be completed. Try again.");
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [config]);

  const leave = useCallback(async (message?: string, error?: string) => {
    setSession(undefined);
    setProfile(undefined);
    setProfileError("");
    setNotice(message ?? "");
    setSessionError(error ?? "");
    try {
      await signOut();
    } catch {
      setSessionError(
        "Could not clear the saved session. Try signing out again.",
      );
    }
  }, []);

  const api = useMemo(
    () =>
      config && session
        ? memberApi(config, session, () => {
            void leave(undefined, "Your session expired. Sign in again.");
          })
        : undefined,
    [config, session, leave],
  );

  useEffect(() => {
    if (!api) return;
    let active = true;
    setProfileError("");
    void api
      .profile()
      .then((record) => {
        if (active) setProfile(record);
      })
      .catch((error: unknown) => {
        if (active)
          setProfileError(
            actionError(error, "Could not load your profile. Try again."),
          );
      });
    return () => {
      active = false;
    };
  }, [api, reload]);

  async function login() {
    if (!config || !canSignIn(config)) {
      setSessionError("Sign-in is unavailable on this build.");
      return;
    }
    if (signingIn) return;
    setSigningIn(true);
    setSessionError("");
    setNotice("");
    try {
      const next = await signIn(config);
      if (next) setSession(next);
    } catch {
      setSessionError("Sign-in could not be completed. Try again.");
    } finally {
      setSigningIn(false);
    }
  }

  function navigate(next: Screen) {
    setDeletionIntent(false);
    setScreen(next);
  }

  return (
    <>
      <View style={styles.headerBar}>
        <View
          style={[styles.wrap, styles.header, compact && styles.compactWrap]}
        >
          <Brand />
          {profile && !compact && (
            <Navigation screen={screen} setScreen={navigate} />
          )}
          {!session && !restoring && (
            <Button
              variant="quiet"
              label="Sign in"
              onPress={() => void login()}
              disabled={signingIn}
            />
          )}
          {session && !profile && (
            <Button
              variant="quiet"
              label="Sign out"
              onPress={() => void leave()}
            />
          )}
        </View>
        {profile && compact && (
          <View style={[styles.wrap, styles.compactWrap]}>
            <Navigation small screen={screen} setScreen={navigate} />
          </View>
        )}
      </View>
      {restoring || (session && profile === undefined && !profileError) ? (
        <View style={styles.center}>
          <Loading>Opening Founder Village…</Loading>
        </View>
      ) : !api ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.wrap,
            styles.welcome,
            compact && [styles.compactWrap, styles.welcomeCompact],
          ]}
        >
          <View style={[styles.hero, wide && styles.heroWide]}>
            <View style={[styles.heroCopy, wide && styles.heroCopyWide]}>
              <Text
                accessibilityRole="header"
                style={[
                  styles.heroTitle,
                  {
                    fontSize: heroFontSize,
                    lineHeight: heroFontSize + 2,
                    letterSpacing: -heroFontSize * 0.05,
                  },
                ]}
              >
                {deletionIntent ? (
                  "Delete your account"
                ) : (
                  <>
                    {"Good things\n"}
                    <Text style={styles.heroAccent}>grow together.</Text>
                  </>
                )}
              </Text>
              <Text style={styles.intro}>
                {deletionIntent
                  ? "Sign in to delete your Founder Village Members profile and contact details."
                  : "Meet the people of Founder Village and take the conversation to WhatsApp."}
              </Text>
              {notice !== "" && (
                <Text accessibilityLiveRegion="polite" style={styles.success}>
                  {notice}
                </Text>
              )}
              <ErrorMessage message={sessionError} />
              <View style={styles.wrapRow}>
                <Button
                  label={
                    deletionIntent
                      ? "Sign in to continue"
                      : "Create free account"
                  }
                  onPress={() => void login()}
                  busy={signingIn}
                />
              </View>
            </View>
            <View style={[styles.heroImage, wide && styles.heroImageWide]}>
              <Image
                source={communityArtwork}
                style={styles.imageFill}
                resizeMode="cover"
                accessible={false}
              />
            </View>
          </View>
        </ScrollView>
      ) : profile === undefined ? (
        <View style={styles.center}>
          <ErrorMessage message={profileError} />
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => setReload((count) => count + 1)}
          />
        </View>
      ) : profile === null || screen === "profile" ? (
        <ProfileScreen
          key={profile?.id ?? "new"}
          api={api}
          profile={profile}
          compact={compact}
          deletionIntent={deletionIntent}
          onSave={(saved) => {
            setProfile(saved);
            if (!profile) setScreen("directory");
          }}
          onDelete={() => void leave("Your account was deleted.")}
          onSignOut={() => void leave()}
        />
      ) : screen === "membership" ? (
        <Suspense
          fallback={
            <View style={styles.center}>
              <Loading>Loading membership…</Loading>
            </View>
          }
        >
          <Billing api={api} compact={compact} returning={returning} />
        </Suspense>
      ) : (
        <Directory
          api={api}
          compact={compact}
          wide={wide}
          onMembership={() => navigate("membership")}
        />
      )}
    </>
  );
}
