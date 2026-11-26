import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  hasOidc,
  parseRuntimeConfig,
} from "../packages/frontend-platform/src/config.ts";
import { parseJsonc } from "./jsonc.ts";
import {
  customOrigins,
  loadApp,
  pagesTargets,
  productionOrigins,
  repositoryRoot,
  type LoadedApp,
  type PagesTarget,
} from "./manifest.ts";
import { PagesDomains, verifyPagesProject } from "./pages-domains.ts";

const execute = promisify(execFile);
const wrangler = resolve(repositoryRoot, "node_modules/.bin/wrangler");
const pagesState = resolve(repositoryRoot, ".state/pages");
const releaseOutput = resolve(repositoryRoot, "dist");
const defaultAccountBinding = resolve(
  repositoryRoot,
  "../founder-village-runtime/.state/operator/founder-cloudflare.private.json",
);

type PagesCredential = Readonly<{ account: string; token: string }>;
const bearerPattern = /^[\x21-\x7e]{1,2048}$/;
const wranglerLoginHint = "Run npm run pages -- login and authorize Wrangler in the Founder Chrome profile.";

export function pagesBuildEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) =>
        !/^(CLOUDFLARE_|CF_|WRANGLER_|FV_PAGES_API_TOKEN(?:$|_FILE$))/.test(key) &&
        (!env.CLOUDFLARE_API_TOKEN || value !== env.CLOUDFLARE_API_TOKEN) &&
        (!env.FV_PAGES_API_TOKEN || value !== env.FV_PAGES_API_TOKEN),
    ),
  );
}

async function protectedText(path: string, mounted = false) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.uid !== process.getuid?.() && !(mounted && stat.uid === 0)) || (stat.mode & 0o077) !== 0 || stat.size > 65536)
      throw new Error("unsafe private Pages input");
    return await file.readFile("utf8");
  } finally { await file.close(); }
}

async function pagesAccount(env: NodeJS.ProcessEnv): Promise<string> {
  let binding: { account_id?: unknown; zone_name?: unknown };
  try {
    binding = JSON.parse(await protectedText(env.FV_PAGES_CLOUDFLARE_BINDING ?? defaultAccountBinding));
  } catch {
    throw new Error(
      "Pages requires the owner-only Founder Cloudflare account binding.",
    );
  }
  const account = binding?.account_id;
  if (typeof account !== "string" || !/^[0-9a-f]{32}$/.test(account) || binding.zone_name !== "foundervillage.org" ||
      (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== account))
    throw new Error("Pages credential differs from the bound Founder account.");
  return account;
}

export async function pagesCredential(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PagesCredential> {
  if (env.CLOUDFLARE_AUTH_PROFILE)
    throw new Error("Pages uploads require an explicit Founder account bearer.");
  const account = await pagesAccount(env);
  let token = env.FV_PAGES_API_TOKEN ?? (env.CLOUDFLARE_ACCOUNT_ID === account ? env.CLOUDFLARE_API_TOKEN : undefined);
  if (!token || env.FV_PAGES_API_TOKEN_FILE) {
    const path = env.FV_PAGES_API_TOKEN_FILE ?? resolve(env.CREDENTIALS_DIRECTORY ?? resolve(homedir(), ".config/founder-village/production/credentials"), "FV_PAGES_API_TOKEN");
    token = await protectedText(path, true)
      .then((value) => value.trim())
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" && !env.FV_PAGES_API_TOKEN_FILE)
          return undefined;
        throw new Error("The configured Pages credential file must be readable and owner-only.");
      });
  }
  token ??= await wranglerSessionToken(account, env);
  if (!bearerPattern.test(token))
    throw new Error("The configured Pages credential is invalid.");
  return { account, token };
}

function wranglerEnvironment(
  account: string,
  directory: string,
): NodeJS.ProcessEnv {
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    XDG_CACHE_HOME: directory,
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_API_BASE_URL: "https://api.cloudflare.com/client/v4",
    CI: "true",
    WRANGLER_SEND_METRICS: "false",
  };
}

export function pagesUploaderEnvironment(
  credential: PagesCredential,
  directory: string,
): NodeJS.ProcessEnv {
  return {
    ...wranglerEnvironment(credential.account, directory),
    CLOUDFLARE_API_TOKEN: credential.token,
  };
}

