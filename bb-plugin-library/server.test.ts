import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { CatalogTag, Entry, SearchResult } from "./contract";
import { CHANGED_CHANNEL } from "./library";
import plugin, { GET_TOOL, SAVE_TOOL, SEARCH_TOOL, UPDATE_TOOL } from "./server";

const FLOW = [
  "```mermaid",
  "sequenceDiagram",
  "  MME->>HSS: ULR",
  "  HSS-->>MME: ULA",
  "```",
  "The MME registers the UE on S6a during EPS attach.",
].join("\n");
const FLOW_TAGS = "Interfaces: S6a; Procedures: Attach; Messages: ULR/ULA; Network functions: MME, HSS";

async function setup() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "library",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          if (threadId !== "thr_1") throw new Error("not found");
          return makeThreadResponse({ id: threadId, title: "Debug S6a attach" });
        },
      },
    },
  });
  await plugin(bb);
  const text = (result: unknown) =>
    typeof result === "string" ? result : (result as { content: Array<{ text: string }> }).content.map((part) => part.text).join("");
  const idOf = (reply: string) => /lib_[a-z0-9]{8}/.exec(reply)![0];
  return { harness, text, idOf };
}

describe("agent tools", () => {
  it("saves with grouped and detected tags, a guessed kind, and the source thread", async () => {
    const { harness, text, idOf } = await setup();
    const reply = text(
      await harness.behavior.callAgentTool(
        SAVE_TOOL,
        { title: "S6a attach", body: FLOW, tags: { topics: ["Outbox"], status: ["not implemented"] } },
        { threadId: "thr_1" },
      ),
    );
    const id = idOf(reply);
    expect(reply).toBe(`Saved ${id} "S6a attach" to the Library (Flow).\nTags: ${FLOW_TAGS}; Topics: Outbox; Status: Not Implemented.`);

    const entry = (await harness.behavior.callRpc("entry", { id })) as Entry;
    expect(entry).toMatchObject({ kind: "flow", source: { threadId: "thr_1", threadTitle: "Debug S6a attach" } });
    expect(entry.tags).toContainEqual({ tag: "Outbox", group: "topics" });
    expect(harness.inspection.realtimeSignals.map((signal) => signal.channel)).toEqual([CHANGED_CHANNEL]);
  });

  it("accepts a plain tag list and reports tags nobody grouped", async () => {
    const { harness, text } = await setup();
    const reply = text(await harness.behavior.callAgentTool(SAVE_TOOL, { title: "Note", body: "text", kind: "note", tags: ["Mystery", "hss"] }));
    expect(reply).toContain("Tags: Network functions: HSS; Other: Mystery.");
    expect(reply).toContain("Ungrouped: Mystery. Pass tags under their group, or run `bb library regroup <tag> <group>`.");
  });

  it("keeps existing and built-in groups and says so", async () => {
    const { harness, text } = await setup();
    await harness.behavior.callAgentTool(SAVE_TOOL, { title: "A", body: "text", tags: { topics: ["Outbox"] } });
    const reply = text(await harness.behavior.callAgentTool(SAVE_TOOL, { title: "B", body: "text", tags: { components: ["outbox"], topics: ["S6a"] } }));
    expect(reply).toContain("Tags: Interfaces: S6a; Topics: Outbox.");
    expect(reply).toContain("Kept groups: Outbox (Topics, its existing group), S6a (Interfaces, built in).");
  });

  it("keeps a source thread it cannot look up, without a title", async () => {
    const { harness } = await setup();
    await harness.behavior.callAgentTool(SAVE_TOOL, { title: "Note", body: "text", kind: "note" }, { threadId: "thr_gone" });
    const result = (await harness.behavior.callRpc("search", { query: "", kind: null, tags: [], threadId: null, limit: 5 })) as SearchResult;
    expect(result.entries[0]).toMatchObject({ kind: "note", source: { threadId: "thr_gone", threadTitle: null } });
  });

  it("searches and reads entries", async () => {
    const { harness, text, idOf } = await setup();
    await harness.behavior.callAgentTool(SAVE_TOOL, { title: "S6a attach", body: FLOW }, { threadId: "thr_1" });

    const found = text(await harness.behavior.callAgentTool(SEARCH_TOOL, { query: "registers", tags: ["s6a"] }));
    expect(found).toContain("1 match (id, kind, title, tags, updated):");
    expect(found).toContain("\tS6a, Attach, ULR/ULA, MME, HSS\t");
    expect(found).toContain("**registers**");

    const document = text(await harness.behavior.callAgentTool(GET_TOOL, { id: idOf(found) }));
    expect(document).toContain("# S6a attach");
    expect(document).toContain(`Tags: ${FLOW_TAGS}`);
    expect(document).toContain('Saved from "Debug S6a attach" (thr_1)');
    expect(document).toContain("sequenceDiagram");

    expect(text(await harness.behavior.callAgentTool(SEARCH_TOOL, { query: "nothing-like-this" }))).toBe("No Library entries match.");
    const missing = await harness.behavior.callAgentTool(GET_TOOL, { id: "lib_00000000" });
    expect(missing).toMatchObject({ isError: true });
  });

  it("updates an entry in place, keeping its id, source, and omitted fields", async () => {
    const { harness, text, idOf } = await setup();
    const saved = text(
      await harness.behavior.callAgentTool(SAVE_TOOL, { title: "S6a attach", summary: "Attach", body: FLOW, tags: { topics: ["Outbox"] } }, { threadId: "thr_1" }),
    );
    const id = idOf(saved);

    const body = `${FLOW}\nThe HSS then sends CLR to the old MME.`;
    const reply = text(await harness.behavior.callAgentTool(UPDATE_TOOL, { id, body }));
    expect(reply).toBe(
      `Updated ${id} "S6a attach" in the Library (Flow).\nTags: Interfaces: S6a; Procedures: Attach; Messages: ULR/ULA, CLR/CLA; Network functions: MME, HSS; Topics: Outbox.`,
    );

    const entry = (await harness.behavior.callRpc("entry", { id })) as Entry;
    expect(entry).toMatchObject({ id, title: "S6a attach", summary: "Attach", kind: "flow", body, source: { threadId: "thr_1" } });

    const retagged = text(await harness.behavior.callAgentTool(UPDATE_TOOL, { id, tags: { docs: ["overview"] }, kind: "reference" }));
    expect(retagged).toContain("(Reference).\nTags: Interfaces: S6a; Procedures: Attach; Messages: ULR/ULA, CLR/CLA; Network functions: MME, HSS; Doc type: Overview.");
    expect(harness.inspection.realtimeSignals).toHaveLength(3);
  });

  it("rejects updates with nothing to change or an unknown id", async () => {
    const { harness, text } = await setup();
    const empty = await harness.behavior.callAgentTool(UPDATE_TOOL, { id: "lib_00000000" });
    expect(empty).toMatchObject({ isError: true });
    expect(text(empty)).toContain("Nothing to change");

    const missing = await harness.behavior.callAgentTool(UPDATE_TOOL, { id: "lib_00000000", title: "x" });
    expect(missing).toMatchObject({ isError: true });
    expect(text(missing)).toBe("No Library entry lib_00000000.");
  });
});

