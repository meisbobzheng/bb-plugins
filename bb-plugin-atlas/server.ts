import { mkdir, readdir, watch, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CHANGED_CHANNEL, rpcContract, type Atlas, type Snapshot } from "./contract.js";
import { snapshotOf } from "./model/build.js";
import { bounded, diagramText, nodeText, problemLine, statusText } from "./model/describe.js";
import { EXAMPLE_FILES } from "./model/example.js";

export { rpcContract };

export const READ_TOOL = "atlas_read";
export const CHECK_TOOL = "atlas_check";
const DEBOUNCE_MS = 150;
const RETRY_MS = 2000;

export function expandDirectory(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  if (!isAbsolute(expanded)) throw new Error(`Use an absolute folder path, such as ~/atlas, not "${value}".`);
  return resolve(expanded);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), done()), { once: true });
  });
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((done) => (signal.aborted ? done() : signal.addEventListener("abort", () => done(), { once: true })));
}

async function hasYaml(directory: string): Promise<boolean> {
  const entries = await readdir(directory, { recursive: true }).catch(() => [] as string[]);
  return entries.some((entry) => /\.ya?ml$/i.test(entry));
}

export async function writeExample(directory: string): Promise<void> {
  if (await hasYaml(directory)) throw new Error(`${directory} already has YAML files. Open it with \`bb atlas use ${directory}\` instead.`);
  for (const [file, text] of Object.entries(EXAMPLE_FILES)) {
    const target = join(directory, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, { flag: "wx" });
  }
}

export function diagramIds(atlas: Atlas): string[] {
  return [atlas.root, ...Object.keys(atlas.diagrams).filter((id) => id !== atlas.root).sort()];
}