async function wranglerSessionEnvironment(
  account: string,
  env: NodeJS.ProcessEnv,
  create = false,
): Promise<NodeJS.ProcessEnv> {
  const directory = resolve(
    env.HOME ?? homedir(),
    ".config/founder-village/production/wrangler",
  );
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const state = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error(wranglerLoginHint);
    throw new Error("Could not access the Founder Wrangler login directory.");
  });
  if (!state.isDirectory() || state.uid !== process.getuid?.() || (state.mode & 0o077) !== 0)
    throw new Error("The Founder Wrangler login directory must be owner-only.");
  return wranglerEnvironment(account, directory);
}

async function wranglerSessionToken(
  account: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const session = await wranglerSessionEnvironment(account, env);
  try {
    const output = await runWrangler(["auth", "token", "--json"], () => session);
    const credential = z.object({
      type: z.literal("oauth"),
      token: z.string().regex(bearerPattern),
    }).safeParse(JSON.parse(output));
    if (credential.success) return credential.data.token;
  } catch {
    // Wrangler manages refresh, storage, and expiry. Its raw output stays private.
  }
  throw new Error(`The Founder Wrangler login is unavailable. ${wranglerLoginHint}`);
}

type PublicRuntimeConfig = {
  apiOrigin: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  clientId?: string;
  audience?: string;
};

