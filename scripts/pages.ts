import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { parseJsonc } from "./jsonc.ts";
import { loadApp, repositoryRoot, type LoadedApp } from "./manifest.ts";

const execute = promisify(execFile);
const wrangler = resolve(repositoryRoot, "node_modules/.bin/wrangler");

type PublicRuntimeConfig = {
  apiOrigin: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  clientId?: string;
  audience?: string;
};

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
  options: { cwd?: string; capture?: boolean } = {},
): Promise<string> {
  if (options.capture) {
    const result = await execute(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout;
  }
  await new Promise<void>((accept, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
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
  const url = new URL(value);
  if (
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

function productionRuntimeConfig(): PublicRuntimeConfig {
  const apiOrigin = process.env.FV_RUNTIME_API_ORIGIN;
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

function testRuntimeConfig(): PublicRuntimeConfig {
  return { apiOrigin: "https://api.example.test" };
}

async function build(app: LoadedApp): Promise<void> {
  await run("npm", ["run", "build"], { cwd: app.directory });
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
  app: LoadedApp,
  config: PublicRuntimeConfig,
): Promise<void> {
  const output = resolve(app.directory, "dist/runtime-config.js");
  const javascript = `window.__FOUNDER_VILLAGE_CONFIG__ = Object.freeze(${JSON.stringify(config)});\n`;
  await writeFile(output, javascript);
  await writeFile(
    resolve(app.directory, "dist/_headers"),
    deploymentHeaders(config),
  );
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
`;
}

async function inspect(app: LoadedApp, mode: "test" | "production") {
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
  const dist = resolve(app.directory, "dist");
  const files = await outputFiles(dist);
  if (files.length === 0 || files.length > 20_000)
    throw new Error("Pages output file count is invalid");
  const relativeFiles = files.map((file) =>
    relative(dist, file).split(sep).join("/"),
  );
  for (const forbidden of ["_worker.js", "_worker.ts"])
    if (relativeFiles.includes(forbidden))
      throw new Error("Worker entrypoints are forbidden in frontend output");
  if (relativeFiles.some((file) => file.startsWith("functions/")))
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
    configuration: mode,
    files: files.length,
    sha256: digest.digest("hex"),
    createdAt: new Date().toISOString(),
  };
  const state = resolve(repositoryRoot, ".state/pages");
  await mkdir(state, { recursive: true });
  await writeFile(
    resolve(state, `${app.manifest.slug}.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

async function plan(app: LoadedApp, production: boolean) {
  await build(app);
  await writeRuntimeConfig(
    app,
    production ? productionRuntimeConfig() : testRuntimeConfig(),
  );
  const receipt = await inspect(app, production ? "production" : "test");
  console.log(JSON.stringify(receipt, null, 2));
  if (!production)
    console.log("Pages plan used a non-deployable .test runtime origin.");
  return receipt;
}

async function projects(): Promise<Array<{ name?: string }>> {
  const output = await run(wrangler, ["pages", "project", "list", "--json"], {
    capture: true,
  });
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed))
    throw new Error("Wrangler project inventory was invalid");
  return parsed as Array<{ name?: string }>;
}

async function provision(app: LoadedApp): Promise<void> {
  if (
    (await projects()).some(
      (project) => project.name === app.manifest.pagesProject,
    )
  ) {
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
    { cwd: app.directory },
  );
}

async function gitMetadata(): Promise<{ hash?: string; dirty: boolean }> {
  try {
    const hash = (
      await run("git", ["rev-parse", "HEAD"], { capture: true })
    ).trim();
    const dirty = Boolean(
      (await run("git", ["status", "--porcelain"], { capture: true })).trim(),
    );
    return { hash, dirty };
  } catch {
    return { dirty: true };
  }
}

async function deploy(app: LoadedApp): Promise<void> {
  await plan(app, true);
  if (
    !(await projects()).some(
      (project) => project.name === app.manifest.pagesProject,
    )
  )
    throw new Error(
      `Pages project ${app.manifest.pagesProject} does not exist; run the explicit provision command first`,
    );
  const git = await gitMetadata();
  const args = [
    "pages",
    "deploy",
    "dist",
    "--project-name",
    app.manifest.pagesProject,
    "--branch",
    "main",
    `--commit-dirty=${String(git.dirty)}`,
  ];
  if (git.hash) args.push("--commit-hash", git.hash);
  await run(wrangler, args, { cwd: app.directory });
  await verify(app);
}

async function verify(app: LoadedApp): Promise<void> {
  const response = await fetch(app.manifest.productionOrigin, {
    redirect: "error",
    headers: { "user-agent": "FounderVillagePagesVerifier/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  const csp = response.headers.get("content-security-policy") ?? "";
  const connectDirective = csp
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("connect-src "));
  if (
    !response.ok ||
    !body.includes(`name="fv-app" content="${app.manifest.slug}"`) ||
    response.headers.get("x-content-type-options") !== "nosniff" ||
    !connectDirective ||
    connectDirective.split(/\s+/).includes("https:")
  )
    throw new Error("deployed Pages verification failed");
  console.log(`verified ${app.manifest.productionOrigin}`);
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
  if (command === "plan")
    await plan(app, process.argv.includes("--production"));
  else if (command === "provision") await provision(app);
  else if (command === "deploy") await deploy(app);
  else await verify(app);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
