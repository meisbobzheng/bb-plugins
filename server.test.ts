import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { Entry, SearchResult } from "./contract";
import { CHANGED_CHANNEL } from "./library";
import plugin, { GET_TOOL, SAVE_TOOL, SEARCH_TOOL } from "./server";

const FLOW = [
  "```mermaid",
  "sequenceDiagram",
  "  MME->>HSS: ULR",
  "  HSS-->>MME: ULA",
  "```",
  "The MME registers the UE on S6a during EPS attach.",
].join("\n");

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
  return { harness, text };
}

describe("agent tools", () => {
  it("saves with detected tags, a guessed kind, and the source thread", async () => {
    const { harness, text } = await setup();
    const reply = text(await harness.behavior.callAgentTool(SAVE_TOOL, { title: "S6a attach", body: FLOW, tags: ["mme"] }, { threadId: "thr_1" }));
    expect(reply).toMatch(/^Saved lib_[a-z0-9]{8} "S6a attach" to the Library \(Flow\) with tags: mme, Attach, S6a, ULR\/ULA\.$/);

    const id = /lib_[a-z0-9]{8}/.exec(reply)![0];
    const entry = (await harness.behavior.callRpc("entry", { id })) as Entry;
    expect(entry).toMatchObject({ kind: "flow", source: { threadId: "thr_1", threadTitle: "Debug S6a attach" } });
    expect(harness.inspection.realtimeSignals.map((signal) => signal.channel)).toEqual([CHANGED_CHANNEL]);
  });

  it("keeps a source thread it cannot look up, without a title", async () => {
    const { harness } = await setup();
    await harness.behavior.callAgentTool(SAVE_TOOL, { title: "Note", body: "text", kind: "note" }, { threadId: "thr_gone" });
    const result = (await harness.behavior.callRpc("search", { query: "", kind: null, tags: [], threadId: null, limit: 5 })) as SearchResult;
    expect(result.entries[0]).toMatchObject({ kind: "note", source: { threadId: "thr_gone", threadTitle: null } });
  });

  it("searches and reads entries", async () => {
    const { harness, text } = await setup();
    await harness.behavior.callAgentTool(SAVE_TOOL, { title: "S6a attach", body: FLOW }, { threadId: "thr_1" });

    const found = text(await harness.behavior.callAgentTool(SEARCH_TOOL, { query: "registers", tags: ["s6a"] }));
    expect(found).toContain("1 match (id, kind, title, tags, updated):");
    expect(found).toContain("**registers**");

    const id = /lib_[a-z0-9]{8}/.exec(found)![0];
    const document = text(await harness.behavior.callAgentTool(GET_TOOL, { id }));
    expect(document).toContain("# S6a attach");
    expect(document).toContain('Saved from "Debug S6a attach" (thr_1)');
    expect(document).toContain("sequenceDiagram");

    expect(text(await harness.behavior.callAgentTool(SEARCH_TOOL, { query: "nothing-like-this" }))).toBe("No Library entries match.");
    const missing = await harness.behavior.callAgentTool(GET_TOOL, { id: "lib_00000000" });
    expect(missing).toMatchObject({ isError: true });
  });
});

describe("cli", () => {
  it("saves, lists, shows, tags, and deletes", async () => {
    const { harness } = await setup();
    const saved = await harness.behavior.runCli(["save", "--title", "Gx CCR-I", "--body", "PCEF sends CCR-I over Gx.", "--tag", "pcrf,ims"]);
    expect(saved.exitCode).toBe(0);
    expect(saved.stdout).toContain("with tags: pcrf, ims, Gx, CCR/CCA.");
    const id = /lib_[a-z0-9]{8}/.exec(saved.stdout ?? "")![0];

    const listed = await harness.behavior.runCli(["list"]);
    expect(listed.stdout).toContain(`${id}\texplanation\tGx CCR-I\tpcrf, ims, Gx, CCR/CCA\t`);

    const searched = await harness.behavior.runCli(["search", "ccr-i", "--json"]);
    expect((JSON.parse(searched.stdout ?? "") as SearchResult).total).toBe(1);

    expect((await harness.behavior.runCli(["show", id])).stdout).toContain("PCEF sends CCR-I over Gx.");
    expect((await harness.behavior.runCli(["tags"])).stdout).toContain("1\tGx\n");
    expect((await harness.behavior.runCli(["delete", id])).stdout).toBe(`Deleted ${id}.\n`);

    const missing = await harness.behavior.runCli(["show", id]);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain(`No Library entry ${id}.`);
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
  it("updates and removes entries and keeps saved tags verbatim", async () => {
    const { harness } = await setup();
    const entry = (await harness.behavior.callRpc("save", {
      title: "Attach",
      kind: "flow",
      summary: "",
      body: FLOW,
      tags: [],
      threadId: null,
      messageId: "msg_1",
    })) as Entry;
    expect(entry.tags).toEqual([]);
    expect(entry.source.messageId).toBe("msg_1");

    const updated = (await harness.behavior.callRpc("update", { id: entry.id, title: "Attach v2", kind: "flow", summary: "", body: FLOW, tags: ["S6a"] })) as Entry;
    expect(updated).toMatchObject({ title: "Attach v2", tags: ["S6a"] });
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
