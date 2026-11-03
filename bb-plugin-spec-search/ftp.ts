import { compactSpec, compareVersions, seriesOf, versionFromCode } from "./specs.js";

const ORIGIN = "https://www.3gpp.org";
const LISTING_BYTES = 4_000_000;
const ARCHIVE_BYTES = 80_000_000;
const REDIRECTS = 3;
const LISTING_TTL = 10 * 60_000;
const TIMEOUT = 120_000;
const USER_AGENT = "bb-plugin-spec-search";

export interface Archive {
  spec: string;
  release: number;
  name: string;
  url: string;
  version: string;
}

type Fetch = typeof globalThis.fetch;

function allowed(url: URL): boolean {
  return url.protocol === "https:" && url.host === new URL(ORIGIN).host;
}

export function folderUrl(release: number, series: string): string {
  return `${ORIGIN}/ftp/Specs/latest/Rel-${release}/${series}_series/`;
}

function archivesIn(listing: string, spec: string): Array<{ name: string; version: string }> {
  const compact = compactSpec(spec).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new Set(listing.match(new RegExp(String.raw`\b${compact}-[0-9a-z]{3}\.zip\b`, "g")) ?? []);
  return [...names]
    .map((name) => ({ name, version: versionFromCode(name.slice(-7, -4)) }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

export function createFtp(fetcher: Fetch = globalThis.fetch, now: () => number = Date.now) {
  const listings = new Map<string, { at: number; text: string }>();

  async function get(href: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
    let url = new URL(href);
    const timeout = AbortSignal.timeout(TIMEOUT);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    for (let hop = 0; hop <= REDIRECTS; hop++) {
      if (!allowed(url)) throw new Error(`Refusing to download from ${url.origin}; only ${ORIGIN} is allowed.`);
      const response = await fetcher(url, { redirect: "manual", signal: combined, headers: { "user-agent": USER_AGENT } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (location === null) throw new Error(`${url.href} redirected without a location.`);
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`${url.href} returned HTTP ${response.status}.`);
      }
      if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
        await response.body?.cancel();
        throw new Error(`${url.href} is larger than ${maxBytes} bytes.`);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error(`${url.href} is larger than ${maxBytes} bytes.`);
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    throw new Error(`${href} redirected more than ${REDIRECTS} times.`);
  }

  async function listing(release: number, series: string, signal?: AbortSignal): Promise<string> {
    const url = folderUrl(release, series);
    const cached = listings.get(url);
    if (cached !== undefined && now() - cached.at < LISTING_TTL) return cached.text;
    const text = (await get(url, LISTING_BYTES, signal)).toString("utf8");
    listings.set(url, { at: now(), text });
    return text;
  }

  return {
    async latest(spec: string, release: number, signal?: AbortSignal): Promise<Archive | null> {
      const series = seriesOf(spec);
      const newest = archivesIn(await listing(release, series, signal), spec)[0];
      if (newest === undefined) return null;
      return { spec, release, name: newest.name, url: `${folderUrl(release, series)}${newest.name}`, version: newest.version };
    },
    download(archive: Archive, signal?: AbortSignal): Promise<Buffer> {
      return get(archive.url, ARCHIVE_BYTES, signal);
    },
  };
}

export type Ftp = ReturnType<typeof createFtp>;