const revisionSchema = z.string().regex(/^[0-9a-f]{40}$/);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const releaseSchema = z.object({
  app: z.string(),
  revision: revisionSchema.nullable(),
  dirty: z.boolean(),
  indexSha256: digestSchema,
  configSha256: digestSchema,
});
type Release = z.infer<typeof releaseSchema>;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; capture?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const env = {
    ...(options.env ?? pagesBuildEnvironment()),
    WRANGLER_SEND_METRICS: "false",
  };
  if (options.capture) {
    try {
      const result = await execute(command, args, {
        cwd: options.cwd ?? repositoryRoot,
        env,
        maxBuffer: 4 * 1024 * 1024,
      });
      return result.stdout;
    } catch {
      throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed`);
    }
  }
  await new Promise<void>((accept, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`${command} exited ${code ?? "without status"}`)),
    );
  });
  return "";
}

async function runWrangler(
  args: string[],
  environment: (isolated: string) => NodeJS.ProcessEnv,
  options: { cwd?: string; capture?: boolean } = {},
): Promise<string> {
  const isolated = await mkdtemp(resolve(tmpdir(), "fv-pages-"));
  try {
    const blankEnv = resolve(isolated, "empty.env");
    await writeFile(blankEnv, "", { mode: 0o600, flag: "wx" });
    return await run(wrangler, [...args, "--env-file", blankEnv], {
      cwd: options.cwd ?? isolated,
      capture: options.capture ?? true,
      env: environment(isolated),
    });
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
}

async function runPagesUploader(
  credential: PagesCredential,
  args: string[],
  cwd = repositoryRoot,
): Promise<string> {
  return runWrangler(args, (isolated) => pagesUploaderEnvironment(credential, isolated), { cwd });
}

async function login(): Promise<void> {
  const account = await pagesAccount(process.env);
  const session = await wranglerSessionEnvironment(account, process.env, true);
  const previousMask = process.umask(0o077);
  try {
    await runWrangler(
      ["login", "--device", "--browser=false", "--use-keyring", "--scopes", "account:read", "user:read", "pages:write"],
      () => session,
      { capture: false },
    );
  } finally {
    process.umask(previousMask);
  }
  const token = await wranglerSessionToken(account, process.env);
  await projects({ account, token });
  console.log("Wrangler login verified for the bound Founder account.");
}

function exactHttps(value: string, label: string, originOnly: boolean): string {
  const url = URL.parse(value);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (originOnly && (url.origin !== value || url.pathname !== "/" || url.search))
  )
    throw new Error(
      `${label} must be a public HTTPS ${originOnly ? "origin" : "URL"}`,
    );
  return value;
}

export function productionRuntimeConfig(app: LoadedApp, pagesOnly = false): PublicRuntimeConfig {
  const apiOrigin =
    process.env.FV_RUNTIME_API_ORIGIN || app.manifest.runtimeApiOrigin;
  const authorizationEndpoint = process.env.FV_OIDC_AUTHORIZATION_ENDPOINT;
  const tokenEndpoint = process.env.FV_OIDC_TOKEN_ENDPOINT;
  const clientId = process.env.FV_OIDC_CLIENT_ID;
  const audience = process.env.FV_OIDC_AUDIENCE;
  if (!apiOrigin) throw new Error("A registered public runtime API origin is required");
  const api = new URL(exactHttps(apiOrigin, "runtime API", true));
  if (
    app.manifest.runtimeApiOrigin &&
    api.origin !== app.manifest.runtimeApiOrigin
  )
    throw new Error("runtime API origin differs from the app manifest");
  if (
    api.hostname.endsWith(".test") ||
    api.hostname.endsWith(".fv") ||
    api.hostname === "example.com" ||
    api.hostname.endsWith(".example.com")
  )
    throw new Error("runtime API must not be a placeholder or local hostname");
  if (pagesOnly && [authorizationEndpoint, tokenEndpoint, clientId, audience].every(value => value === undefined))
    return { apiOrigin: api.origin };
  if (!authorizationEndpoint || !tokenEndpoint || !clientId)
    throw new Error("The public OIDC endpoints and client ID must be supplied together");
  if (clientId.length > 512 || (audience?.length ?? 0) > 512)
    throw new Error("OIDC public identifier is too long");
  return {
    apiOrigin: api.origin,
    authorizationEndpoint: exactHttps(
      authorizationEndpoint,
      "OIDC authorization endpoint",
      false,
    ),
    tokenEndpoint: exactHttps(tokenEndpoint, "OIDC token endpoint", false),
    clientId,
    audience: audience || undefined,
  };
}

function runtimeScript(config: PublicRuntimeConfig): string {
  return `window.__FOUNDER_VILLAGE_CONFIG__ = Object.freeze(${JSON.stringify(config)});\n`;
}

function testRuntimeConfig(): PublicRuntimeConfig {
  return { apiOrigin: "https://api.example.test" };
}

async function build(app: LoadedApp, dist: string): Promise<void> {
  await run("npm", ["run", "build", "--", "--outDir", dist], {
    cwd: app.directory,
  });
}

async function outputFiles(root: string, current = root): Promise<string[]> {
  const stat = await lstat(current);
  if (stat.isSymbolicLink())
    throw new Error(`deployment symlink refused: ${current}`);
  if (stat.isFile()) return [current];
  if (!stat.isDirectory())
    throw new Error(`unsupported deployment entry: ${current}`);
  const entries = await readdir(current);
  return (
    await Promise.all(
      entries.sort().map((entry) => outputFiles(root, resolve(current, entry))),
    )
  ).flat();
}

async function writeRuntimeConfig(
  dist: string,
  config: PublicRuntimeConfig,
): Promise<void> {
  const output = resolve(dist, "runtime-config.js");
  await writeFile(output, runtimeScript(config));
  await writeFile(resolve(dist, "_headers"), deploymentHeaders(config));
}

export function deploymentHeaders(config: PublicRuntimeConfig): string {
  const connections = new Set([new URL(config.apiOrigin).origin]);
  if (config.tokenEndpoint)
    connections.add(new URL(config.tokenEndpoint).origin);
  const connectSource = ["'self'", ...connections].join(" ");
  return `/*
  Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src ${connectSource}; form-action 'self'; upgrade-insecure-requests
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/runtime-config.js
  Cache-Control: no-store

/release.json
  Cache-Control: no-store
`;
}

async function inspect(
  app: LoadedApp,
  dist: string,
  mode: "test" | "production",
) {
  const configPath = resolve(app.directory, "wrangler.jsonc");
  const config = parseJsonc(await readFile(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  if (
    config.name !== app.manifest.pagesProject ||
    config.pages_build_output_dir !== "./dist" ||
    typeof config.main === "string" ||
    config.workers_dev !== undefined ||
    config.route !== undefined ||
    config.routes !== undefined
  )
    throw new Error("Wrangler config is not a static Pages-only configuration");
  const files = await outputFiles(dist);
  if (files.length === 0 || files.length > 20_000)
    throw new Error("Pages output file count is invalid");
  const relativeFiles = files.map((file) =>
    relative(dist, file).split(sep).join("/"),
  );
  if (relativeFiles.some((file) => /^_worker\.[^/]+(?:\/|$)/.test(file)))
    throw new Error("Worker entrypoints are forbidden in frontend output");
  const appFunctions = await lstat(resolve(app.directory, "functions")).catch(
    (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    },
  );
  if (
    appFunctions ||
    relativeFiles.some((file) => file.startsWith("functions/"))
  )
    throw new Error("Pages Functions are forbidden in frontend output");
  for (const file of files)
    if ((await lstat(file)).size > 25 * 1024 * 1024)
      throw new Error(
        `Pages output file exceeds 25 MiB: ${relative(dist, file)}`,
      );
  const index = await readFile(resolve(dist, "index.html"), "utf8");
  if (!index.includes(`name="fv-app" content="${app.manifest.slug}"`))
    throw new Error("built index is missing the app identity marker");
  const headers = await readFile(resolve(dist, "_headers"), "utf8");
  const connectDirective = headers
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("connect-src "));
  if (!connectDirective || connectDirective.split(/\s+/).includes("https:"))
    throw new Error("Pages CSP must use exact connection origins");
  const digest = createHash("sha256");
  for (const file of [...files].sort()) {
    digest.update(relative(dist, file));
    digest.update("\0");
    digest.update(await readFile(file));
    digest.update("\0");
  }
  const receipt = {
    version: 1,
    app: app.manifest.slug,
    pagesProject: app.manifest.pagesProject,
    productionOrigin: app.manifest.productionOrigin,
    pagesTargets: pagesTargets(app.manifest),
    customOrigins: customOrigins(app.manifest),
    configuration: mode,
    files: files.length,
    sha256: digest.digest("hex"),
    createdAt: new Date().toISOString(),
  };
  await mkdir(pagesState, { recursive: true });
  await writeFile(
    resolve(pagesState, `${app.manifest.slug}.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeRelease(app: LoadedApp, dist: string): Promise<Release> {
  const [git, index, config] = await Promise.all([
    gitMetadata(),
    readFile(resolve(dist, "index.html")),
    readFile(resolve(dist, "runtime-config.js")),
  ]);
  const release = {
    app: app.manifest.slug,
    revision: git.hash ?? null,
    dirty: git.dirty,
    indexSha256: sha256(index),
    configSha256: sha256(config),
  };
  await writeFile(
    resolve(dist, "release.json"),
    `${JSON.stringify(release)}\n`,
  );
  return release;
}

async function plan(
  app: LoadedApp,
  config?: PublicRuntimeConfig,
  dist = resolve(app.directory, "dist"),
): Promise<Release> {
  await build(app, dist);
  await writeRuntimeConfig(dist, config ?? testRuntimeConfig());
  const release = await writeRelease(app, dist);
  const receipt = await inspect(app, dist, config ? "production" : "test");
  console.log(JSON.stringify(receipt, null, 2));
  if (!config)
    console.log("Pages plan used a non-deployable .test runtime origin.");
  return release;
}

export function projectNames(inventory: unknown): string[] {
  if (!Array.isArray(inventory))
    throw new Error("Wrangler project inventory was invalid");
  return inventory.map((row) => {
    const name = row?.name ?? row?.["Project Name"];
    if (typeof name !== "string" || !name)
      throw new Error("Wrangler project inventory contained an invalid name");
    return name;
  });
}

async function projects(credential: PagesCredential): Promise<string[]> {
  const output = await runPagesUploader(credential, [
    "pages",
    "project",
    "list",
    "--json",
  ]);
  return projectNames(JSON.parse(output));
}

type PagesDeployment = PagesTarget & { deployed?: boolean };

async function projectDeployments(
  app: LoadedApp,
  credential: PagesCredential,
  provider: PagesDomains,
  allowMissing: boolean,
): Promise<PagesDeployment[]> {
  const inventory = new Set(await projects(credential));
  return Promise.all(
    pagesTargets(app.manifest).map(async (target) => {
      if (inventory.has(target.pagesProject))
        return { ...target, ...(await provider.verifyProject(target)) };
      if (!allowMissing)
        throw new Error(
          `Pages project ${target.pagesProject} does not exist; run the explicit provision command first`,
        );
      return target;
    }),
  );
}

async function createProject(
  app: LoadedApp,
  credential: PagesCredential,
  provider: PagesDomains,
  target: PagesTarget,
): Promise<void> {
  await runPagesUploader(
    credential,
    [
      "pages",
      "project",
      "create",
      target.pagesProject,
      "--production-branch",
      "main",
      "--force",
    ],
    app.directory,
  );
  await provider.verifyProject(target);
  console.log(`Pages project provisioned: ${target.pagesProject}`);
}

async function provision(app: LoadedApp, pagesOnly = false): Promise<void> {
  const credential = await pagesCredential();
  const domains = pagesOnly ? undefined : pagesDomains(app, credential);
  const provider = domains ?? new PagesDomains(app.manifest, credential);
  await domains?.preflight();
  const targets = await projectDeployments(app, credential, provider, true);
  for (const target of targets) {
    if (target.deployed === undefined)
      await createProject(app, credential, provider, target);
    else console.log(`Pages project already exists: ${target.pagesProject}`);
  }
}

async function gitMetadata(): Promise<{ hash?: string; dirty: boolean }> {
  try {
    const hash = (
      await run("git", ["rev-parse", "HEAD"], { capture: true })
    ).trim();
    const dirty = Boolean(
      (await run("git", ["status", "--porcelain"], { capture: true })).trim(),
    );
    return { hash: revisionSchema.safeParse(hash).data, dirty };
  } catch {
    return { dirty: true };
  }
}

function pagesDomains(app: LoadedApp, credential: PagesCredential): PagesDomains | undefined {
  return app.manifest.customOrigins
    ? new PagesDomains(app.manifest, credential)
    : undefined;
}

function runtimeRevision(
  app: LoadedApp,
  production: boolean,
): string | undefined {
  const revision = process.env.FV_RUNTIME_REVISION;
  if (!revision && (!production || app.manifest.slug !== "founder-village-app"))
    return undefined;
  const expected = revisionSchema.safeParse(revision);
  if (!expected.success)
    throw new Error(
      "FV_RUNTIME_REVISION must be the production runtime commit SHA",
    );
  return expected.data;
}

async function siteConfig(
  app: LoadedApp,
  targets?: PagesDeployment[],
): Promise<PublicRuntimeConfig> {
  const configured = productionRuntimeConfig(app, true);
  if (hasOidc(configured)) return configured;
  if (targets) {
    const existing = await Promise.all(
      targets
        .filter(({ deployed }) => deployed)
        .map(({ productionOrigin }) =>
          verifyOrigin(app, productionOrigin, undefined, true),
        ),
    );
    const [current, ...others] = existing;
    if (!current) return configured;
    if (
      others.some(
        ({ release }) => release.configSha256 !== current.release.configSha256,
      )
    )
      throw new Error(
        "The Pages projects have different runtime settings. Supply the public OIDC configuration to deploy.",
      );
    return current.settings;
  }
  // Retain a prior deployment's registered sign-in on subsequent static releases.
  // The project may have no public DNS or release marker before its first upload.
  const marker = await publicRequest(app.manifest.productionOrigin + "/release.json").catch((error: Error & { cause?: { code?: string } }) => {
    if (error.cause?.code === "ENOTFOUND") return undefined;
    throw error;
  });
  if (!marker) return configured;
  await marker.body?.cancel();
  if (marker.status === 404) return configured;
  if (!marker.ok) throw new Error("Cannot verify the existing Pages release before publishing");
  return (await verifyOrigin(app, app.manifest.productionOrigin, undefined, true)).settings;
}

async function releaseArtifact(app: LoadedApp, config: PublicRuntimeConfig, dist: string) {
  const source = await gitMetadata();
  if (!source.hash || source.dirty)
    throw new Error("production Pages deploy requires a clean Git worktree");
  const release = await plan(app, config, dist);
  if (release.revision !== source.hash || release.dirty)
    throw new Error("frontend source changed while building the production artifact");
  await run("npm", ["run", "security:scan", "--", "--artifact", dist]);
  return { release, revision: source.hash };
}

async function projectDeploymentsFromCf(
  app: LoadedApp,
  profile: string,
): Promise<PagesDeployment[]> {
  const account = await pagesAccount(process.env);
  const cf = resolve(repositoryRoot, "../founder-village-runtime/node_modules/.bin/cf");
  const cwd = await mkdtemp(resolve(tmpdir(), "fv-pages-check-"));
  try {
    return await Promise.all(
      pagesTargets(app.manifest).map(async (target) => {
        const output = await run(
          cf,
          ["pages", "get", target.pagesProject, "--profile", profile, "--quiet"],
          {
            cwd,
            capture: true,
            env: {
              ...pagesBuildEnvironment(),
              CLOUDFLARE_ACCOUNT_ID: account,
              CLOUDFLARE_API_BASE_URL: "https://api.cloudflare.com/client/v4",
              CF_TELEMETRY_DISABLED: "1",
            },
          },
        );
        let project: { result?: unknown } | undefined;
        try {
          project = JSON.parse(output);
        } catch {
          throw new Error(`cf did not return a project record for ${target.pagesProject}`);
        }
        return { ...target, ...verifyPagesProject(target, project?.result ?? project) };
      }),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function bundle(app: LoadedApp, profile?: string) {
  const targets = profile ? await projectDeploymentsFromCf(app, profile) : undefined;
  const config = await siteConfig(app, targets);
  await mkdir(releaseOutput, {recursive:true});
  const staging = await mkdtemp(resolve(releaseOutput, app.manifest.pagesProject + "-"));
  const dist = resolve(staging, "dist");
  try {
    const {revision} = await releaseArtifact(app, config, dist);
    const archive = resolve(staging, app.manifest.pagesProject + "-" + revision + ".zip");
    await run("zip", ["-q", "-X", "-r", archive, "."], {cwd: dist});
    console.log(archive);
  } finally {
    await rm(dist, {recursive:true,force:true});
  }
}

async function deploy(app: LoadedApp, pagesOnly = false): Promise<void> {
  const credential = await pagesCredential();
  const revision = pagesOnly ? undefined : runtimeRevision(app, true);
  const domains = pagesOnly ? undefined : pagesDomains(app, credential);
  const provider = domains ?? new PagesDomains(app.manifest, credential);
  await domains?.preflight();
  const targets = await projectDeployments(
    app,
    credential,
    provider,
    pagesOnly,
  );
  const config = pagesOnly
    ? await siteConfig(app, targets)
    : productionRuntimeConfig(app);
  if (!pagesOnly)
    await Promise.all([
      verifyRuntime(app, config.apiOrigin, revision),
      verifyTokenOrigins(app, config),
    ]);
  await mkdir(releaseOutput, { recursive: true });
  const staging = await mkdtemp(
    resolve(releaseOutput, `${app.manifest.slug}-`),
  );
  const dist = resolve(staging, "dist");
  let release: Release;
  try {
    const artifact = await releaseArtifact(app, config, dist);
    release = artifact.release;
    for (const target of targets) {
      if (target.deployed === undefined)
        await createProject(app, credential, provider, target);
    }
    for (const target of targets) {
      await runPagesUploader(
        credential,
        [
          "pages",
          "deploy",
          dist,
          "--project-name",
          target.pagesProject,
          "--branch",
          "main",
          "--commit-dirty=false",
          "--commit-hash",
          artifact.revision,
          "--force",
        ],
        app.directory,
      ).catch((cause) => {
        throw new Error(`Upload failed for ${target.productionOrigin}`, {
          cause,
        });
      });
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await Promise.all(
    targets.map(({ productionOrigin }) =>
      waitFor(productionOrigin, () =>
        verifyOrigin(app, productionOrigin, release, pagesOnly),
      ),
    ),
  );
  if (pagesOnly) return;
  await domains?.attach();
  await waitFor("Pages custom domain activation", async () => {
    if (domains && !(await domains.active()))
      throw new Error("Cloudflare custom domains are still pending");
    await verifyAliases(app, release);
  });
  await verifyRuntime(app, config.apiOrigin, revision);
}

async function waitFor(
  label: string,
  check: () => Promise<unknown>,
): Promise<void> {
  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() >= deadline)
        throw new Error(`${label} did not verify`, { cause: error });
      await delay(5_000);
    }
  }
}

async function verifyAliases(app: LoadedApp, release: Release) {
  await Promise.all(
    customOrigins(app.manifest).map((origin) =>
      verifyOrigin(app, origin, release),
    ),
  );
}

async function verifyPages(app: LoadedApp, pagesOnly = false) {
  const result = await verifyOrigin(
    app,
    app.manifest.productionOrigin,
    undefined,
    pagesOnly,
  );
  await Promise.all(
    pagesTargets(app.manifest)
      .slice(1)
      .map(({ productionOrigin }) =>
        verifyOrigin(app, productionOrigin, result.release, pagesOnly),
      ),
  );
  return result;
}

async function verify(app: LoadedApp, production: boolean): Promise<void> {
  const revision = runtimeRevision(app, production);
  const expectedConfig = production ? productionRuntimeConfig(app) : undefined;
  const source = production ? await gitMetadata() : undefined;
  if (source && (!source.hash || source.dirty))
    throw new Error(
      "production Pages verification requires a clean Git worktree",
    );
  const { release, settings } = await verifyPages(app);
  if (source && (release.revision !== source.hash || release.dirty))
    throw new Error(
      "deployed Pages revision differs from the current checkout",
    );
  if (
    expectedConfig &&
    release.configSha256 !== sha256(runtimeScript(expectedConfig))
  )
    throw new Error(
      "deployed runtime configuration differs from production settings",
    );
  await Promise.all([
    verifyAliases(app, release),
    verifyRuntime(app, settings.apiOrigin, revision),
    verifyTokenOrigins(app, settings),
  ]);
}

function publicRequest(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    redirect: "error",
    headers: {
      "user-agent": "FounderVillagePagesVerifier/1.0",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
}

async function verifyTokenOrigins(
  app: LoadedApp,
  config: PublicRuntimeConfig,
): Promise<void> {
  if (app.manifest.slug !== "founder-village-app") return;
  if (!hasOidc(config))
    throw new Error("primary app OIDC configuration is incomplete");
  const { clientId, tokenEndpoint } = config;
  const origins = productionOrigins(app.manifest);
  await Promise.all(
    origins.map(async (origin) => {
      const response = await publicRequest(tokenEndpoint, {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: randomBytes(32).toString("base64url"),
          code_verifier: randomBytes(32).toString("base64url"),
          client_id: clientId,
          redirect_uri: `${origin}/auth/callback`,
        }),
      }).catch(() => {
        throw new Error(
          `could not reach the OIDC token endpoint for ${origin}`,
        );
      });
      const allowedOrigin = response.headers.get("access-control-allow-origin");
      const body = await response.json().catch(() => undefined);
      if (
        response.status !== 400 ||
        body?.error !== "invalid_grant" ||
        (allowedOrigin !== origin && allowedOrigin !== "*")
      )
        throw new Error(`OIDC token exchange preflight failed for ${origin}`);
    }),
  );
}

async function verifyRuntime(
  app: LoadedApp,
  apiOrigin: string,
  revision?: string,
): Promise<void> {
  if (revision) {
    const live = await publicRequest(`${apiOrigin}/health/live`);
    if (
      !live.ok ||
      (await live.json().catch(() => undefined))?.revision !== revision
    )
      throw new Error("the public runtime is serving a different revision");
  }
  const ready = await publicRequest(`${apiOrigin}/health/ready`);
  if (
    !ready.ok ||
    (await ready.json().catch(() => undefined))?.status !== "ready"
  )
    throw new Error("the public runtime is not ready");
  const paths =
    app.manifest.slug === "founder-village-app"
      ? ["/members/me", "/food-deliveries/tenants", "/team/tenants"]
      : app.manifest.slug === "founder-village-team"
        ? ["/team/tenants"]
        : [];
  const origins = productionOrigins(app.manifest);
  await Promise.all(
    origins.flatMap((origin) =>
      paths.map(async (path) => {
        const response = await publicRequest(`${apiOrigin}${path}`, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "GET",
            "access-control-request-headers": "authorization,x-application-id",
          },
        });
        const allowedHeaders = (
          response.headers.get("access-control-allow-headers") ?? ""
        )
          .toLowerCase()
          .split(/\s*,\s*/);
        const allowedMethods = (
          response.headers.get("access-control-allow-methods") ?? ""
        ).split(/\s*,\s*/);
        if (
          response.status !== 204 ||
          response.headers.get("access-control-allow-origin") !== origin ||
          !allowedHeaders.includes("authorization") ||
          !allowedHeaders.includes("x-application-id") ||
          !allowedMethods.includes("GET")
        )
          throw new Error(`runtime preflight failed for ${origin} on ${path}`);
      }),
    ),
  );
}

