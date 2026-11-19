import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { loadApp, repositoryRoot } from "./manifest.ts";

type Marker = {
  version: number;
  frontend: string;
  application: string;
  source: string;
  sha256: string;
  files: string[];
};

async function contractFiles(root: string, current = root): Promise<string[]> {
  const stat = await lstat(current);
  if (stat.isSymbolicLink())
    throw new Error(`generated contract symlink refused: ${current}`);
  if (stat.isFile()) return [current];
  if (!stat.isDirectory())
    throw new Error(`unsupported generated contract entry: ${current}`);
  const entries = await readdir(current);
  const nested = await Promise.all(
    entries.sort().map((entry) => contractFiles(root, resolve(current, entry))),
  );
  return nested.flat();
}

export async function checkContractSnapshots(): Promise<number> {
  const appEntries = (
    await readdir(resolve(repositoryRoot, "apps"), {
      withFileTypes: true,
    })
  ).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
  for (const entry of appEntries) {
    const app = await loadApp(entry.name);
    const root = resolve(app.directory, "src/generated/contracts");
    const marker = JSON.parse(
      await readFile(resolve(root, "contract-source.json"), "utf8"),
    ) as Marker;
    if (
      marker.version !== 1 ||
      marker.frontend !== app.manifest.slug ||
      marker.application !== app.manifest.application ||
      marker.source !== app.manifest.contractSource ||
      !/^[a-f0-9]{64}$/.test(marker.sha256)
    )
      throw new Error(`invalid generated contract marker for ${entry.name}`);
    const paths = (await contractFiles(root))
      .map((path) => relative(root, path).split(sep).join("/"))
      .filter((path) => path !== "contract-source.json")
      .sort();
    if (JSON.stringify(paths) !== JSON.stringify([...marker.files].sort()))
      throw new Error(`generated contract inventory differs for ${entry.name}`);
    const digest = createHash("sha256");
    for (const path of paths) {
      digest.update(path);
      digest.update("\0");
      digest.update(await readFile(resolve(root, path)));
      digest.update("\0");
    }
    if (digest.digest("hex") !== marker.sha256)
      throw new Error(`generated contracts were edited for ${entry.name}`);
  }
  return appEntries.length;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const count = await checkContractSnapshots();
  console.log(`verified ${count} generated contract snapshot(s)`);
}
