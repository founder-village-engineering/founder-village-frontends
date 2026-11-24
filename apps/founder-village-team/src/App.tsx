import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  beginSignIn,
  clearSession,
  completeSignIn,
  saveDevelopmentSession,
  hasOidc,
  runtimeConfig,
  type BrowserSession,
  type RuntimeConfig,
} from "@founder-village/frontend-platform";
import { z } from "zod";
import { applicationId, tenantsSchema } from "./generated/contracts/index.ts";
import { teamClient, userError } from "./client.ts";
const Workspace = lazy(async () => ({
  default: (await import("./Workspace.tsx")).Workspace,
}));
import leaf from "./assets/monstera.svg";
import greenhouse from "./assets/greenhouse.jpg";

const config = (() => {
  try {
    return runtimeConfig();
  } catch {
    return undefined;
  }
})();
// StrictMode may mount twice. An authorization code can be exchanged only once.
const localOrigin =
  location.origin === "https://team.fv" ||
  location.origin === "http://127.0.0.1:43912";
async function restore(config: RuntimeConfig) {
  const code = new URLSearchParams(location.hash.slice(1)).get("team-login");
  if (code === null) return completeSignIn(config);
  history.replaceState({}, "", "/");
  if (
    !localOrigin ||
    config.apiOrigin !== "https://api.fv" ||
    !/^[A-Za-z0-9_-]{43}$/.test(code)
  )
    throw new Error("Invalid local sign-in");
  const response = await fetch(config.apiOrigin + "/v1/team/local-login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-application-id": applicationId,
    },
    body: JSON.stringify({ code }),
    cache: "no-store",
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Local sign-in expired");
  const { accessToken, expiresIn } = z
    .object({
      accessToken: z.string().regex(/^fvteam_[A-Za-z0-9_-]{43}$/),
      expiresIn: z.literal(900),
    })
    .parse(await response.json());
  return saveDevelopmentSession(accessToken, expiresIn);
}
const restored = config
  ? restore(config)
      .then((session) => ({ session, error: "" }))
      .catch(() => ({
        session: undefined,
        error: "Sign-in could not be completed. Try again.",
      }))
  : Promise.resolve({ session: undefined, error: "" });
export function Brand() {
  return (
    <div className="brand">
      <img src={leaf} alt="" width="28" height="28" />
      <span>
        Founder Village <strong>Team</strong>
      </span>
    </div>
  );
}
export function App() {
  const [auth, setAuth] = useState<{
    session?: BrowserSession;
    error: string;
  } | null>(null);
  const session = auth?.session;
  const leave = useCallback(() => {
    clearSession();
    window.history.replaceState({}, "", "/");
    setAuth({ error: "" });
  }, []);
  useEffect(() => {
    let live = true;
    void restored.then((result) => {
      if (!live) return;
      setAuth(result);
      if (location.pathname === "/auth/callback")
        window.history.replaceState({}, "", "/");
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      leave,
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session, leave]);
  if (!auth)
    return (
      <main className="status">
        <Brand />
        <p role="status">Opening workspace…</p>
      </main>
    );
  if (session && config)
    return <TeamGate session={session} config={config} onLeave={leave} />;
  return (
    <main className="entry">
      <div className="entryCopy">
        <Brand />
        <section>
          <h1>Team workspace</h1>
          <p>
            Work with your team’s bots and pick up your private conversations.
          </p>
          {config && hasOidc(config) ? (
            <button
              className="primary"
              onClick={() =>
                void beginSignIn(config).catch(() =>
                  setAuth({
                    error: "Sign-in could not be started. Try again.",
                  }),
                )
              }
            >
              Sign in to your team <span aria-hidden="true">↗</span>
            </button>
          ) : (
            <p role="status" className="notice">
              {localOrigin ? (
                <>
                  Open a single-use link with{" "}
                  <code>npm run team:login -- &lt;local-member&gt;</code> in the
                  runtime checkout.
                </>
              ) : (
                "Team sign-in hasn’t been configured for this environment."
              )}
            </p>
          )}
          {auth.error && <p role="alert">{auth.error}</p>}
        </section>
      </div>
      <div className="entryImage">
        <img
          src={greenhouse}
          alt="A greenhouse surrounded by the village garden"
        />
      </div>
    </main>
  );
}

function TeamGate({
  config,
  session,
  onLeave,
}: {
  config: RuntimeConfig;
  session: BrowserSession;
  onLeave: () => void;
}) {
  const client = useMemo(() => teamClient(config, session), [config, session]);
  type Memberships = {
    teams: { id: string; name: string }[];
    selected: string;
  };
  const [membership, setMembership] = useState<Memberships | Error>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void client
      .get("/team/tenants", tenantsSchema, controller.signal)
      .then((teams) => {
        if (!controller.signal.aborted)
          setMembership({ teams, selected: teams[0]?.id ?? "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setMembership(new Error(userError(e)));
      });
    return () => controller.abort();
  }, [client, attempt]);
  const error = membership instanceof Error ? membership.message : "";
  const selection = membership instanceof Error ? undefined : membership;
  const team = selection?.selected ?? "";
  const teams = selection?.teams;
  const scoped = useMemo(
    () => teamClient(config, session, team),
    [config, session, team],
  );
  return (
    <main className="shell">
      <header className="topbar">
        <Brand />
        <div className="account">
          {teams && teams.length > 1 && (
            <label>
              Workspace{" "}
              <select
                value={team}
                onChange={(e) => {
                  location.hash = "";
                  setMembership({ teams, selected: e.target.value });
                }}
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="quiet" onClick={onLeave}>
            Sign out
          </button>
        </div>
      </header>
      {error ? (
        <section className="status">
          <p role="alert">{error}</p>
          <button
            onClick={() => {
              setMembership(undefined);
              setAttempt((v) => v + 1);
            }}
          >
            Try again
          </button>
        </section>
      ) : team ? (
        <Suspense
          fallback={
            <p role="status" className="status">
              Opening workspace…
            </p>
          }
        >
          <Workspace
            key={team}
            client={scoped}
            name={teams?.find((t) => t.id === team)?.name ?? "Workspace"}
          />
        </Suspense>
      ) : (
        <section className="status">
          <h1>{teams ? "No team access yet" : "Opening workspace…"}</h1>
          {teams && (
            <p>Ask your workspace owner to add your account to the team.</p>
          )}
        </section>
      )}
    </main>
  );
}