async function verifyOrigin(
  app: LoadedApp,
  origin: string,
  expected?: Release,
  pagesOnly = false,
) {
  const [response, callback, metadata, config] = await Promise.all([
    publicRequest(origin),
    publicRequest(`${origin}/auth/callback`),
    publicRequest(`${origin}/release.json`),
    publicRequest(`${origin}/runtime-config.js`),
  ]).catch(() => {
    throw new Error(`could not reach all Pages paths on ${origin}`);
  });
  for (const [path, result] of [
    ["/", response],
    ["/auth/callback", callback],
    ["/release.json", metadata],
    ["/runtime-config.js", config],
  ] as const) {
    if (!result.ok)
      throw new Error(`${origin}${path} returned HTTP ${result.status}`);
  }
  const [body, callbackBody, runtimeScriptBody, marker] = await Promise.all([
    response.text(),
    callback.text(),
    config.text(),
    metadata.json().catch(() => undefined),
  ]);
  const release = releaseSchema.safeParse(marker).data;
  const csp = response.headers.get("content-security-policy") ?? "";
  const connectDirective = csp
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("connect-src "));
  if (
    !release?.revision ||
    release.app !== app.manifest.slug ||
    release.indexSha256 !== sha256(body) ||
    release.indexSha256 !== sha256(callbackBody) ||
    release.configSha256 !== sha256(runtimeScriptBody) ||
    (expected && JSON.stringify(release) !== JSON.stringify(expected)) ||
    !body.includes(`name="fv-app" content="${app.manifest.slug}"`) ||
    !metadata.headers.get("cache-control")?.includes("no-store") ||
    !config.headers.get("cache-control")?.includes("no-store") ||
    response.headers.get("x-content-type-options") !== "nosniff" ||
    !connectDirective ||
    connectDirective.split(/\s+/).includes("https:")
  )
    throw new Error(`deployed Pages verification failed on ${origin}`);
  const script =
    /^window\.__FOUNDER_VILLAGE_CONFIG__ = Object\.freeze\((.+)\);\n$/.exec(
      runtimeScriptBody,
    )?.[1];
  let settings: PublicRuntimeConfig;
  try {
    settings = parseRuntimeConfig(script && JSON.parse(script));
  } catch {
    throw new Error(`deployed runtime configuration is invalid on ${origin}`);
  }
  if (!pagesOnly && !hasOidc(settings))
    throw new Error(`deployed OIDC configuration is incomplete on ${origin}`);
  const { apiOrigin } = settings;
  if (
    app.manifest.runtimeApiOrigin &&
    apiOrigin !== app.manifest.runtimeApiOrigin
  )
    throw new Error(
      `deployed runtime API origin differs from the app manifest on ${origin}`,
    );
  const connections = new Set(connectDirective.split(/\s+/).slice(1));
  const expectedConnections = new Set([
    "'self'",
    apiOrigin,
    ...(settings.tokenEndpoint ? [new URL(settings.tokenEndpoint).origin] : []),
  ]);
  if (
    connections.size !== expectedConnections.size ||
    [...expectedConnections].some((value) => !connections.has(value))
  )
    throw new Error(
      `deployed Pages policy has unexpected connection origins on ${origin}`,
    );
  const entry = /<script type="module"[^>]* src="(\/assets\/[^"?#]+\.js)"/.exec(
    body,
  )?.[1];
  if (!entry)
    throw new Error(
      `deployed Pages HTML is missing its script entry on ${origin}`,
    );
  const asset = await publicRequest(`${origin}${entry}`);
  if (!asset.ok || !asset.headers.get("content-type")?.includes("javascript"))
    throw new Error(`deployed Pages script entry is unavailable on ${origin}`);
  await asset.body?.cancel();
  console.log(`verified ${origin} at ${release.revision}`);
  return { release, settings };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "login") return login();
  if (!command || !["plan", "provision", "deploy", "verify", "bundle"].includes(command))
    throw new Error(
      "usage: pages.ts login | <plan|provision|deploy|verify|bundle> --app <slug> [--pages-only]",
    );
  const slug = option("--app");
  if (!slug) throw new Error("--app is required");
  const pagesOnly = process.argv.includes("--pages-only");
  if (command === "deploy" || command === "provision") {
    const options = process.argv
      .slice(3)
      .filter((arg) => arg !== "--production" && arg !== "--pages-only");
    if (options.length !== 2 || options[0] !== "--app" || options[1] !== slug)
      throw new Error(
        "Supply Pages mutation credentials through the Founder Wrangler login or protected credential store. Select the target with --app.",
      );
  }
  const app = await loadApp(slug);
  const production = process.argv.includes("--production");
  if (command === "plan")
    await plan(app, production ? productionRuntimeConfig(app) : undefined);
  else if (command === "bundle") await bundle(app, option("--cf-profile"));
  else if (command === "provision") await provision(app, pagesOnly);
  else if (command === "deploy") await deploy(app, pagesOnly);
  else if (pagesOnly) {
    const { release } = await verifyPages(app, true);
    const source = await gitMetadata();
    if (source.dirty || release.dirty || !source.hash || release.revision !== source.hash)
      throw new Error("Live Pages release differs from the clean frontend checkout");
  }
  else await verify(app, production);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
