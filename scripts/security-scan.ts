import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

class ScanError extends Error {}

type Finding = { rule: string; path: string; line?: number; commit?: string };
type GitleaksFinding = {
  RuleID: string;
  File: string;
  StartLine: number;
  Commit: string;
};
type Scan = { files?: number; findings: Finding[] };

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const maxBuffer = 128 * 1024 * 1024;
const commitId = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const findingsExitCode = 42;

function git(args: string[], operation: string): Buffer {
  // Preserve GIT_INDEX_FILE, which Git sets for some commit modes.
  const result = spawnSync("git", ["--no-replace-objects", ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0)
    throw new ScanError(`Git could not ${operation}.`);
  return result.stdout;
}

function gitPaths(args: string[]): Set<string> {
  const raw = git(args, "list paths for the secret scan");
  return new Set(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(raw)
      .split("\0")
      .filter(Boolean),
  );
}

function privatePath(file: string): boolean {
  const name = basename(file).toLowerCase();
  return (
    /(?:^|\/)(?:\.git|\.state|secrets)(?:\/|$)/i.test(file) ||
    /(?:\.private\.json|\.tfstate[^/]*|\.(?:key|p8|p12|pfx|jks|keystore|kdbx|mobileprovision|provisionprofile))$/.test(
      name,
    ) ||
    /^(?:\.git-credentials|\.netrc|id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(
      name,
    ) ||
    (/^\.(?:env|dev\.vars)(?:\..*)?$/.test(name) &&
      name !== ".env.example" &&
      name !== ".dev.vars.example")
  );
}

function displayPath(file: string): string {
  // Findings report only locations. Redact common credential shapes in filenames too.
  return file
    .replace(
      /(?:gh[pousr]_|github_pat_|cfut_|sk_(?:live|test)_|whsec_)[A-Za-z0-9_-]{8,}/gi,
      "[redacted]",
    )
    .replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, "[redacted]")
    .replace(/[A-Za-z0-9_+=-]{32,}/g, "[redacted]");
}

function withSnapshot<T>(scan: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "fv-secret-scan-"));
  try {
    return scan(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function scanWithGitleaks(
  args: string[],
  cwd: string,
  {
    input,
    commitMessages = false,
  }: { input?: Buffer; commitMessages?: boolean } = {},
): Finding[] {
  if (lstatSync(join(cwd, ".gitleaksignore"), { throwIfNoEntry: false })) {
    throw new ScanError(
      "Use reviewed exceptions in .gitleaks.toml for the secret scan.",
    );
  }
  const result = spawnSync(
    "gitleaks",
    [
      ...args,
      "--config",
      join(root, ".gitleaks.toml"),
      "--redact=100",
      "--ignore-gitleaks-allow",
      "--max-archive-depth=2",
      "--no-banner",
      "--log-level=error",
      "--report-format=json",
      "--report-path=-",
      `--exit-code=${findingsExitCode}`,
    ],
    {
      cwd,
      input,
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
      maxBuffer,
      timeout: 120_000,
    },
  );
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new ScanError(
      "Install Gitleaks 8.30.1 or later and make it available on PATH.",
    );
  }
  if (
    result.error ||
    (result.status !== 0 && result.status !== findingsExitCode) ||
    (result.status === 0 && result.stderr.length > 0)
  ) {
    throw new ScanError(
      "Gitleaks could not complete the scan. Check its version and the repository configuration.",
    );
  }
  if (result.status === 0) return [];

  // Raw reports can contain entire lines, author details, or commit messages.
  const report = JSON.parse(result.stdout.toString()) as GitleaksFinding[];
  if (!Array.isArray(report) || !report.length)
    throw new ScanError("Gitleaks reported findings without usable locations.");
  return report.map(({ RuleID, File, StartLine, Commit }) => {
    const commit = commitMessages ? basename(File) : Commit;
    return {
      rule: /^[a-z0-9-]{1,80}$/.test(RuleID) ? RuleID : "unrecognized-rule",
      path: commitMessages ? "commit message" : displayPath(File),
      line: StartLine > 0 ? StartLine : undefined,
      commit: commitId.test(commit) ? commit : undefined,
    };
  });
}

function workspaceStat(file: string) {
  try {
    return lstatSync(file, { throwIfNoEntry: false });
  } catch (error) {
    // An unstaged file can replace a directory that still exists in the index.
    if ((error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
  }
}

function scanFiles(staged: boolean): Scan {
  const paths = staged
    ? gitPaths([
        "diff",
        "--cached",
        "--no-renames",
        "--name-only",
        "--diff-filter=ACMT",
        "-z",
      ])
    : gitPaths([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ]);
  return withSnapshot((snapshot) => {
    const findings: Finding[] = [];
    let files = 0;
    for (const file of paths) {
      if (privatePath(file)) {
        findings.push({ rule: "private-file", path: displayPath(file) });
        continue;
      }
      const source = join(root, file);
      const target = join(snapshot, file);
      if (staged) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(
          target,
          git(["cat-file", "blob", `:${file}`], "read a staged blob"),
          { mode: 0o600 },
        );
      } else {
        const stat = workspaceStat(source);
        if (!stat) continue;
        if (realpathSync(dirname(source)) !== dirname(source))
          throw new ScanError(
            "A Git-visible file is inside a symlinked directory.",
          );
        mkdirSync(dirname(target), { recursive: true });
        if (stat.isSymbolicLink())
          writeFileSync(target, readlinkSync(source, { encoding: "buffer" }), {
            mode: 0o600,
          });
        else if (stat.isFile()) copyFileSync(source, target);
        else
          throw new ScanError(
            "A Git-visible path is not a regular file or symlink.",
          );
      }
      files++;
    }
    findings.push(...scanWithGitleaks(["dir", "."], snapshot));
    return { files, findings };
  });
}

function scanHistory(): Scan {
  if (
    git(["rev-parse", "--is-shallow-repository"], "inspect history")
      .toString()
      .trim() !== "false"
  ) {
    throw new ScanError(
      "Fetch the full Git history before running the history scan.",
    );
  }
  const history = [
    "--all",
    "--full-history",
    "-m",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
  ];
  const paths = gitPaths([
    "log",
    ...history,
    "--format=",
    "--name-only",
    "--diff-filter=ACMT",
    "-z",
  ]);
  const findings = [...paths]
    .filter(privatePath)
    .map((file) => ({ rule: "private-file", path: displayPath(file) }));
  findings.push(
    ...scanWithGitleaks(
      [
        "git",
        `--log-opts=${history.join(" ")} --no-notes --no-show-signature`,
        ".",
      ],
      root,
    ),
  );

  const messages = git(
    [
      "log",
      "--all",
      "--format=%H%x00%B",
      "-z",
      "--no-notes",
      "--no-show-signature",
    ],
    "read commit messages",
  )
    .toString()
    .split("\0");
  const messageFindings = withSnapshot((snapshot) => {
    for (let index = 0; index < messages.length - 1; index += 2) {
      const commit = messages[index];
      if (!commit || !commitId.test(commit))
        throw new ScanError("Git returned unreadable commit metadata.");
      writeFileSync(join(snapshot, commit), messages[index + 1] ?? "", {
        mode: 0o600,
      });
    }
    return scanWithGitleaks(["dir", "."], snapshot, { commitMessages: true });
  });
  return { findings: [...findings, ...messageFindings] };
}

function scanArtifact(directory: string): Scan {
  const artifact = resolve(root, directory);
  const location = relative(root, artifact);
  if (
    !location ||
    location === ".." ||
    location.startsWith("../") ||
    isAbsolute(location) ||
    privatePath(location)
  ) {
    throw new ScanError("Choose an artifact directory inside the repository.");
  }
  if (
    realpathSync(artifact) !== artifact ||
    !lstatSync(artifact).isDirectory()
  ) {
    throw new ScanError("The artifact path must be a real directory.");
  }
  let files = 0;
  const findings: Finding[] = [];
  const inspect = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const file = relative(root, path);
      if (privatePath(file))
        findings.push({ rule: "private-file", path: displayPath(file) });
      else if (entry.isDirectory()) inspect(path);
      else if (entry.isFile()) files++;
      else
        throw new ScanError(
          "An artifact entry is not a regular file or directory.",
        );
    }
  };
  inspect(artifact);
  if (findings.length) return { files, findings };
  if (!files) throw new ScanError("The artifact directory is empty.");
  return {
    files,
    findings: scanWithGitleaks(["dir", "."], artifact).map((finding) => ({
      ...finding,
      path: `${displayPath(location)}/${finding.path}`,
    })),
  };
}

