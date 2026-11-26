import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
const productionRef = "refs/heads/main";
const revisionPattern = /^(?!0{40})[0-9a-f]{40}$/;
const pollInterval = 2_000;
const pushTimeout = 90_000;
const lockTimeout = 15 * 60_000;
const gitEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
};

async function git(...args: string[]): Promise<string> {
  try {
    const result = await execute("git", args, {
      cwd: root,
      env: gitEnvironment,
      timeout: 15_000,
    });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`git ${args[0]} failed`, { cause: error });
  }
}

async function commonDirectory(): Promise<string> {
  for (const variable of (await git("rev-parse", "--local-env-vars")).split(
    "\n",
  ))
    delete gitEnvironment[variable];
  return git("rev-parse", "--path-format=absolute", "--git-common-dir");
}

async function queue(remote: string | undefined): Promise<void> {
  if (remote !== "origin") return;
  const revision = readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(
      ([, sha, target]) =>
        target === productionRef && revisionPattern.test(sha ?? ""),
    )?.[1];
  if (!revision) return;

  const logPath = join(
    await commonDirectory(),
    "founder-village-pages-autodeploy.log",
  );
  const log = await open(logPath, "a", 0o600);
  try {
    const watcher = spawn(process.execPath, [script, "watch", revision], {
      cwd: root,
      env: gitEnvironment,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    await once(watcher, "spawn");
    watcher.unref();
  } finally {
    await log.close();
  }
  console.error(
    `pre-push: queued Founder Village Pages release for ${revision.slice(0, 12)} after origin/main confirms the push. Log at ${logPath}`,
  );
}

async function remoteRevision(): Promise<string | undefined> {
  const result = await git("ls-remote", "--refs", "origin", productionRef);
  return result.split("\t")[0];
}

async function waitForPush(revision: string): Promise<boolean> {
  const deadline = Date.now() + pushTimeout;
  do {
    if ((await remoteRevision().catch(() => undefined)) === revision)
      return true;
    await pause(pollInterval);
  } while (Date.now() < deadline);
  return false;
}

async function acquire(lock: string): Promise<void> {
  const deadline = Date.now() + lockTimeout;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(`Pages release lock timed out. Inspect ${lock}`);
      await pause(pollInterval);
    }
  }
}

const installEnvironment: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  LANG: process.env.LANG,
  CI: "true",
};

function deploymentEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...installEnvironment };
  for (const key of [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "FV_PAGES_API_TOKEN",
    "FV_RUNTIME_API_ORIGIN",
    "FV_OIDC_AUTHORIZATION_ENDPOINT",
    "FV_OIDC_TOKEN_ENDPOINT",
    "FV_OIDC_CLIENT_ID",
    "FV_OIDC_AUDIENCE",
  ])
    environment[key] = process.env[key];
  for (const key of ["CREDENTIALS_DIRECTORY", "FV_PAGES_API_TOKEN_FILE"])
    if (process.env[key]) environment[key] = resolve(root, process.env[key]);
  environment.FV_PAGES_CLOUDFLARE_BINDING = resolve(
    root,
    process.env.FV_PAGES_CLOUDFLARE_BINDING ??
      "../founder-village-runtime/.state/operator/founder-cloudflare.private.json",
  );
  return environment;
}

async function npm(
  cwd: string,
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Promise<void> {
  const child = spawn("npm", args, {
    cwd,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const [status] = await once(child, "close");
  if (status !== 0) throw new Error(`npm ${args[0]} failed`);
}

async function publish(revision: string): Promise<boolean> {
  const temporary = await mkdtemp(join(tmpdir(), "fv-pages-release-"));
  const worktree = join(temporary, "frontends");
  try {
    await git("worktree", "add", "--detach", worktree, revision);
    try {
      await npm(worktree, installEnvironment, "ci", "--no-audit", "--no-fund");
      if ((await remoteRevision()) !== revision) {
        console.log("origin/main advanced during dependency installation");
        return false;
      }
      await npm(
        worktree,
        deploymentEnvironment(),
        "run",
        "pages",
        "--",
        "deploy",
        "--app",
        "founder-village-app",
        "--pages-only",
      );
      return true;
    } finally {
      await git("worktree", "remove", "--force", worktree);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function watch(revision: string): Promise<void> {
  if (!revisionPattern.test(revision))
    throw new Error("Expected a full Git revision");
  const state = join(
    await commonDirectory(),
    "founder-village-pages-autodeploy",
  );
  console.log(
    `${new Date().toISOString()} waiting for origin/main at ${revision}`,
  );
  if (!(await waitForPush(revision))) {
    console.log("origin/main did not confirm the push within 90 seconds");
    return;
  }
  await mkdir(state, { recursive: true, mode: 0o700 });
  const lock = join(state, "lock");
  const receipt = join(state, "deployed-revision");
  await acquire(lock);
  try {
    if ((await remoteRevision()) !== revision) {
      console.log(
        "origin/main advanced while waiting for the Pages release lock",
      );
      return;
    }
    if ((await readFile(receipt, "utf8").catch(() => "")).trim() === revision) {
      console.log(`Pages already verified ${revision}`);
      return;
    }
    if (await publish(revision)) {
      await writeFile(receipt, `${revision}\n`, { mode: 0o600 });
      console.log(`Pages verified ${revision}`);
    }
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

const [operation, value] = process.argv.slice(2);
try {
  if (operation === "hook") await queue(value);
  else if (operation === "watch") await watch(value ?? "");
  else
    throw new Error("Usage: pages-autodeploy.ts <hook origin|watch revision>");
} catch (error) {
  console.error(
    `Pages release failed. ${error instanceof Error ? error.message : "Unexpected error"}`,
  );
  process.exitCode = 1;
}