export function findDiagram(atlas: Atlas, id: string | undefined) {
  const wanted = (id ?? atlas.root).trim().replace(/\.ya?ml$/i, "");
  const diagram = atlas.diagrams[wanted];
  if (diagram === undefined) throw new Error(`No diagram "${wanted}". Diagrams: ${diagramIds(atlas).join(", ")}.`);
  return diagram;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    directory: { type: "string", label: "Atlas folder", default: "" },
  });

  let current: Snapshot = { status: "unconfigured", directory: "", atlas: null, problems: [], loadedAt: null };
  let loaded = false;
  let queue: Promise<Snapshot> = Promise.resolve(current);
  let restart: () => void = () => {};

  async function load(): Promise<Snapshot> {
    const { directory: raw } = await settings.get();
    try {
      return await snapshotOf(expandDirectory(raw));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { status: "ready", directory: raw, atlas: null, problems: [{ severity: "error", file: null, line: null, message }], loadedAt: new Date().toISOString() };
    }
  }

  function refresh(): Promise<Snapshot> {
    queue = queue.then(async () => {
      current = await load();
      loaded = true;
      bb.realtime.publish(CHANGED_CHANNEL, { loadedAt: current.loadedAt });
      return current;
    });
    return queue;
  }

  const snapshot = (): Promise<Snapshot> => (loaded ? Promise.resolve(current) : refresh());

  async function watchUntil(directory: string, signal: AbortSignal): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      for await (const _change of watch(directory, { recursive: true, signal })) {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), DEBOUNCE_MS);
      }
    } catch (cause) {
      if (signal.aborted) return;
      bb.log.warn(`Stopped watching ${directory}: ${cause instanceof Error ? cause.message : String(cause)}`);
      await sleep(RETRY_MS, signal);
    } finally {
      clearTimeout(timer);
    }
  }

  settings.onChange(() => restart());

  bb.background.service("watch", {
    async start(signal) {
      while (!signal.aborted) {
        const round = new AbortController();
        const stop = () => round.abort();
        restart = stop;
        signal.addEventListener("abort", stop, { once: true });
        const next = await refresh();
        if (next.status === "ready" && !round.signal.aborted) await watchUntil(next.directory, round.signal);
        else await aborted(round.signal);
        signal.removeEventListener("abort", stop);
      }
    },
  });

  async function useDirectory(value: string, create: boolean): Promise<Snapshot> {
    const directory = expandDirectory(value);
    if (directory === "") throw new Error("Give a folder path.");
    if (create) await writeExample(directory);
    else if ((await snapshotOf(directory)).status === "missing") throw new Error(`${directory} doesn't exist. Create it, or run \`bb atlas init ${directory}\` for an example atlas.`);
    await settings.experimental_set({ directory });
    return refresh();
  }

  bb.rpc.register(rpcContract, {
    snapshot: () => snapshot(),
    useDirectory: ({ directory }) => useDirectory(directory, false),
    createExample: ({ directory }) => useDirectory(directory, true),
  });

  const readParameters = z.object({
    diagram: z.string().max(200).optional().describe('Diagram id, the file path without .yaml, such as "epc" or "epc/hss". Omit it for the overview and the top-level diagram'),
    node: z.string().max(80).optional().describe('A node id in that diagram, such as "mme", for its full documentation'),
  });

  async function read({ diagram: diagramId, node: nodeId }: z.output<typeof readParameters>): Promise<string> {
    const snap = await snapshot();
    if (snap.atlas === null) return statusText(snap);
    const diagram = findDiagram(snap.atlas, diagramId);
    if (nodeId !== undefined) {
      const node = diagram.nodes.find(({ id }) => id === nodeId.trim());
      if (node === undefined) throw new Error(`No node "${nodeId}" in ${diagram.id}. Nodes: ${diagram.nodes.map(({ id }) => id).join(", ")}.`);
      return bounded(nodeText(snap.atlas, diagram, node));
    }
    const text = diagramText(snap.atlas, diagram, snap.problems);
    return bounded(diagramId === undefined ? `${statusText(snap)}\n\n${text}` : text);
  }

  const failure = (cause: unknown) => ({ content: [{ type: "text" as const, text: cause instanceof Error ? cause.message : String(cause) }], isError: true });

  bb.agents.registerTool({
    name: READ_TOOL,
    description:
      "Read the user's Atlas: diagram documentation of their systems, from the top-level architecture down to each service. Returns a diagram's nodes, connections with their 3GPP interfaces, specs and network paths, and flows, or one node in full.",
    instructions: `The Atlas documents how the user's systems are designed as YAML files in one folder: one diagram per file, where a system node opens the diagram one level down. Call ${READ_TOOL} before answering how a documented system works. To document a system or change the atlas, edit those YAML files with your file tools, following the atlas skill, then call ${CHECK_TOOL} and fix every problem it reports. When telecom_ref_lookup is available, look up each 3GPP interface and network function with it and put the spec it cites in \`spec\`.`,
    presentation: { label: { pending: "Reading the Atlas", completed: "Read the Atlas" } },
    parameters: readParameters,
    execute: (input) => read(input).catch(failure),
  });

  bb.agents.registerTool({
    name: CHECK_TOOL,
    description: "Reload the user's Atlas from its YAML files and list every problem with its file and line, plus the folder and the diagram tree.",
    presentation: { label: { pending: "Checking the Atlas", completed: "Checked the Atlas" } },
    parameters: z.object({}),
    execute: async () => statusText(await refresh()),
  });

  const json = { json: { type: "boolean", description: "Print the result as JSON" } } as const;
  const output = (asJson: boolean, value: unknown, text: string, exitCode = 0) => ({
    exitCode,
    stdout: asJson ? `${JSON.stringify(value)}\n` : `${text}\n`,
  });
  const cliFailure = (cause: unknown, hint: string) =>
    new PluginCliError(cause instanceof Error ? cause.message : String(cause), { code: "invalid_value", hint });

  bb.cli.register(
    defineCli({
      name: "atlas",
      summary: "Diagram documentation you can zoom through: check, read, and set up the Atlas",
      commands: {
        status: cliCommand({
          summary: "Show the atlas folder, the diagram tree, and any problems",
          options: json,
          async run({ options }) {
            const snap = await snapshot();
            return output(options.json, { ...snap, atlas: undefined }, statusText(snap));
          },
        }),
        check: cliCommand({
          summary: "Reload the YAML files and list problems with file and line; exits 1 when there are errors",
          options: json,
          async run({ options }) {
            const snap = await refresh();
            const errors = snap.problems.filter(({ severity }) => severity === "error").length;
            return output(options.json, snap.problems, snap.problems.length === 0 ? statusText(snap) : snap.problems.map(problemLine).join("\n"), errors > 0 ? 1 : 0);
          },
        }),
        show: cliCommand({
          summary: "Print a diagram, or one node with --node, as text",
          aliases: ["read"],
          positionals: [{ name: "diagram", description: "Diagram id, such as epc or epc/hss; the top-level diagram when omitted" }],
          options: { ...json, node: { type: "string", description: "A node id in the diagram" } },
          async run({ positionals, options }) {
            const snap = await snapshot();
            if (snap.atlas === null) throw new PluginCliError(statusText(snap), { code: "not_found", hint: "Run `bb atlas status`." });
            try {
              const diagram = findDiagram(snap.atlas, positionals.diagram);
              const text = await read({ diagram: diagram.id, node: options.node });
              return output(options.json, options.node === undefined ? diagram : diagram.nodes.find(({ id }) => id === options.node), text);
            } catch (cause) {
              throw cliFailure(cause, "Run `bb atlas status` to list diagrams.");
            }
          },
        }),
        init: cliCommand({
          summary: "Create an example atlas in a new or empty folder and open it",
          positionals: [{ name: "folder", description: "Absolute folder path, such as ~/atlas", required: true }],
          options: json,
          async run({ positionals, options }) {
            const snap = await useDirectory(positionals.folder, true).catch((cause: unknown) => {
              throw cliFailure(cause, "Pick a new or empty folder.");
            });
            return output(options.json, { directory: snap.directory }, `Created an example atlas in ${snap.directory}.\n${statusText(snap)}`);
          },
        }),
        use: cliCommand({
          summary: "Open an existing atlas folder",
          aliases: ["open"],
          positionals: [{ name: "folder", description: "Absolute folder path that holds index.yaml", required: true }],
          options: json,
          async run({ positionals, options }) {
            const snap = await useDirectory(positionals.folder, false).catch((cause: unknown) => {
              throw cliFailure(cause, "Give the folder that holds index.yaml.");
            });
            return output(options.json, { directory: snap.directory }, statusText(snap));
          },
        }),
      },
    }),
  );
}
