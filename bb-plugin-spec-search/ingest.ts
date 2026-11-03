import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { parseDocx, type SpecDocument } from "./docx.js";
import type { Ftp } from "./ftp.js";
import { DEFAULT_RELEASE, releaseOf, versionFromCode } from "./specs.js";
import type { Job, JobKind, Store } from "./store.js";
import { unzip } from "./zip.js";

const FILE_BYTES = 80_000_000;
const ARCHIVE_LIMITS = { entries: 200, entryBytes: 100_000_000, totalBytes: 200_000_000 };
const CONVERT_TIMEOUT = 120_000;
const FILE_NAME = /^(\d{2})(\d{3})(-\d{1,2})?-([0-9a-z]{3})\b/i;

const run = promisify(execFile);

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function convertDoc(data: Buffer, signal?: AbortSignal): Promise<Buffer> {
  if (process.platform !== "darwin") throw new Error("Word 97 .doc files need macOS textutil to convert; pass the .docx instead.");
  const dir = await mkdtemp(join(tmpdir(), "spec-search-"));
  try {
    const input = join(dir, "spec.doc");
    const output = join(dir, "spec.docx");
    await writeFile(input, data);
    await run("/usr/bin/textutil", ["-convert", "docx", "-output", output, input], { timeout: CONVERT_TIMEOUT, signal });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readWord(name: string, data: Buffer, signal?: AbortSignal): Promise<SpecDocument> {
  return parseDocx(extname(name).toLowerCase() === ".doc" ? await convertDoc(data, signal) : data, signal);
}

async function readArchive(zip: Buffer, signal?: AbortSignal): Promise<SpecDocument> {
  const parts = unzip(zip, (name) => /\.docx?$/i.test(name) && !name.startsWith("__MACOSX/"), ARCHIVE_LIMITS);
  if (parts.length === 0) throw new Error("The archive has no Word document in it.");
  const documents: SpecDocument[] = [];
  for (const part of parts) documents.push(await readWord(part.name, part.data, signal));
  const [first] = documents;
  return { ...first!, clauses: documents.flatMap((document) => document.clauses) };
}

function identityFromName(name: string): { spec: string; version: string } | null {
  const match = FILE_NAME.exec(basename(name));
  return match === null ? null : { spec: `${match[1]}.${match[2]}${match[3] ?? ""}`, version: versionFromCode(match[4]!.toLowerCase()) };
}

export interface IngestOptions {
  store: Store;
  ftp: Ftp;
  log: BbPluginApi["log"];
}

export function createIngest({ store, ftp, log }: IngestOptions) {
  let wake: (() => void) | null = null;
  const waiters = new Map<number, Array<(job: Job) => void>>();

  async function fetchSpec(spec: string, release: number, signal: AbortSignal): Promise<string> {
    const archive = await ftp.latest(spec, release, signal);
    if (archive === null) throw new Error(`${spec} has no Rel-${release} version on the 3GPP FTP.`);
    const current = store.getSpec(spec);
    if (current?.source === "3gpp" && current.version === archive.version) return `${current.kind} ${spec} V${current.version} is already indexed.`;
    const zip = await ftp.download(archive, signal);
    const document = await readArchive(zip, signal);
    const saved = await store.replace(
      {
        spec,
        kind: document.kind ?? "TS",
        title: document.title ?? "",
        version: archive.version,
        release,
        source: "3gpp",
        origin: archive.url,
        sha256: sha256(zip),
      },
      document.clauses,
      signal,
    );
    return `Indexed ${saved.kind} ${spec} V${saved.version}: ${saved.clauses} clauses.`;
  }

  async function indexFile(path: string, signal: AbortSignal): Promise<string> {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${path} is not a file.`);
    if (info.size > FILE_BYTES) throw new Error(`${path} is over the ${FILE_BYTES / 1_000_000} MB limit.`);
    const data = await readFile(path);
    const digest = sha256(data);
    if (store.hasFile(digest)) return `${basename(path)} is already indexed.`;
    const extension = extname(path).toLowerCase();
    if (![".zip", ".docx", ".doc"].includes(extension)) throw new Error(`${basename(path)} is not a .zip, .docx or .doc file.`);
    const document = extension === ".zip" ? await readArchive(data, signal) : await readWord(path, data, signal);
    const named = identityFromName(path);
    const spec = document.spec ?? named?.spec;
    const version = document.version ?? named?.version;
    if (spec === undefined || version === undefined) {
      throw new Error(`Could not tell which spec ${basename(path)} is: its cover page has no "3GPP TS xx.xxx Vx.y.z" line.`);
    }
    if (document.clauses.length === 0) throw new Error(`${basename(path)} has no numbered clause headings.`);
    const saved = await store.replace(
      { spec, kind: document.kind ?? "TS", title: document.title ?? "", version, release: releaseOf(version), source: "file", origin: path, sha256: digest },
      document.clauses,
      signal,
    );
    return `Indexed ${saved.kind} ${spec} V${saved.version} from ${basename(path)}: ${saved.clauses} clauses.`;
  }

  function settle(job: Job): void {
    for (const resolve of waiters.get(job.id) ?? []) resolve(job);
    waiters.delete(job.id);
  }

  return {
    enqueue(kind: JobKind, target: string, release: number | null = null): Job {
      const job = store.enqueue(kind, target, kind === "fetch" ? (release ?? DEFAULT_RELEASE) : null);
      wake?.();
      return job;
    },
    wait(id: number, signal?: AbortSignal): Promise<Job> {
      const job = store.job(id);
      if (job === null) return Promise.reject(new Error(`No job ${id}.`));
      if (job.status === "done" || job.status === "failed") return Promise.resolve(job);
      return new Promise((resolve, reject) => {
        waiters.set(id, [...(waiters.get(id) ?? []), resolve]);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    async run(signal: AbortSignal): Promise<void> {
      store.requeueRunning();
      await store.dropStale(signal);
      while (!signal.aborted) {
        const job = store.claimJob();
        if (job === null) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          wake = null;
          continue;
        }
        let status: "done" | "failed" = "done";
        let note: string;
        try {
          note = job.kind === "fetch" ? await fetchSpec(job.target, job.release ?? DEFAULT_RELEASE, signal) : await indexFile(job.target, signal);
        } catch (error) {
          if (signal.aborted) return;
          status = "failed";
          note = message(error);
          log.warn(`spec-search: ${job.kind} ${job.target} failed: ${note}`);
        }
        store.finishJob(job.id, status, note);
        settle(store.job(job.id)!);
      }
    },
  };
}

export type Ingest = ReturnType<typeof createIngest>;
