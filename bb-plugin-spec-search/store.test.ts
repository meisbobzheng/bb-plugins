import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { parseDocx } from "./docx";
import { SPEC_29228 } from "./fixtures";
import { MARK_START, createStore, ftsQuery, type NewSpec } from "./store";

const META: NewSpec = { spec: "29.228", kind: "TS", title: "Cx and Dx", version: "19.2.0", release: 19, source: "3gpp", origin: "test", sha256: "a" };

async function setup() {
  const { bb } = createFakePluginHost({ pluginId: "spec-search" });
  const store = createStore(bb.storage);
  const { clauses } = await parseDocx(SPEC_29228);
  await store.replace(META, clauses);
  const search = (query: string, spec: string | null = null, limit = 10) => store.search({ query, spec, limit });
  return { bb, store, clauses, search };
}

describe("ftsQuery", () => {
  it("prefix-matches bare words and keeps quoted phrases exact", () => {
    expect(ftsQuery('regis "user profile" Update-Location')).toBe('"regis"* "user profile" "Update Location"*');
    expect(ftsQuery("()")).toBeNull();
  });
});

describe("store", () => {
  it("puts an exact clause first, then its direct subclauses", async () => {
    const { search } = await setup();
    expect(search("29.228 B").hits.map(({ clause, match }) => [clause, match])).toEqual([
      ["B", "clause"],
      ["B.1", "subclause"],
      ["B.2", "subclause"],
    ]);
    const [hit] = search("TS 29.228 §b.1").hits;
    expect(hit).toMatchObject({ spec: "29.228", clause: "B.1", title: "General description", version: "19.2.0", match: "clause" });
    expect(hit?.snippet).toContain("UML model of the user profile");
  });

  it("lists a spec's top-level clauses for a bare spec number", async () => {
    const { search } = await setup();
    expect(search("29.228").hits.map(({ clause, match }) => [clause, match])).toEqual([
      ["Foreword", "contents"],
      ["6", "contents"],
      ["B", "contents"],
    ]);
  });

  it("ranks title matches first, stems words, and marks snippets", async () => {
    const { search } = await setup();
    const hits = search("registration").hits;
    expect(hits[0]).toMatchObject({ clause: "6.1", match: "text" });
    expect(search("public identities").hits[0]?.clause).toBe("B.2.1");
    expect(search("downloaded S-CSCF").hits[0]?.snippet).toContain(MARK_START);
    expect(search("TEL URI").hits[0]?.clause).toBe("B.2.1");
  });

  it("reports a spec that is not indexed", async () => {
    const { search } = await setup();
    expect(search("29.272 7.3.2")).toEqual({ hits: [], missing: "29.272" });
    expect(search("purge", "29.272").missing).toBe("29.272");
  });

  it("reads a clause with its parent and children, deep on request", async () => {
    const { store } = await setup();
    const shallow = store.clause("29.228", "B.2", false)!;
    expect(shallow).toMatchObject({ clause: "B.2", body: "", parent: { clause: "B" }, children: [{ clause: "B.2.1", title: "Public Identification" }] });
    expect(store.clause("29.228", "B.2", true)!.body).toContain("B.2.1 Public Identification\nThe class Public Identification");
    expect(store.clause("29.228", "Z.9", false)).toBeNull();
  });

  it("finds the clause a passage comes from", async () => {
    const { store } = await setup();
    const [best] = store.identify("an outline of the UML model of the user profile, which is downloaded from HSS", 3);
    expect(best).toMatchObject({ spec: "29.228", clause: "B.1" });
    expect(best!.confidence).toBeGreaterThan(0.9);
    expect(store.identify("completely unrelated words about weather forecasts", 3)).toEqual([]);
  });

  it("replaces an older version and removes specs", async () => {
    const { store, clauses, search } = await setup();
    await store.replace({ ...META, version: "19.3.0", sha256: "b" }, clauses.slice(0, 3));
    expect(store.listSpecs().map(({ spec, version, clauses: count }) => [spec, version, count])).toEqual([["29.228", "19.3.0", 3]]);
    expect(search("29.228 B.1").hits).toEqual([]);
    expect(store.hasFile("a")).toBe(false);
    expect(await store.remove("29.228")).toBe(true);
    expect(store.listSpecs()).toEqual([]);
    expect(search("registration").hits).toEqual([]);
  });

  it("queues each target once and hands jobs out in order", async () => {
    const { store } = await setup();
    const first = store.enqueue("fetch", "29.228", 19);
    expect(store.enqueue("fetch", "29.228", 19).id).toBe(first.id);
    store.enqueue("fetch", "29.272", 19);
    expect(store.claimJob()).toMatchObject({ target: "29.228", status: "running" });
    expect(store.requeueRunning()).toBe(1);
    expect(store.claimJob()?.target).toBe("29.228");
    store.finishJob(first.id, "done", "ok");
    expect(store.claimJob()?.target).toBe("29.272");
    expect(store.claimJob()).toBeNull();
  });
});
