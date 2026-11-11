import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Job } from "./contract";
import type { RunOptions, RunResult, Runner } from "./runner";
import { createService, type Kv } from "./service";

function memoryKv(): Kv {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async (key, value) => void values.set(key, structuredClone(value)),
  };
}

type Call = { args: string[]; profile: string | null };

function fakeRunner(script: (args: string[], options: RunOptions) => Promise<RunResult> | RunResult) {
  const calls: Call[] = [];
  const runner: Runner = async (args, options = {}) => {
    const at = args.indexOf("--profile");
    calls.push({ args, profile: at === -1 ? null : await readFile(args[at + 1]!, "utf8") });
    return script(args, options);
  };
  return { runner, calls };
}

async function setup(script: Parameters<typeof fakeRunner>[0] = () => ({ exitCode: 0, stdout: "", stderr: "" })) {
  const home = await mkdtemp(path.join(tmpdir(), "travel-kit-home-"));
  const { runner, calls } = fakeRunner(script);
  const opened: string[][] = [];
  let published = 0;
  const service = createService({
    runner,
    runnerPath: "/plugin/runner/travel-kit",
    kv: memoryKv(),
    settings: async () => ({ outputDir: "~/Kits", days: 5, zip: true }),
    publish: () => void published++,
    open: async (args) => void opened.push(args),
    home,
  });
  return { service, calls, home, opened, published: () => published };
}

async function settled(service: ReturnType<typeof createService>): Promise<Job> {
  for (let i = 0; i < 100; i++) {
    const job = service.currentJob();
    if (job?.finishedAt) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job never finished");
}

describe("scan and profile", () => {
  it("scans with the configured day window and keeps the result", async () => {
    const { service, calls } = await setup(() => ({ exitCode: 0, stdout: "formula\tjq\t1.7\t\napp\tSlack\t4\tiru\n", stderr: "" }));
    const scan = await service.scan();
    expect(calls[0]?.args).toEqual(["scan", "--days", "5"]);
    expect(scan.items.map((item) => item.key)).toEqual(["formula:jq", "app:Slack"]);
    expect((await service.overview()).scan?.items).toHaveLength(2);
  });

  it("reports the runner's last error line when a scan fails", async () => {
    const { service } = await setup(() => ({ exitCode: 1, stdout: "", stderr: "noise\nbrew: command broke\n" }));
    await expect(service.scan()).rejects.toThrow("Scan failed: brew: command broke");
  });

  it("excludes and re-includes items, and stores only non-default app classes", async () => {
    const { service } = await setup();
    await service.setIncluded(["repo:big", "formula:jq"], false);
    expect((await service.setIncluded(["formula:jq"], true)).excluded).toEqual(["repo:big"]);
    expect((await service.setAppClass("Slack", "manual")).classes).toEqual({ "app:Slack": "manual" });
    expect((await service.setAppClass("Slack", "iru")).classes).toEqual({});
  });
});

describe("jobs", () => {
  it("generates with the saved profile, streams lines, and picks out the kit path", async () => {
    const { service, calls, home } = await setup((_args, { onLine }) => {
      onLine?.("› Scanning this Mac");
      onLine?.("::kit /Users/me/Kits/travel-kit-1.zip");
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    await service.setIncluded(["repo:big"], false);
    const first = service.generate();
    await expect(service.generate()).rejects.toThrow("already running");
    await first;
    const job = await settled(service);
    expect(calls[0]?.args).toEqual(["generate", "--out", path.join(home, "Kits"), "--profile", expect.any(String), "--days", "5", "--zip"]);
    expect(calls[0]?.profile).toBe("exclude\trepo\tbig\t\n");
    expect(job).toMatchObject({ kind: "generate", exitCode: 0, lines: ["› Scanning this Mac"], artifact: "/Users/me/Kits/travel-kit-1.zip" });
  });

  it("keeps the last job across restarts of the page", async () => {
    const { service } = await setup(() => ({ exitCode: 2, stdout: "", stderr: "" }));
    service.handback(true);
    await settled(service);
    expect((await service.overview()).job).toMatchObject({ kind: "handback", exitCode: 2 });
  });
});

describe("modes and paths", () => {
  it("is the travel laptop once install has written the handback repo", async () => {
    const { service, home } = await setup();
    expect((await service.overview()).mode).toBe("main");
    await mkdir(path.join(home, ".travel-kit", "applied"), { recursive: true });
    await writeFile(path.join(home, ".travel-kit", "handback.env"), "HANDBACK_REPO=me/travel-kit-tk\nHANDBACK_SEQ=2\nHANDBACK_SINCE_MS=1000\n");
    await writeFile(path.join(home, ".travel-kit", "applied", "travel-kit-old.env"), "APPLIED_SEQ=4\n");
    const overview = await service.overview();
    expect(overview.mode).toBe("travel");
    expect(overview.handback).toEqual({ repo: "me/travel-kit-tk", pushed: 2, sinceMs: 1000 });
    expect(overview.applied).toEqual([{ repo: "travel-kit-old", seq: 4 }]);
  });

  it("only reveals paths inside the kit folder or ~/.travel-kit", async () => {
    const { service, home, opened } = await setup();
    await service.reveal("~/Kits/travel-kit-1.zip");
    expect(opened).toEqual([["-R", path.join(home, "Kits", "travel-kit-1.zip")]]);
    await expect(service.reveal("/etc/passwd")).rejects.toThrow("only reveals");
    await expect(service.reveal("~/Kits/../.ssh")).rejects.toThrow("only reveals");
  });
});
