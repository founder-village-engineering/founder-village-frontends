import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const featureFrontendsSchema = z
  .array(z.string().regex(/^[a-z][a-z0-9-]{0,62}$/))
  .min(1)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "duplicate feature frontend",
  );

const legacyCustomOriginSchema = z
  .string()
  .regex(/^https:\/\/[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.foundervillage\.xyz$/);

const customOriginsSchema = z
  .array(
    z.union([
      legacyCustomOriginSchema,
      z.enum(["https://founderhaus.org", "https://foundervillage.org"]),
    ]),
  )
  .min(1)
  .refine(
    (origins) => new Set(origins).size === origins.length,
    "duplicate custom origin",
  );

const pagesProjectSchema = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);

export const appManifestSchema = z
  .object({
    version: z.literal(1),
    slug: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
    title: z.string().min(1).max(100),
    owner: z.string().min(1).max(100),
    description: z.string().min(1).max(240),
    application: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    pagesProject: pagesProjectSchema,
    productionOrigin: z.string().url(),
    additionalPagesProjects: z.array(pagesProjectSchema).min(1).optional(),
    runtimeApiOrigin: z.string().url().optional(),
    customOrigin: legacyCustomOriginSchema.optional(),
    customOrigins: customOriginsSchema.optional(),
    localOrigin: z.string().url(),
    localPort: z.number().int().min(1024).max(65535),
    contractSource: z
      .string()
      .regex(/^packages\/frontend-contracts\/[a-z][a-z0-9-]{0,62}$/),
    featureFrontends: featureFrontendsSchema.optional(),
  })
  .strict()
  .refine(
    (manifest) => !manifest.customOrigin || !manifest.customOrigins,
    "use only one of customOrigin and customOrigins",
  )
  .refine(({ pagesProject, additionalPagesProjects = [] }) => {
    const projects = [pagesProject, ...additionalPagesProjects];
    return new Set(projects).size === projects.length;
  }, "duplicate Pages project");

export type AppManifest = z.infer<typeof appManifestSchema>;
export type PagesTarget = Pick<
  AppManifest,
  "pagesProject" | "productionOrigin"
>;

export function pagesTargets(manifest: AppManifest): PagesTarget[] {
  return [
    {
      pagesProject: manifest.pagesProject,
      productionOrigin: manifest.productionOrigin,
    },
    ...(manifest.additionalPagesProjects ?? []).map((pagesProject) => ({
      pagesProject,
      productionOrigin: `https://${pagesProject}.pages.dev`,
    })),
  ];
}

export function productionOrigins(manifest: AppManifest): string[] {
  return [
    ...pagesTargets(manifest).map(({ productionOrigin }) => productionOrigin),
    ...customOrigins(manifest),
  ];
}

export function customOrigins(manifest: AppManifest): string[] {
  return (
    manifest.customOrigins ??
    (manifest.customOrigin ? [manifest.customOrigin] : [])
  );
}

export type LoadedApp = {
  directory: string;
  manifestPath: string;
  manifest: AppManifest;
  packageName: string;
};

function exactOrigin(value: string, label: string): URL {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(`${label} must be an exact origin`);
  return url;
}

export async function loadApp(slug: string): Promise<LoadedApp> {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(slug)) throw new Error("invalid app slug");
  const directory = resolve(repositoryRoot, "apps", slug);
  const manifestPath = resolve(directory, "founder-village-app.json");
  const manifest = appManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (manifest.slug !== slug) throw new Error("app slug and directory differ");
  if (manifest.contractSource !== `packages/frontend-contracts/${slug}`)
    throw new Error("contract source must match app slug");
  const production = exactOrigin(
    manifest.productionOrigin,
    "production origin",
  );
  if (
    production.protocol !== "https:" ||
    production.hostname !== `${manifest.pagesProject}.pages.dev` ||
    production.port
  )
    throw new Error("production origin must be the app's exact Pages origin");
  const local = exactOrigin(manifest.localOrigin, "local origin");
  if (
    local.protocol !== "https:" ||
    !/^[a-z][a-z0-9-]*\.fv$/.test(local.hostname) ||
    local.port
  )
    throw new Error("local origin must be one-label .fv HTTPS");
  const packageJson = JSON.parse(
    await readFile(resolve(directory, "package.json"), "utf8"),
  ) as { name?: unknown };
  if (typeof packageJson.name !== "string" || !packageJson.name)
    throw new Error("app package name is missing");
  return { directory, manifestPath, manifest, packageName: packageJson.name };
}
