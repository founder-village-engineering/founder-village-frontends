import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
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
  repositoryRoot,
  type LoadedApp,
} from "./manifest.ts";
import { PagesDomains } from "./pages-domains.ts";

const execute = promisify(execFile);
const wrangler = resolve(repositoryRoot, "node_modules/.bin/wrangler");
const pagesState = resolve(repositoryRoot, ".state/pages");
const releaseOutput = resolve(repositoryRoot, "dist");

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
    ...(options.env ?? process.env),
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

function productionRuntimeConfig(app: LoadedApp): PublicRuntimeConfig {
  const apiOrigin =
    process.env.FV_RUNTIME_API_ORIGIN || app.manifest.runtimeApiOrigin;
  const authorizationEndpoint = process.env.FV_OIDC_AUTHORIZATION_ENDPOINT;
  const tokenEndpoint = process.env.FV_OIDC_TOKEN_ENDPOINT;
  const clientId = process.env.FV_OIDC_CLIENT_ID;
  const audience = process.env.FV_OIDC_AUDIENCE;
  if (!apiOrigin || !authorizationEndpoint || !tokenEndpoint || !clientId)
    throw new Error(
      "FV_RUNTIME_API_ORIGIN, FV_OIDC_AUTHORIZATION_ENDPOINT, FV_OIDC_TOKEN_ENDPOINT, and FV_OIDC_CLIENT_ID are required",
    );
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
  const env = { ...process.env };
  delete env.CLOUDFLARE_ACCOUNT_ID;
  delete env.CLOUDFLARE_API_TOKEN;
  await run("npm", ["run", "build", "--", "--outDir", dist], {
    cwd: app.directory,
    env,
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

async function projects(): Promise<string[]> {
  const output = await run(wrangler, ["pages", "project", "list", "--json"], {
    capture: true,
  });
  return projectNames(JSON.parse(output));
}

async function provision(app: LoadedApp): Promise<void> {
  const domains = pagesDomains(app);
  await domains?.preflight();
  if ((await projects()).includes(app.manifest.pagesProject)) {
    await domains?.verifyProject();
    console.log(`Pages project already exists: ${app.manifest.pagesProject}`);
    return;
  }
  await run(
    wrangler,
    [
      "pages",
      "project",
      "create",
      app.manifest.pagesProject,
      "--production-branch",
      "main",
    ],
    { cwd: app.directory, capture: true },
  );
  await domains?.verifyProject();
  console.log(`Pages project provisioned: ${app.manifest.pagesProject}`);
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

function pagesDomains(app: LoadedApp): PagesDomains | undefined {
  return app.manifest.customOrigins
    ? new PagesDomains(app.manifest)
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

async function deploy(app: LoadedApp): Promise<void> {
  const config = productionRuntimeConfig(app);
  const revision = runtimeRevision(app, true);
  const source = await gitMetadata();
  if (!source.hash || source.dirty)
    throw new Error("production Pages deploy requires a clean Git worktree");
  const domains = pagesDomains(app);
  await domains?.preflight();
  if (!(await projects()).includes(app.manifest.pagesProject))
    throw new Error(
      `Pages project ${app.manifest.pagesProject} does not exist; run the explicit provision command first`,
    );
  await domains?.verifyProject();
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
    release = await plan(app, config, dist);
    if (release.revision !== source.hash || release.dirty)
      throw new Error(
        "frontend source changed while building the production artifact",
      );
    await run("npm", ["run", "security:scan", "--", "--artifact", dist]);
    await run(
      wrangler,
      [
        "pages",
        "deploy",
        dist,
        "--project-name",
        app.manifest.pagesProject,
        "--branch",
        "main",
        "--commit-dirty=false",
        "--commit-hash",
        source.hash,
      ],
      { cwd: app.directory, capture: true },
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await waitFor("the production Pages upload", () =>
    verifyOrigin(app, app.manifest.productionOrigin, release),
  );
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

async function verify(app: LoadedApp, production: boolean): Promise<void> {
  const revision = runtimeRevision(app, production);
  const expectedConfig = production ? productionRuntimeConfig(app) : undefined;
  const source = production ? await gitMetadata() : undefined;
  if (source && (!source.hash || source.dirty))
    throw new Error(
      "production Pages verification requires a clean Git worktree",
    );
  const { release, settings } = await verifyOrigin(
    app,
    app.manifest.productionOrigin,
  );
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
  const origins = [
    app.manifest.productionOrigin,
    ...customOrigins(app.manifest),
  ];
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
  const origins = [
    app.manifest.productionOrigin,
    ...customOrigins(app.manifest),
  ];
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
) {
  const [response, callback, metadata, config] = await Promise.all([
    publicRequest(origin),
    publicRequest(`${origin}/auth/callback`),
    publicRequest(`${origin}/release.json`),
    publicRequest(`${origin}/runtime-config.js`),
  ]).catch(() => {
    throw new Error(`could not reach all Pages paths on ${origin}`);
  });
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
    !response.ok ||
    !callback.ok ||
    !metadata.ok ||
    !config.ok ||
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
  if (!hasOidc(settings))
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
    new URL(settings.tokenEndpoint).origin,
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
  if (!command || !["plan", "provision", "deploy", "verify"].includes(command))
    throw new Error(
      "usage: pages.ts <plan|provision|deploy|verify> --app <slug>",
    );
  const slug = option("--app");
  if (!slug) throw new Error("--app is required");
  const app = await loadApp(slug);
  const production = process.argv.includes("--production");
  if (command === "plan")
    await plan(app, production ? productionRuntimeConfig(app) : undefined);
  else if (command === "provision") await provision(app);
  else if (command === "deploy") await deploy(app);
  else await verify(app, production);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
