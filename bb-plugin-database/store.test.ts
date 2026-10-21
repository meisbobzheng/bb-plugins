import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { ConnectionInput } from "./contract";
import { createStore } from "./store";

const NOW = "2026-10-21T12:00:00.000Z";

function setup() {
  const { bb } = createFakePluginHost({ pluginId: "database" });
  return createStore(bb.storage);
}

const base: ConnectionInput = {
  name: "local",
  host: "127.0.0.1",
  port: 5432,
  database: "bbtest",
  user: "postgres",
  userFollowsDatabase: false,
  auth: { kind: "password" },
  ssl: false,
  password: "secret",
};

describe("connections", () => {
  it("saves, finds by id or name, and hides the password", () => {
    const store = setup();
    const saved = store.saveConnection(base, NOW);
    expect(saved).toMatchObject({ name: "local", hasPassword: true, allowWrites: false, createdAt: NOW });
    expect(saved).not.toHaveProperty("password");
    expect(store.password(saved.id)).toBe("secret");
    expect(store.findConnection("LOCAL")?.id).toBe(saved.id);
    expect(store.findConnection(saved.id)?.id).toBe(saved.id);
    expect(store.findConnection("nope")).toBeNull();
  });

  it("keeps the password on update unless cleared or replaced", () => {
    const store = setup();
    const { id } = store.saveConnection(base, NOW);
    store.saveConnection({ ...base, id, name: "renamed", password: undefined }, NOW);
    expect(store.password(id)).toBe("secret");
    store.saveConnection({ ...base, id, password: "next" }, NOW);
    expect(store.password(id)).toBe("next");
    store.saveConnection({ ...base, id, password: null }, NOW);
    expect(store.password(id)).toBeNull();
    expect(store.getConnection(id)?.hasPassword).toBe(false);
  });

  it("drops a stored password when switching to IAM auth", () => {
    const store = setup();
    const { id } = store.saveConnection(base, NOW);
    const updated = store.saveConnection({ ...base, id, auth: { kind: "rds-iam", profile: "nucleus-dev", region: "us-east-1" } }, NOW);
    expect(updated.auth).toEqual({ kind: "rds-iam", profile: "nucleus-dev", region: "us-east-1" });
    expect(store.password(id)).toBeNull();
  });

  it("toggles writes, switches databases, and deletes", async () => {
    const store = setup();
    const { id } = store.saveConnection(base, NOW);
    expect(store.setWrites(id, true, NOW)?.allowWrites).toBe(true);
    expect(store.setDatabase(id, "hss", NOW)?.database).toBe("hss");
    await store.setActiveId(id);
    expect(await store.activeId()).toBe(id);
    expect(store.deleteConnection(id)).toBe(true);
    expect(store.deleteConnection(id)).toBe(false);
    expect(store.listConnections()).toEqual([]);
  });
});

describe("history", () => {
  it("records, searches, filters by connection, and clears", () => {
    const store = setup();
    const a = store.saveConnection(base, NOW);
    const b = store.saveConnection({ ...base, name: "other" }, NOW);
    const entry = (connectionId: string, sql: string, prompt: string | null = null) =>
      store.recordHistory({ connectionId, connectionName: "x", database: "bbtest", sql, source: "editor", prompt, startedAt: NOW, durationMs: 12.6, rowCount: 3, error: null });
    entry(a.id, "select * from subscribers");
    entry(a.id, "select count(*) from plans", "how many plans");
    entry(b.id, "select 1");
    expect(store.listHistory({ connectionId: null, query: "", limit: 10 })).toHaveLength(3);
    expect(store.listHistory({ connectionId: a.id, query: "", limit: 10 })).toHaveLength(2);
    expect(store.listHistory({ connectionId: null, query: "many plans", limit: 10 }).map((item) => item.sql)).toEqual(["select count(*) from plans"]);
    expect(store.listHistory({ connectionId: null, query: "100%", limit: 10 })).toEqual([]);
    expect(store.listHistory({ connectionId: null, query: "", limit: 1 })[0]).toMatchObject({ sql: "select 1", durationMs: 13 });
    expect(store.clearHistory(a.id)).toBe(2);
    expect(store.clearHistory(null)).toBe(1);
  });
});

describe("saved queries", () => {
  it("saves, updates in place, lists per connection plus global, and deletes", () => {
    const store = setup();
    const a = store.saveConnection(base, NOW);
    const b = store.saveConnection({ ...base, name: "other" }, NOW);
    const scoped = store.saveQuery({ connectionId: a.id, name: "Active", sql: "select 1" }, NOW);
    const global = store.saveQuery({ connectionId: null, name: "Version", sql: "select version()" }, NOW);
    store.saveQuery({ connectionId: b.id, name: "Other", sql: "select 2" }, NOW);
    expect(store.listSaved(a.id).map((item) => item.name)).toEqual(["Active", "Version"]);
    expect(store.listSaved(null)).toHaveLength(3);
    const renamed = store.saveQuery({ id: scoped.id, connectionId: a.id, name: "Active subscribers", sql: "select 1" }, "2026-10-22T00:00:00.000Z");
    expect(renamed).toMatchObject({ id: scoped.id, name: "Active subscribers", createdAt: NOW, updatedAt: "2026-10-22T00:00:00.000Z" });
    expect(store.deleteSaved(global.id)).toBe(true);
    expect(store.listSaved(a.id)).toHaveLength(1);
  });
});
