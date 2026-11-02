import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createChime, EVENT_LABELS, EVENTS, SOUNDS, usesOnePasswordAgent, type ChimeEvent, type System } from "./chime";

const sound = (label: string, description: string, fallback: string) => ({ type: "select" as const, label, description, options: SOUNDS, default: fallback });

const isEvent = (value: string): value is ChimeEvent => (EVENTS as readonly string[]).includes(value);

export function createPlugin(system: System) {
  return async function plugin(bb: BbPluginApi) {
    const settings = bb.settings.define({
      inputSound: sound("Needs input sound", "Plays when a thread asks for your approval or an answer.", "Glass"),
      sshSound: sound("1Password SSH sound", "Plays when a thread runs a command through 1Password's SSH agent, which asks you to approve.", "Hero"),
      finishedSound: sound("Thread finished sound", "Plays when a thread finishes its turn.", "None"),
      failedSound: sound("Thread failed sound", "Plays when a thread stops with an error.", "None"),
      volume: { type: "number", label: "Volume (%)", default: 60, experimental_schema: z.number().int().min(0).max(100) },
    });

    const current = async () => {
      const values = await settings.get();
      return { sounds: { input: values.inputSound, ssh: values.sshSound, finished: values.finishedSound, failed: values.failedSound }, volumePercent: values.volume };
    };

    const chime = createChime({ ...system, settings: current, now: Date.now, log: (message) => bb.log.warn(message) });
    const running = new Set<string>();
    const seen = new Map<string, number>();
    const startedAt = Date.now();

    bb.events.on("interaction.pending", ({ thread }) => {
      if (thread.visibility === "visible") void chime.notify("input");
    });
    bb.events.on("experimental_thread.events", async ({ thread, sequence }) => {
      const after = seen.get(thread.id);
      seen.set(thread.id, sequence);
      if ((await current()).sounds.ssh === "None") return;
      const started = await bb.sdk.threads.events.list({ threadId: thread.id, types: ["item/started"], order: "desc", limit: "20", ...(after === undefined ? {} : { afterSeq: String(after) }) });
      const prompts = started.some(
        (event) => event.seq <= sequence && event.createdAt >= startedAt && event.type === "item/started" && event.data.item.type === "commandExecution" && usesOnePasswordAgent(event.data.item.command),
      );
      if (prompts) void chime.notify("ssh");
    });
    bb.events.on("thread.active", ({ thread }) => void running.add(thread.id));
    bb.events.on("thread.idle", ({ thread }) => {
      if (running.delete(thread.id) && thread.visibility === "visible") void chime.notify("finished");
    });
    bb.events.on("thread.failed", ({ thread }) => {
      running.delete(thread.id);
      if (thread.visibility === "visible") void chime.notify("failed");
    });
    const forget = ({ thread }: { thread: { id: string } }) => {
      running.delete(thread.id);
      seen.delete(thread.id);
    };
    bb.events.on("thread.archived", forget);
    bb.events.on("thread.deleted", forget);

    bb.cli.register(
      defineCli({
        name: "chime",
        summary: "Preview Chime's sounds and print its settings",
        commands: {
          test: cliCommand({
            summary: "Play the sound for an event on the bb server's machine",
            positionals: [{ name: "event", description: `${EVENTS.join(", ")} (default input)` }],
            async run({ positionals }) {
              const event = positionals.event ?? "input";
              if (!isEvent(event)) throw new PluginCliError(`No event named ${event}.`, { code: "invalid_value", hint: `Use one of ${EVENTS.join(", ")}.` });
              const played = await chime.play(event);
              return { exitCode: 0, stdout: played === null ? `${EVENT_LABELS[event]} is silent.\n` : `Played ${played}.\n` };
            },
          }),
          status: cliCommand({
            summary: "Print the sound for each event and the volume",
            async run() {
              const { sounds, volumePercent } = await current();
              const rows = [...EVENTS.map((event) => [EVENT_LABELS[event], sounds[event]] as const), ["Volume", `${volumePercent}%`] as const];
              return { exitCode: 0, stdout: rows.map(([label, value]) => `${label.padEnd(16)}${value}\n`).join("") };
            },
          }),
        },
      }),
    );
  };
}

const run = promisify(execFile);

export default createPlugin({ platform: process.platform, run: async (command, args) => void (await run(command, args)), exists: existsSync });
