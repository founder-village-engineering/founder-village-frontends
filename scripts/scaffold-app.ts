import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  appManifestSchema,
  repositoryRoot,
  type AppManifest,
} from "./manifest.ts";

type Output = { path: string; content: string };

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateManifest(manifest: AppManifest): void {
  const production = new URL(manifest.productionOrigin);
  const local = new URL(manifest.localOrigin);
  if (
    production.origin !== manifest.productionOrigin ||
    production.protocol !== "https:" ||
    production.hostname !== `${manifest.pagesProject}.pages.dev` ||
    production.pathname !== "/" ||
    production.search ||
    production.hash
  )
    throw new Error("production origin must be the exact Pages project origin");
  if (
    local.origin !== manifest.localOrigin ||
    local.protocol !== "https:" ||
    !/^[a-z][a-z0-9-]*\.fv$/.test(local.hostname) ||
    local.pathname !== "/" ||
    local.search ||
    local.hash
  )
    throw new Error("local origin must be one-label .fv HTTPS");
  if (
    manifest.contractSource !== `packages/frontend-contracts/${manifest.slug}`
  )
    throw new Error("contract source must match app slug");
}

async function templateFiles(root: string, current = root): Promise<string[]> {
  const stat = await lstat(current);
  if (stat.isSymbolicLink())
    throw new Error(`template symlink refused: ${current}`);
  if (stat.isFile()) return [current];
  const entries = await readdir(current);
  return (
    await Promise.all(
      entries
        .sort()
        .map((entry) => templateFiles(root, resolve(current, entry))),
    )
  ).flat();
}

function render(source: string, manifest: AppManifest): string {
  const replacements: Record<string, string> = {
    __SLUG__: manifest.slug,
    __PAGES_PROJECT__: manifest.pagesProject,
    __LOCAL_PORT__: String(manifest.localPort),
    __LOCAL_HOST_JSON__: JSON.stringify(new URL(manifest.localOrigin).hostname),
    __TITLE_JSON__: JSON.stringify(manifest.title),
    __DESCRIPTION_JSON__: JSON.stringify(manifest.description),
    __TITLE_HTML__: html(manifest.title),
    __DESCRIPTION_HTML__: html(manifest.description),
    __MANIFEST_JSON__: JSON.stringify(manifest, null, 2),
  };
  let output = source;
  for (const [token, value] of Object.entries(replacements))
    output = output.replaceAll(token, value);
  const leftovers = (output.match(/__[A-Z0-9_]+__/g) ?? []).filter(
    (token) => token !== "__FOUNDER_VILLAGE_CONFIG__",
  );
  if (leftovers.length)
    throw new Error(`unresolved template token: ${leftovers[0]}`);
  return output.endsWith("\n") ? output : `${output}\n`;
}

export async function scaffoldPlan(
  manifestPath: string,
  targetOverride?: string,
): Promise<{ target: string; outputs: Output[] }> {
  const manifest = appManifestSchema.parse(
    JSON.parse(await readFile(resolve(manifestPath), "utf8")),
  );
  validateManifest(manifest);
  const target = resolve(
    targetOverride ?? resolve(repositoryRoot, "apps", manifest.slug),
  );
  if (!targetOverride && !inside(resolve(repositoryRoot, "apps"), target))
    throw new Error("scaffold target escaped apps root");
  const templates = resolve(repositoryRoot, "templates/app");
  const files = await templateFiles(templates);
  const outputs: Output[] = [];
  for (const file of files) {
    const relativePath = relative(templates, file);
    if (!relativePath.endsWith(".template"))
      throw new Error(
        `template filename must end in .template: ${relativePath}`,
      );
    const outputPath = resolve(
      target,
      relativePath.slice(0, -".template".length),
    );
    if (!inside(target, outputPath))
      throw new Error("scaffold output escaped target");
    outputs.push({
      path: outputPath,
      content: render(await readFile(file, "utf8"), manifest),
    });
  }
  for (const output of outputs) {
    try {
      const stat = await lstat(output.path);
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error(
          `scaffold output is not a regular file: ${output.path}`,
        );
      if ((await readFile(output.path, "utf8")) !== output.content)
        throw new Error(`refusing to overwrite different file: ${output.path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { target, outputs };
}

export async function applyScaffold(
  manifestPath: string,
  targetOverride?: string,
): Promise<string[]> {
  const plan = await scaffoldPlan(manifestPath, targetOverride);
  for (const output of plan.outputs) {
    await mkdir(dirname(output.path), { recursive: true });
    await writeFile(output.path, output.content);
  }
  return plan.outputs.map((output) => output.path);
}

async function main(): Promise<void> {
  const manifestPath = option("--manifest");
  if (!manifestPath) throw new Error("--manifest is required");
  const modes = ["--plan", "--apply"].filter((mode) =>
    process.argv.includes(mode),
  );
  if (modes.length !== 1)
    throw new Error("choose exactly one of --plan or --apply");
  const target = option("--target");
  if (modes[0] === "--plan") {
    const plan = await scaffoldPlan(manifestPath, target);
    console.log(
      JSON.stringify(
        {
          target: plan.target,
          files: plan.outputs.map((output) =>
            relative(plan.target, output.path),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }
  const outputs = await applyScaffold(manifestPath, target);
  console.log(`scaffolded ${outputs.length} file(s)`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