try {
  const [flag, target, ...extra] = process.argv.slice(2);
  let scope = "worktree";
  let scan: Scan;
  if (flag === undefined) scan = scanFiles(false);
  else if (flag === "--staged" && target === undefined) {
    scope = "staged";
    scan = scanFiles(true);
  } else if (flag === "--history" && target === undefined) {
    scope = "history";
    scan = scanHistory();
  } else if (flag === "--artifact" && target && !extra.length) {
    scope = "artifact";
    scan = scanArtifact(target);
  } else if (flag === "--message" && target && !extra.length) {
    scope = "commit-message";
    scan = {
      findings: scanWithGitleaks(["stdin"], root, {
        input: readFileSync(target),
        commitMessages: true,
      }),
    };
  } else
    throw new ScanError(
      "Usage: npm run security:scan -- [--staged | --history | --artifact <directory>]",
    );

  if (scan.findings.length) {
    console.error(
      JSON.stringify(
        { event: "secret_scan.failed", scope, findings: scan.findings },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } else
    console.log(
      JSON.stringify({ event: "secret_scan.passed", scope, files: scan.files }),
    );
} catch (error) {
  console.error(
    error instanceof ScanError
      ? error.message
      : "Secret scan could not complete safely.",
  );
  process.exitCode = 1;
}
