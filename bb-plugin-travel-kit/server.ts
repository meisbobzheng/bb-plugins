import { spawn } from "node:child_process";
import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "./contract.js";
import { JOB_CHANNEL, KIND_LABELS } from "./kit.js";
import { createRunner, findRunner, type Runner } from "./runner.js";
import { ServiceError, createService, type Service } from "./service.js";

export { rpcContract };

function openCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/open", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`open exited ${code}`))));
  });
}

export type PluginOptions = { runner?: Runner; runnerPath?: string; home?: string; open?: (args: string[]) => Promise<void> };

export function createPlugin(options: PluginOptions = {}) {
  return async function plugin(bb: BbPluginApi) {
    const settings = bb.settings.define({
      outputDir: { type: "string", label: "Where to save kits", default: "~/Desktop" },
      days: {
        type: "number",
        label: "Export threads active in the last N days",
        default: 7,
        experimental_schema: z.number().int().min(1).max(90),
      },
      zip: { type: "boolean", label: "Zip the kit", default: true },
    });
    const runnerPath = options.runnerPath ?? findRunner();
    const service = createService({
      runner: options.runner ?? createRunner(runnerPath),
      runnerPath,
      kv: bb.storage.kv,
      settings: () => settings.get(),
      publish: () => bb.realtime.publish(JOB_CHANNEL, {}),
      open: options.open ?? openCommand,
      home: options.home,
    });

    const guard = async <T>(work: () => Promise<T> | T): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof ServiceError) throw new Error(error.message);
        throw error;
      }
    };

    bb.rpc.register(rpcContract, {
      overview: () => service.overview(),
      scan: () => guard(() => service.scan()),
      setIncluded: ({ keys, included }) => service.setIncluded(keys, included),
      setAppClass: ({ name, appClass }) => service.setAppClass(name, appClass),
      generate: () => guard(() => service.generate()),
      handback: ({ dryRun }) => guard(() => service.handback(dryRun)),
      cancel: () => ({ cancelled: service.cancel() }),
      reveal: ({ path }) => guard(async () => (await service.reveal(path), { ok: true })),
      handbackRepos: () => service.handbackRepos(),
    });

    bb.cli.register(cli(service, runnerPath));
  };
}

async function waitForJob(service: Service): Promise<{ exitCode: number; stdout: string }> {
  for (;;) {
    const job = service.currentJob();
    if (job !== null && job.finishedAt !== null) {
      const tail = job.lines.slice(-40);
      if (job.artifact !== null) tail.push(`Kit: ${job.artifact}`);
      return { exitCode: job.exitCode ?? 1, stdout: tail.join("\n") + "\n" };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function cli(service: Service, runnerPath: string) {
  const fail = (error: unknown): never => {
    throw new PluginCliError(error instanceof Error ? error.message : String(error), { code: "travel_kit_failed" });
  };
  return defineCli({
    name: "travel-kit",
    summary: "Build a travel laptop kit, push handbacks, and see what will be exported",
    commands: {
      scan: cliCommand({
        summary: "Scan this Mac and count what a kit would include, by kind",
        options: { json: { type: "boolean", description: "Print every item as JSON" } },
        async run(input) {
          const { items } = await service.scan().catch(fail);
          if (input.options.json === true) return { exitCode: 0, stdout: JSON.stringify(items, null, 2) + "\n" };
          const counts = new Map<string, number>();
          for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
          const lines = [...counts].map(([kind, count]) => `${String(count).padStart(4)}  ${KIND_LABELS[kind] ?? kind}`);
          return { exitCode: 0, stdout: lines.join("\n") + "\n" };
        },
      }),
      generate: cliCommand({
        summary: "Build a kit with the current profile and settings, and print where it was saved",
        async run() {
          await Promise.resolve(service.generate()).catch(fail);
          return waitForJob(service);
        },
      }),
      handback: cliCommand({
        summary: "On the travel laptop: push what changed since the last handback to the private handback repo",
        options: { "dry-run": { type: "boolean", description: "List the changes without pushing" } },
        async run(input) {
          await Promise.resolve(service.handback(input.options["dry-run"] === true)).catch(fail);
          return waitForJob(service);
        },
      }),
      status: cliCommand({
        summary: "Show whether this is the main or travel laptop, the last job, and handback state",
        async run() {
          const overview = await service.overview();
          const lines = [
            `Mode: ${overview.mode} laptop`,
            `Kits are saved to ${overview.outputDir}; threads from the last ${overview.days} days`,
            `Excluded items: ${overview.profile.excluded.length}`,
          ];
          if (overview.handback !== null) {
            lines.push(`Handback repo: ${overview.handback.repo} (${overview.handback.pushed} pushed)`);
          }
          for (const { repo, seq } of overview.applied) lines.push(`Applied from ${repo}: up to handback ${seq}`);
          if (overview.job !== null) {
            lines.push(`Last job: ${overview.job.kind}, ${overview.job.finishedAt === null ? "running" : `exit ${overview.job.exitCode}`}`);
          }
          return { exitCode: 0, stdout: lines.join("\n") + "\n" };
        },
      }),
      "apply-command": cliCommand({
        summary: "Print the Terminal command that applies handbacks on the main laptop (bb quits while it merges)",
        async run() {
          return { exitCode: 0, stdout: `zsh '${runnerPath}' apply\n` };
        },
      }),
    },
  });
}

export default createPlugin();
