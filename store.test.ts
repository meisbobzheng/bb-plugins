import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { SearchInput } from "./contract";
import { MARK_START } from "./library";
import { createStore, ftsQuery, type NewEntry } from "./store";

function setup() {
  const { bb } = createFakePluginHost({ pluginId: "library" });
  const store = createStore(bb.storage);
  const add = (entry: Partial<NewEntry> & Pick<NewEntry, "title" | "body">) =>
    store.create({ kind: "explanation", summary: "", tags: [], threadId: null, threadTitle: null, messageId: null, ...entry });
  const search = (input: Partial<SearchInput>) => store.search({ query: "", kind: null, tags: [], threadId: null, limit: 50, ...input });
  return { store, add, search };
}

describe("ftsQuery", () => {
  it("prefix-matches bare words and keeps quoted phrases exact", () => {
    expect(ftsQuery('regis "update location" CCR-I')).toBe('"regis"* "update location" "CCR I"*');
  });

  it("drops FTS syntax and empty input", () => {
    expect(ftsQuery('AND ( ) * " NEAR')).toBe('"AND"* "NEAR"*');
    expect(ftsQuery("  ")).toBeNull();
    expect(ftsQuery("()")).toBeNull();
  });
});

describe("store", () => {
  it("creates entries with canonical tags and source", () => {
    const { add } = setup();
    const entry = add({ title: "S6a attach", body: "ULR then ULA", tags: ["s6a", "S6A", "attach"], threadId: "thr_1", threadTitle: "Debug" });
    expect(entry).toMatchObject({
      id: expect.stringMatching(/^lib_[a-z0-9]{8}$/),
      tags: ["S6a", "Attach"],
      source: { threadId: "thr_1", threadTitle: "Debug", messageId: null },
    });
  });

  it("lists newest first without a query", () => {
    const { add, search } = setup();
    add({ title: "First", body: "a" });
    add({ title: "Second", body: "b" });
    expect(search({}).entries.map((entry) => entry.title)).toEqual(["Second", "First"]);
  });

  it("finds prefixes, hyphenated messages, and ranks titles above bodies", () => {
    const { add, search } = setup();
    add({ title: "Gx session", body: "The PCEF sends CCR-I to the PCRF during registration." });
    add({ title: "Registration flow", body: "IMS REGISTER via P-CSCF." });
    const regis = search({ query: "regis" });
    expect(regis.entries.map((entry) => entry.title)).toEqual(["Registration flow", "Gx session"]);
    expect(search({ query: "CCR-I" }).entries.map((entry) => entry.title)).toEqual(["Gx session"]);
    expect(search({ query: "ccr-i pcrf" }).entries[0]?.snippet).toContain(MARK_START);
  });

  it("filters by tag case-insensitively and by kind, with kind facets ignoring the kind filter", () => {
    const { add, search } = setup();
    add({ title: "A", body: "x", kind: "flow", tags: ["S6a", "Attach"] });
    add({ title: "B", body: "x", kind: "diagram", tags: ["S6a"] });
    add({ title: "C", body: "x", kind: "flow", tags: ["Gx"] });

    const s6a = search({ tags: ["s6a"] });
    expect(s6a.entries.map((entry) => entry.title).sort()).toEqual(["A", "B"]);
    expect(s6a.tags).toEqual([
      { tag: "S6a", count: 2 },
      { tag: "Attach", count: 1 },
    ]);

    const flows = search({ tags: ["S6a"], kind: "flow" });
    expect(flows.total).toBe(1);
    expect(flows.kinds).toEqual(expect.arrayContaining([{ kind: "flow", count: 1 }, { kind: "diagram", count: 1 }]));
  });

  it("filters by source thread and forgets deleted threads", () => {
    const { store, add, search } = setup();
    add({ title: "From thread", body: "x", threadId: "thr_1", threadTitle: "Debug" });
    add({ title: "Elsewhere", body: "x" });
    expect(search({ threadId: "thr_1" }).entries.map((entry) => entry.title)).toEqual(["From thread"]);
    expect(store.forgetThread("thr_1")).toBe(1);
    expect(search({ threadId: "thr_1" }).total).toBe(0);
    expect(search({ query: "from thread" }).entries[0]?.source).toEqual({ threadId: null, threadTitle: "Debug", messageId: null });
  });

  it("reindexes edits and removes deleted entries from search", () => {
    const { store, add, search } = setup();
    const entry = add({ title: "Old title", body: "about Gx" });
    store.update(entry.id, { title: "Rx policy", kind: "flow", summary: "", body: "about Rx", tags: [] });
    expect(search({ query: "Gx" }).total).toBe(0);
    expect(search({ query: "Rx" }).entries.map((hit) => hit.title)).toEqual(["Rx policy"]);
    expect(store.update("lib_00000000", { title: "x", kind: "note", summary: "", body: "x", tags: [] })).toBeNull();
    expect(store.remove(entry.id)).toBe(true);
    expect(store.remove(entry.id)).toBe(false);
    expect(search({ query: "Rx" }).total).toBe(0);
  });
});