describe("cli", () => {
  it("saves with group flags, lists, shows, lists tags by group, and deletes", async () => {
    const { harness, idOf } = await setup();
    const saved = await harness.behavior.runCli(["save", "--title", "Gx CCR-I", "--body", "PCEF sends CCR-I over Gx.", "--tag", "pcrf", "--topic", "Policy,Quota"]);
    expect(saved.exitCode).toBe(0);
    expect(saved.stdout).toContain("Tags: Interfaces: Gx; Messages: CCR/CCA; Network functions: PCRF; Topics: Policy, Quota.");
    const id = idOf(saved.stdout ?? "");

    const listed = await harness.behavior.runCli(["list"]);
    expect(listed.stdout).toContain(`${id}\texplanation\tGx CCR-I\tGx, CCR/CCA, PCRF, Policy, Quota\t`);

    const searched = await harness.behavior.runCli(["search", "ccr-i", "--json"]);
    expect((JSON.parse(searched.stdout ?? "") as SearchResult).total).toBe(1);

    expect((await harness.behavior.runCli(["show", id])).stdout).toContain("PCEF sends CCR-I over Gx.");
    expect((await harness.behavior.runCli(["tags"])).stdout).toBe(
      "Interfaces\n    1  Gx\nMessages\n    1  CCR/CCA\nNetwork functions\n    1  PCRF\nTopics\n    1  Policy\n    1  Quota\n",
    );
    expect((await harness.behavior.runCli(["delete", id])).stdout).toBe(`Deleted ${id}.\n`);

    const missing = await harness.behavior.runCli(["show", id]);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain(`No Library entry ${id}.`);
  });

  it("describes the groups", async () => {
    const { harness } = await setup();
    const groups = await harness.behavior.runCli(["groups"]);
    expect(groups.stdout).toContain("interfaces\tInterfaces\t");
    expect(groups.stdout).toContain("components\tComponents\t");
    expect(groups.stdout).toContain("other\tOther\t");
  });

  it("regroups custom tags and refuses built-in ones", async () => {
    const { harness } = await setup();
    await harness.behavior.runCli(["save", "--title", "Infra", "--body", "text", "--tag", "Postgres"]);
    const moved = await harness.behavior.runCli(["regroup", "postgres", "tech"]);
    expect(moved.stdout).toBe("Moved Postgres to Tech stack.\n");
    expect(JSON.parse((await harness.behavior.runCli(["tags", "--json"])).stdout ?? "") as CatalogTag[]).toEqual([
      { tag: "Postgres", group: "tech", count: 1, builtIn: false },
    ]);

    const builtIn = await harness.behavior.runCli(["regroup", "S6a", "topics"]);
    expect(builtIn.exitCode).not.toBe(0);
    expect(builtIn.stderr).toContain("S6a is a built-in Interfaces tag and stays in that group.");

    const unknown = await harness.behavior.runCli(["regroup", "Postgres", "databases"]);
    expect(unknown.stderr).toContain('"databases" is not a tag group.');
  });

  it("retags saved entries with newly detected tags", async () => {
    const { harness } = await setup();
    const entry = (await harness.behavior.callRpc("save", {
      title: "Note",
      kind: "note",
      summary: "",
      body: "The SMS-GMSC sends SRR to the HSS.",
      tags: [],
      threadId: null,
      messageId: null,
    })) as Entry;
    const line = `${entry.id}\t+SRR/SRA, SMS-GMSC, HSS, SMS\tNote\n`;
    expect((await harness.behavior.runCli(["retag", "--dry-run"])).stdout).toBe(`${line}Would update 1 entry.\n`);
    expect((await harness.behavior.runCli(["retag"])).stdout).toBe(`${line}Updated 1 entry.\n`);
    expect((await harness.behavior.runCli(["retag"])).stdout).toBe("Updated 0 entries.\n");
  });

  it("updates an entry in place", async () => {
    const { harness, idOf } = await setup();
    const saved = await harness.behavior.runCli(["save", "--title", "Gx CCR-I", "--body", "PCEF sends CCR-I over Gx.", "--topic", "Policy"]);
    const id = idOf(saved.stdout ?? "");

    const updated = await harness.behavior.runCli(["update", id, "--body", "PCEF sends CCR-I and CCR-T over Gx.", "--summary", "Gx session"]);
    expect(updated.stdout).toBe(
      `Updated ${id} "Gx CCR-I" in the Library (Explanation).\nTags: Interfaces: Gx; Messages: CCR/CCA; Topics: Policy.\n`,
    );

    const shown = await harness.behavior.runCli(["show", id, "--json"]);
    expect(JSON.parse(shown.stdout ?? "") as Entry).toMatchObject({ id, title: "Gx CCR-I", summary: "Gx session", body: "PCEF sends CCR-I and CCR-T over Gx." });

    const nothing = await harness.behavior.runCli(["update", id]);
    expect(nothing.exitCode).not.toBe(0);
    expect(nothing.stderr).toContain("Nothing to change.");

    const missing = await harness.behavior.runCli(["edit", "lib_00000000", "--title", "x"]);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain("No Library entry lib_00000000.");
    expect((await harness.behavior.runCli(["update", id, "--body", "  "])).exitCode).not.toBe(0);
  });

  it("rejects malformed ids and empty bodies", async () => {
    const { harness } = await setup();
    expect((await harness.behavior.runCli(["show", "abc"])).stderr).toContain("expected a Library entry id");
    expect((await harness.behavior.runCli(["save", "--title", "x", "--body", "  "])).exitCode).not.toBe(0);
  });

  it("records the invoking thread as the source", async () => {
    const { harness } = await setup();
    const saved = await harness.behavior.runCli(["save", "--title", "Note", "--body", "text", "--json"], { threadId: "thr_1" });
    expect((JSON.parse(saved.stdout ?? "") as Entry).source.threadTitle).toBe("Debug S6a attach");
  });
});

