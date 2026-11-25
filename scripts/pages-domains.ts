import { z } from "zod";
import { customOrigins, type AppManifest } from "./manifest.ts";

const zoneSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  name: z.string(),
  status: z.string(),
  account: z.object({ id: z.string() }),
});
const recordSchema = z.object({
  name: z.string(),
  type: z.string(),
  content: z.string(),
  proxied: z.boolean().optional(),
});
const projectSchema = z.object({
  name: z.string(),
  subdomain: z.string(),
  production_branch: z.string(),
  source: z.unknown().nullish(),
});
const domainSchema = z.object({ name: z.string(), status: z.string() });
const envelopeSchema = z.object({
  success: z.boolean(),
  result: z.unknown(),
  result_info: z.object({ total_pages: z.number().optional() }).optional(),
});

type DnsRecord = z.infer<typeof recordSchema>;
type Alias = { hostname: string; zoneId: string };
const webRecordTypes = new Set(["A", "AAAA", "CNAME", "HTTPS", "SVCB"]);

export function aliasHasExpectedRecord(
  records: DnsRecord[],
  hostname: string,
  target: string,
): boolean {
  const webRecords = records.filter((record) =>
    webRecordTypes.has(record.type),
  );
  if (!webRecords.length) return false;
  const [record] = webRecords;
  if (
    webRecords.length === 1 &&
    record?.name === hostname &&
    record.type === "CNAME" &&
    record.content.replace(/\.$/, "").toLowerCase() === target &&
    record.proxied === true
  )
    return true;
  throw new Error(
    `existing web DNS records conflict with the Pages alias ${hostname}`,
  );
}

export class PagesDomains {
  private readonly accountId: string;
  private readonly token: string;
  private readonly projectPath: string;
  private readonly target: string;
  private readonly hostnames: string[];

  constructor(readonly manifest: AppManifest) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !/^[0-9a-f]{32}$/.test(accountId) || !token)
      throw new Error(
        "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for Pages custom domains",
      );
    this.accountId = accountId;
    this.token = token;
    this.projectPath = `/accounts/${accountId}/pages/projects/${manifest.pagesProject}`;
    this.target = new URL(manifest.productionOrigin).hostname;
    this.hostnames = customOrigins(manifest).map(
      (origin) => new URL(origin).hostname,
    );
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    operation: string,
    body?: object,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error(`Cloudflare could not ${operation}`);
    }
    if (!response.ok)
      throw new Error(
        `Cloudflare could not ${operation} (HTTP ${response.status})`,
      );
    const result = envelopeSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (!result.success || !result.data.success)
      throw new Error(
        `Cloudflare returned an unsuccessful response while attempting to ${operation}`,
      );
    if ((result.data.result_info?.total_pages ?? 1) > 1)
      throw new Error(
        `Cloudflare returned an incomplete inventory while attempting to ${operation}`,
      );
    const parsed = schema.safeParse(result.data.result);
    if (!parsed.success)
      throw new Error(
        `Cloudflare returned an invalid response while attempting to ${operation}`,
      );
    return parsed.data;
  }

  async verifyProject(): Promise<void> {
    const project = await this.request(
      this.projectPath,
      projectSchema,
      "read the Pages project",
    );
    if (
      project.name !== this.manifest.pagesProject ||
      project.subdomain !== this.target ||
      project.production_branch !== "main" ||
      project.source != null
    )
      throw new Error(
        "Cloudflare project does not match the exact Direct Upload production project",
      );
  }

  private async alias(hostname: string): Promise<Alias> {
    const zoneName = hostname.endsWith(".foundervillage.xyz")
      ? "foundervillage.xyz"
      : hostname;
    const query = new URLSearchParams({
      name: zoneName,
      "account.id": this.accountId,
      status: "active",
    });
    const zones = await this.request(
      `/zones?${query}`,
      z.array(zoneSchema),
      `read the zone for ${hostname}`,
    );
    const [zone] = zones;
    if (
      zones.length !== 1 ||
      zone?.name !== zoneName ||
      zone.status !== "active" ||
      zone.account.id !== this.accountId
    )
      throw new Error(
        `the active zone for ${hostname} must belong to the Pages account`,
      );
    return { hostname, zoneId: zone.id };
  }

  private async hasRecord({ hostname, zoneId }: Alias): Promise<boolean> {
    const query = new URLSearchParams({
      "name.exact": hostname,
      per_page: "100",
    });
    const records = await this.request(
      `/zones/${zoneId}/dns_records?${query}`,
      z.array(recordSchema),
      `read DNS for ${hostname}`,
    );
    return aliasHasExpectedRecord(records, hostname, this.target);
  }

  private async aliases(): Promise<Alias[]> {
    const aliases = await Promise.all(
      this.hostnames.map((host) => this.alias(host)),
    );
    await Promise.all(aliases.map((alias) => this.hasRecord(alias)));
    return aliases;
  }

  async preflight(): Promise<void> {
    await this.aliases();
  }

  private async domains() {
    return this.request(
      `${this.projectPath}/domains?per_page=100`,
      z.array(domainSchema),
      "read Pages custom domains",
    );
  }

  async attach(): Promise<void> {
    const [aliases, domains] = await Promise.all([
      this.aliases(),
      this.domains(),
    ]);
    for (const alias of aliases) {
      const { hostname, zoneId } = alias;
      await this.hasRecord(alias);
      if (!domains.some((domain) => domain.name === hostname)) {
        const created = await this.request(
          `${this.projectPath}/domains`,
          domainSchema,
          `attach the Pages domain ${hostname}`,
          { name: hostname },
        );
        if (created.name !== hostname)
          throw new Error(
            `Cloudflare returned a different Pages domain for ${hostname}`,
          );
      }
      if (!(await this.hasRecord(alias))) {
        await this.request(
          `/zones/${zoneId}/dns_records`,
          recordSchema,
          `create the Pages CNAME for ${hostname}`,
          {
            type: "CNAME",
            name: hostname,
            content: this.target,
            proxied: true,
            ttl: 1,
          },
        );
      }
      if (!(await this.hasRecord(alias)))
        throw new Error(
          `the Pages CNAME for ${hostname} was not found after reconciliation`,
        );
    }
  }

  async active(): Promise<boolean> {
    const domains = await this.domains();
    return this.hostnames.every((host) =>
      domains.some(
        (domain) => domain.name === host && domain.status === "active",
      ),
    );
  }
}
