import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { SearchInput } from "./contract";
import type { TagDraft } from "./glossary";
import { MARK_START, type TagGroup } from "./library";
import { createStore, ftsQuery, type GroupMode, type NewEntry } from "./store";

const plain = (...tags: string[]): TagDraft[] => tags.map((tag) => ({ tag, group: null }));
const grouped = (group: TagGroup, ...tags: string[]): TagDraft[] => tags.map((tag) => ({ tag, group }));

function setup() {
  const { bb } = createFakePluginHost({ pluginId: "library" });
  const store = createStore(bb.storage);
  const add = (entry: Partial<NewEntry> & Pick<NewEntry, "title" | "body">, mode: GroupMode = "keep") =>
    store.create({ kind: "explanation", summary: "", tags: [], threadId: null, threadTitle: null, messageId: null, ...entry }, mode);
  const search = (input: Partial<SearchInput>) => store.search({ query: "", kind: null, tags: [], threadId: null, limit: 50, ...input });
  return { bb, store, add, search };
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
  it("creates entries with canonical, grouped tags and a source", () => {
    const { add } = setup();
    const entry = add({ title: "S6a attach", body: "ULR then ULA", tags: plain("hss", "s6a", "S6A", "attach"), threadId: "thr_1", threadTitle: "Debug" });
    expect(entry).toMatchObject({
      id: expect.stringMatching(/^lib_[a-z0-9]{8}$/),
      tags: [
        { tag: "S6a", group: "interfaces" },
        { tag: "Attach", group: "procedures" },
        { tag: "HSS", group: "functions" },
      ],
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

  it("filters by tag case-insensitively and by kind, with grouped tag facets", () => {
    const { add, search } = setup();
    add({ title: "A", body: "x", kind: "flow", tags: plain("S6a", "Attach") });
    add({ title: "B", body: "x", kind: "diagram", tags: [...plain("S6a"), ...grouped("topics", "Outbox")] });
    add({ title: "C", body: "x", kind: "flow", tags: plain("Gx") });

    const s6a = search({ tags: ["s6a"] });
    expect(s6a.entries.map((entry) => entry.title).sort()).toEqual(["A", "B"]);
    expect(s6a.tags).toEqual([
      { tag: "S6a", group: "interfaces", count: 2 },
      { tag: "Attach", group: "procedures", count: 1 },
      { tag: "Outbox", group: "topics", count: 1 },
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
    store.update(entry.id, { title: "Rx policy", kind: "flow", summary: "", body: "about Rx", tags: [] }, "keep");
    expect(search({ query: "Gx" }).total).toBe(0);
    expect(search({ query: "Rx" }).entries.map((hit) => hit.title)).toEqual(["Rx policy"]);
    expect(store.update("lib_00000000", { title: "x", kind: "note", summary: "", body: "x", tags: [] }, "keep")).toBeNull();
    expect(store.remove(entry.id)).toBe(true);
    expect(store.remove(entry.id)).toBe(false);
    expect(search({ query: "Rx" }).total).toBe(0);
  });
});

describe("tag groups", () => {
  it("leaves tags nobody grouped in other", () => {
    const { add } = setup();
    expect(add({ title: "A", body: "x", tags: plain("Mystery") }).tags).toEqual([{ tag: "Mystery", group: "other" }]);
  });

  it("keeps a tag's first group unless the edit sets it explicitly", () => {
    const { store, add } = setup();
    const first = add({ title: "A", body: "x", tags: grouped("topics", "Outbox") });
    add({ title: "B", body: "x", tags: grouped("components", "outbox") });
    expect(store.get(first.id)?.tags).toEqual([{ tag: "Outbox", group: "topics" }]);

    add({ title: "C", body: "x", tags: grouped("components", "Outbox") }, "set");
    expect(store.get(first.id)?.tags).toEqual([{ tag: "Outbox", group: "components" }]);
  });

  it("never moves built-in telecom tags", () => {
    const { store, add } = setup();
    const entry = add({ title: "A", body: "x", tags: grouped("topics", "S6a") }, "set");
    expect(entry.tags).toEqual([{ tag: "S6a", group: "interfaces" }]);
    expect(store.regroup("s6a", "topics")).toEqual({ ok: false, tag: "S6a", group: "interfaces" });
  });

  it("regroups a tag everywhere, keeping its spelling, and ungroups with other", () => {
    const { store, add } = setup();
    const entry = add({ title: "A", body: "x", tags: grouped("topics", "Outbox") });
    expect(store.regroup("outbox", "components")).toEqual({ ok: true, tag: "Outbox", group: "components" });
    expect(store.get(entry.id)?.tags).toEqual([{ tag: "Outbox", group: "components" }]);
    expect(store.regroup("Outbox", "other")).toEqual({ ok: true, tag: "Outbox", group: "other" });
  });

  it("persists groups across store instances", () => {
    const { bb, add } = setup();
    add({ title: "A", body: "x", tags: grouped("tech", "Postgres") });
    expect(createStore(bb.storage).groupOf("postgres")).toBe("tech");
  });

  it("lists the catalog by group with counts, including grouped tags no entry uses", () => {
    const { store, add } = setup();
    add({ title: "A", body: "x", tags: [...plain("S6a", "HSS"), ...grouped("topics", "Outbox")] });
    add({ title: "B", body: "x", tags: plain("S6a") });
    store.regroup("Failover", "topics");
    expect(store.catalog()).toEqual([
      { tag: "S6a", group: "interfaces", count: 2, builtIn: true },
      { tag: "HSS", group: "functions", count: 1, builtIn: true },
      { tag: "Outbox", group: "topics", count: 1, builtIn: false },
      { tag: "Failover", group: "topics", count: 0, builtIn: false },
    ]);
  });
});

describe("retag", () => {
  it("adds newly detected tags without touching edit times, and only once", () => {
    const { store, add } = setup();
    const entry = add({ title: "S6c delivery", body: "The SMS-GMSC sends SRR to the HSS." });
    store.update(entry.id, { title: entry.title, kind: entry.kind, summary: "", body: entry.body, tags: plain("mme") }, "keep");
    const before = store.get(entry.id)!;

    expect(store.retag(true)).toEqual([{ id: entry.id, title: "S6c delivery", added: ["S6c", "SRR/SRA", "SMS-GMSC", "HSS", "SMS"] }]);
    expect(store.get(entry.id)?.tags).toEqual(before.tags);

    store.retag(false);
    const after = store.get(entry.id)!;
    expect(after.tags.map(({ tag }) => tag)).toEqual(["S6c", "SRR/SRA", "MME", "SMS-GMSC", "HSS", "SMS"]);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(store.retag(false)).toEqual([]);
  });

  it("respells custom tags to their grouped spelling", () => {
    const { bb, store, add } = setup();
    add({ title: "A", body: "x", tags: grouped("topics", "Outbox") });
    const old = add({ title: "B", body: "x" });
    bb.storage.database().prepare("UPDATE entries SET tags = ? WHERE id = ?").run('["outbox"]', old.id);

    expect(store.retag(false)).toEqual([{ id: old.id, title: "B", added: [] }]);
    expect(store.get(old.id)?.tags).toEqual([{ tag: "Outbox", group: "topics" }]);
  });
});