describe("rpc and events", () => {
  it("saves the UI's tags verbatim, applies their groups, and updates and removes entries", async () => {
    const { harness } = await setup();
    const entry = (await harness.behavior.callRpc("save", {
      title: "Attach",
      kind: "flow",
      summary: "",
      body: FLOW,
      tags: [{ tag: "Outbox", group: "topics" }],
      threadId: null,
      messageId: "msg_1",
    })) as Entry;
    expect(entry.tags).toEqual([{ tag: "Outbox", group: "topics" }]);
    expect(entry.source.messageId).toBe("msg_1");

    const updated = (await harness.behavior.callRpc("update", {
      id: entry.id,
      title: "Attach v2",
      kind: "flow",
      summary: "",
      body: FLOW,
      tags: [
        { tag: "S6a", group: "interfaces" },
        { tag: "Outbox", group: "components" },
      ],
    })) as Entry;
    expect(updated).toMatchObject({
      title: "Attach v2",
      tags: [
        { tag: "S6a", group: "interfaces" },
        { tag: "Outbox", group: "components" },
      ],
    });
    expect(((await harness.behavior.callRpc("catalog", null)) as { tags: CatalogTag[] }).tags).toEqual([
      { tag: "S6a", group: "interfaces", count: 1, builtIn: true },
      { tag: "Outbox", group: "components", count: 1, builtIn: false },
    ]);
    await expect(
      harness.behavior.callRpc("update", { id: "lib_00000000", title: "x", kind: "note", summary: "", body: "x", tags: [] }),
    ).rejects.toThrow();

    expect(await harness.behavior.callRpc("remove", { id: entry.id })).toEqual({ removed: true });
    expect(await harness.behavior.callRpc("entry", { id: entry.id })).toBeNull();
    expect(harness.inspection.realtimeSignals).toHaveLength(3);
  });

  it("unlinks entries from deleted threads", async () => {
    const { harness } = await setup();
    await harness.behavior.callAgentTool(SAVE_TOOL, { title: "Note", body: "text" }, { threadId: "thr_1" });
    await harness.behavior.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: "thr_1" }) });
    const result = (await harness.behavior.callRpc("search", { query: "", kind: null, tags: [], threadId: null, limit: 5 })) as SearchResult;
    expect(result.entries[0]?.source).toEqual({ threadId: null, threadTitle: "Debug S6a attach", messageId: null });
  });
});
