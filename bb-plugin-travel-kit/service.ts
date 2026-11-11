import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { Job, Overview } from "./contract.js";
import { EMPTY_PROFILE, JOB_LINES, itemKey, parseEnv, parseScan, profileTsv, type AppClass, type Profile, type ScanItem } from "./kit.js";
import type { Runner } from "./runner.js";

export type Kv = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

export type Settings = { outputDir: string; days: number; zip: boolean };

export type ServiceDeps = {
  runner: Runner;
  runnerPath: string;
  kv: Kv;
  settings: () => Promise<Settings>;
  publish: () => void;
  open: (args: string[]) => Promise<void>;
  home?: string;
};

type StoredScan = { items: ScanItem[]; scannedAt: string };

export class ServiceError extends Error {}

export function expandHome(target: string, home = homedir()): string {
  return target === "~" ? home : target.startsWith("~/") ? path.join(home, target.slice(2)) : target;
}

export function createService(deps: ServiceDeps) {
  const home = deps.home ?? homedir();
  const kitRoot = path.join(home, ".travel-kit");
  let job: Job | null = null;
  let controller: AbortController | null = null;
  let starting = false;

  const claim = () => {
    if (starting || (job !== null && job.finishedAt === null)) throw new ServiceError(`A ${job?.kind ?? "job"} is already running.`);
  };

  const profile = async (): Promise<Profile> => ({ ...EMPTY_PROFILE, ...((await deps.kv.get<Profile>("profile")) ?? {}) });
  const saveProfile = async (next: Profile) => {
    await deps.kv.set("profile", next);
    return next;
  };

  const readEnv = async (file: string) => parseEnv(await readFile(file, "utf8").catch(() => ""));

  async function handback(): Promise<Overview["handback"]> {
    const env = await readEnv(path.join(kitRoot, "handback.env"));
    if (env.HANDBACK_REPO === undefined) return null;
    return { repo: env.HANDBACK_REPO, pushed: Number(env.HANDBACK_SEQ ?? 0), sinceMs: Number(env.HANDBACK_SINCE_MS ?? 0) };
  }

  async function applied(): Promise<Overview["applied"]> {
    const dir = path.join(kitRoot, "applied");
    const files = await readdir(dir).catch(() => [] as string[]);
    return Promise.all(
      files
        .filter((file) => file.endsWith(".env"))
        .map(async (file) => ({ repo: file.slice(0, -4), seq: Number((await readEnv(path.join(dir, file))).APPLIED_SEQ ?? 0) })),
    );
  }

  async function scan(): Promise<StoredScan> {
    const { days } = await deps.settings();
    const result = await deps.runner(["scan", "--days", String(days)], { timeoutMs: 5 * 60_000 });
    if (result.exitCode !== 0) throw new ServiceError(`Scan failed: ${lastLine(result.stderr || result.stdout)}`);
    const stored = { items: parseScan(result.stdout), scannedAt: new Date().toISOString() };
    await deps.kv.set("scan", stored);
    return stored;
  }

  function startJob(kind: Job["kind"], args: string[], cleanup?: () => Promise<void>): Job {
    claim();
    controller = new AbortController();
    const current: Job = {
      id: randomBytes(4).toString("hex"),
      kind,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      lines: [],
      artifact: null,
    };
    job = current;
    deps.publish();
    const finish = (exitCode: number, message?: string) => {
      if (message !== undefined) current.lines.push(message);
      current.exitCode = exitCode;
      current.finishedAt = new Date().toISOString();
      void deps.kv.set("lastJob", current);
      deps.publish();
    };
    deps
      .runner(args, {
        signal: controller.signal,
        onLine(line) {
          const artifact = /^::kit (.+)$/.exec(line);
          if (artifact !== null) current.artifact = artifact[1]!;
          else current.lines.push(line);
          if (current.lines.length > JOB_LINES) current.lines.splice(0, current.lines.length - JOB_LINES);
          deps.publish();
        },
      })
      .then(
        ({ exitCode }) => finish(exitCode),
        (error: unknown) => finish(1, error instanceof Error && error.name === "AbortError" ? "Cancelled." : String(error)),
      )
      .finally(() => void cleanup?.());
    return current;
  }

  return {
    async overview(): Promise<Overview> {
      const settings = await deps.settings();
      const hb = await handback();
      return {
        mode: hb === null ? "main" : "travel",
        runner: deps.runnerPath,
        outputDir: expandHome(settings.outputDir, home),
        days: settings.days,
        profile: await profile(),
        scan: (await deps.kv.get<StoredScan>("scan")) ?? null,
        job: job ?? (await deps.kv.get<Job>("lastJob")) ?? null,
        handback: hb,
        applied: await applied(),
      };
    },
    scan,
    async setIncluded(keys: string[], included: boolean) {
      const current = await profile();
      const excluded = new Set(current.excluded);
      for (const key of keys) {
        if (included) excluded.delete(key);
        else excluded.add(key);
      }
      return saveProfile({ ...current, excluded: [...excluded].sort() });
    },
    async setAppClass(name: string, appClass: AppClass) {
      const current = await profile();
      const classes = { ...current.classes };
      const key = itemKey("app", name);
      if (appClass === "iru") delete classes[key];
      else classes[key] = appClass;
      return saveProfile({ ...current, classes });
    },
    async generate() {
      claim();
      starting = true;
      try {
        const settings = await deps.settings();
        const dir = await mkdtemp(path.join(tmpdir(), "travel-kit-profile-"));
        const file = path.join(dir, "profile.tsv");
        await writeFile(file, profileTsv(await profile()));
        const args = ["generate", "--out", expandHome(settings.outputDir, home), "--profile", file, "--days", String(settings.days)];
        if (settings.zip) args.push("--zip");
        starting = false;
        return startJob("generate", args, () => rm(dir, { recursive: true, force: true }));
      } finally {
        starting = false;
      }
    },
    handback(dryRun: boolean) {
      return startJob("handback", dryRun ? ["handback", "--dry-run"] : ["handback"]);
    },
    cancel() {
      if (job === null || job.finishedAt !== null || controller === null) return false;
      controller.abort();
      return true;
    },
    async reveal(target: string) {
      const resolved = path.resolve(expandHome(target, home));
      const allowed = [expandHome((await deps.settings()).outputDir, home), kitRoot];
      if (!allowed.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
        throw new ServiceError("Travel Kit only reveals kits and handbacks it made.");
      }
      await deps.open(["-R", resolved]);
    },
    async handbackRepos() {
      const result = await deps.runner(["repos"], { timeoutMs: 60_000 });
      if (result.exitCode !== 0) return { repos: [], error: lastLine(result.stderr || result.stdout) || "gh failed" };
      return { repos: result.stdout.split("\n").filter((line) => line.includes("/")), error: null };
    },
    currentJob: () => job,
  };
}

export type Service = ReturnType<typeof createService>;

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1) ?? "";
}
