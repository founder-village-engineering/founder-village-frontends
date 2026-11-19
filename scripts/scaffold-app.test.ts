// @vitest-environment node
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyScaffold, scaffoldPlan } from "./scaffold-app.ts";

const temporary: string[] = [];

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "fv-scaffold-"));
  temporary.push(root);
  const manifest = resolve(root, "app.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      slug: "sample-orders",
      title: "Sample <Orders>",
      owner: "Founder Village",
      description: "A safe & reusable sample.",
      application: "sample-orders",
      pagesProject: "sample-orders",
      productionOrigin: "https://sample-orders.pages.dev",
      localOrigin: "https://sample-orders.fv",
      localPort: 43911,
      contractSource: "packages/frontend-contracts/sample-orders",
    }),
  );
  return { root, manifest, target: resolve(root, "output") };
}

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("frontend scaffold", () => {
  it("plans and applies identical reruns with context-safe escaping", async () => {
    const { manifest, target } = await fixture();
    const plan = await scaffoldPlan(manifest, target);
    expect(plan.outputs.length).toBeGreaterThan(8);
    await applyScaffold(manifest, target);
    await applyScaffold(manifest, target);
    const html = await readFile(resolve(target, "index.html"), "utf8");
    expect(html).toContain("Sample &lt;Orders&gt;");
    expect(html).toContain("A safe &amp; reusable sample.");
  });

  it("refuses different files and symlink outputs", async () => {
    const { root, manifest, target } = await fixture();
    await applyScaffold(manifest, target);
    await writeFile(resolve(target, "index.html"), "changed");
    await expect(scaffoldPlan(manifest, target)).rejects.toThrow(
      "refusing to overwrite",
    );
    await rm(resolve(target, "index.html"));
    await symlink(resolve(root, "elsewhere"), resolve(target, "index.html"));
    await expect(scaffoldPlan(manifest, target)).rejects.toThrow(
      "not a regular file",
    );
  });
});
