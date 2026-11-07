import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { CHANGED_CHANNEL, type Snapshot } from "./contract";
import plugin, { CHECK_TOOL, READ_TOOL, expandDirectory } from "./server";

const folders: string[] = [];

async function folder(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "atlas-"));
  folders.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup(settings: Record<string, string> = {}) {
  const { bb, harness } = createFakePluginHost({ pluginId: "atlas", settings });
  await plugin(bb);
  const text = (result: unknown) =>
    typeof result === "string" ? result : (result as { content: Array<{ text: string }> }).content.map((part) => part.text).join("");
  const tool = async (name: string, input: Record<string, unknown> = {}) => text(await harness.behavior.callAgentTool(name, input));
  const snapshot = () => harness.behavior.callRpc("snapshot", null) as Promise<Snapshot>;
  return { harness, tool, snapshot };
}

describe("rpc", () => {
  it("starts unconfigured, then creates and opens an example atlas", async () => {
    const { harness, snapshot } = await setup();
    expect(await snapshot()).toMatchObject({ status: "unconfigured", atlas: null });

    const dir = join(await folder(), "atlas");
    const created = (await harness.behavior.callRpc("createExample", { directory: dir })) as Snapshot;
    expect(created).toMatchObject({ status: "ready", directory: dir, problems: [] });
    expect(Object.keys(created.atlas!.diagrams).sort()).toEqual(["bss", "epc", "epc/hss", "index"]);
    expect(await readFile(join(dir, "epc", "hss.yaml"), "utf8")).toContain("title: HSS");
    expect(harness.realtimeSignals.some(({ channel }) => channel === CHANGED_CHANNEL)).toBe(true);
  });

  it("refuses to write the example over existing YAML", async () => {
    const { harness } = await setup();
    const dir = await folder();
    await writeFile(join(dir, "index.yaml"), "title: Mine\nnodes: {}\n");
    await expect(harness.behavior.callRpc("createExample", { directory: dir })).rejects.toThrow(/already has YAML files/);
  });

  it("opens an existing folder and rejects a missing one", async () => {
    const { harness } = await setup();
    const dir = await folder();
    await writeFile(join(dir, "index.yaml"), "title: Mine\nnodes:\n  a: {}\n");
    expect(await harness.behavior.callRpc("useDirectory", { directory: dir })).toMatchObject({ status: "ready", problems: [] });
    await expect(harness.behavior.callRpc("useDirectory", { directory: join(dir, "nope") })).rejects.toThrow(/doesn't exist/);
    await expect(harness.behavior.callRpc("useDirectory", { directory: "relative/path" })).rejects.toThrow(/absolute folder path/);
  });
});

describe("agent tools", () => {
  it("reads the overview, a diagram, and a node", async () => {
    const dir = join(await folder(), "atlas");
    const { harness, tool } = await setup();
    await harness.behavior.callRpc("createExample", { directory: dir });

    const overview = await tool(READ_TOOL);
    expect(overview).toContain(`Atlas folder: ${dir}`);
    expect(overview).toContain("# Mobile Core");
    expect(overview).toContain("- S1-MME · S1-U: RAN (ran) ↔ EPC (epc) [user; rolled up from epc] Includes S1-MME (MME ↔ RAN), S1-U (SGW ↔ RAN).");

    const epc = await tool(READ_TOOL, { diagram: "epc" });
    expect(epc).toContain("# Mobile Core › EPC");
    expect(epc).toContain("- S1-MME: RAN (ran) ↔ MME (mme) [control; TS 23.401 §4.2, TS 36.413; rides Backhaul · IPsec → Direct Connect · 10G]");

    const mme = await tool(READ_TOOL, { diagram: "epc", node: "mme" });
    expect(mme).toContain("Node epc#mme in epc.yaml");
    expect(mme).toContain("- Repo: example/epc-mme");

    expect(await tool(READ_TOOL, { diagram: "ims" })).toBe('No diagram "ims". Diagrams: index, bss, epc, epc/hss.');
  });

  it("checks the files again and reports problems with their lines", async () => {
    const dir = await folder();
    await writeFile(join(dir, "index.yaml"), "title: T\nnodes:\n  a: {}\n");
    const { tool } = await setup({ directory: dir });
    expect(await tool(CHECK_TOOL)).toContain("No problems.");
    await writeFile(join(dir, "index.yaml"), "title: T\nnodes:\n  a: {}\nedges:\n  - S6a: a -- b\n");
    expect(await tool(CHECK_TOOL)).toContain('index.yaml:5\terror\tNo node "b" in this diagram.');
  });
});

describe("cli", () => {
  it("initializes, shows, and checks", async () => {
    const dir = join(await folder(), "atlas");
    const { harness } = await setup();
    const init = await harness.behavior.runCli(["init", dir]);
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain(`Created an example atlas in ${dir}.`);

    const show = await harness.behavior.runCli(["show", "epc/hss", "--node", "vault"]);
    expect(show.stdout).toContain("# Key vault");

    await writeFile(join(dir, "bss.yaml"), "title: BSS\nnodes:\n  a: { runs-on: mars }\n");
    const check = await harness.behavior.runCli(["check"]);
    expect(check.exitCode).toBe(1);
    expect(check.stdout).toContain('bss.yaml:3\terror\tNo place "mars" in infra.yaml.');
  });

  it("explains how to start when nothing is set", async () => {
    const { harness } = await setup();
    const status = await harness.behavior.runCli(["status"]);
    expect(status.stdout).toContain("No atlas folder is set.");
  });
});

describe("watching", () => {
  it("reloads and signals when a file changes", async () => {
    const dir = await folder();
    await writeFile(join(dir, "index.yaml"), "title: First\nnodes:\n  a: {}\n");
    const { harness, snapshot } = await setup({ directory: dir });
    const service = harness.behavior.runService("watch");
    await new Promise((done) => setTimeout(done, 200));
    expect((await snapshot()).atlas?.diagrams.index?.title).toBe("First");

    await writeFile(join(dir, "index.yaml"), "title: Second\nnodes:\n  a: {}\n");
    await expect.poll(async () => (await snapshot()).atlas?.diagrams.index?.title, { timeout: 3000 }).toBe("Second");
    service.controller.abort();
    await service.done;
  });
});

describe("expandDirectory", () => {
  it("expands ~ and rejects relative paths", () => {
    expect(expandDirectory("")).toBe("");
    expect(expandDirectory("~/atlas")).toMatch(/\/atlas$/);
    expect(() => expandDirectory("atlas")).toThrow(/absolute/);
  });
});
