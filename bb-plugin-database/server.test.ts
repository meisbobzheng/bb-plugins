import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { QUERY_TOOL, SCHEMA_TOOL } from "./agent";
import type { Connection, ConnectionInput, ExplainResult, QueryRun, SchemaSnapshot, TestResult } from "./contract";
import plugin from "./server";

const url = process.env.BB_DATABASE_TEST_URL;
const target = url === undefined ? null : new URL(url);

function input(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return {
    name: "local",
    host: target?.hostname ?? "127.0.0.1",
    port: Number(target?.port ?? 5432),
    database: target?.pathname.slice(1) ?? "bbtest",
    user: target?.username ?? "postgres",
    userFollowsDatabase: false,
    auth: { kind: "password" },
    ssl: false,
    password: target?.password || "unused",
    ...overrides,
  };
}

function text(result: unknown): string {
  return typeof result === "string" ? result : (result as { content: Array<{ text: string }> }).content.map((part) => part.text).join("");
}

describe.skipIf(target === null)("Database plugin against a live PostgreSQL", () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "database" });
  let connection: Connection;

  beforeAll(async () => {
    await plugin(bb);
    connection = (await harness.behavior.callRpc("connections_save", input())) as Connection;
    await harness.behavior.callRpc("connections_activate", { id: connection.id });
  });

  afterAll(async () => {
    await harness.lifecycle.dispose();
  });

  it("tests a connection and reports the server", async () => {
    const result = (await harness.behavior.callRpc("connections_test", input())) as TestResult;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.database).toBe(connection.database);
  });

  it("reports an unreachable host as a connection error", async () => {
    const result = (await harness.behavior.callRpc("connections_test", input({ port: 1 }))) as TestResult;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("connection");
  });

  it("runs a select through a cursor and caps the rows", async () => {
    const run = (await harness.behavior.callRpc("query_run", { connectionId: connection.id, sql: "select id, imsi from subscribers order by id", maxRows: 5 })) as QueryRun;
    expect(run.error).toBeNull();
    expect(run.results[0]).toMatchObject({ command: "SELECT", truncated: true, rowCount: 5 });
    expect(run.results[0]?.columns.map((column) => `${column.name}:${column.type}`)).toEqual(["id:int8", "imsi:text"]);
    expect(run.results[0]?.rows).toHaveLength(5);
    expect(run.results[0]?.rows[0]).toEqual(["1", "310260000000001"]);
    expect(run.readOnly).toBe(true);
  });

  it("returns every result of a multi-statement script with text values", async () => {
    const run = (await harness.behavior.callRpc("query_run", { connectionId: connection.id, sql: "select true as ok, null as nothing, '{\"a\":1}'::jsonb as doc; show search_path" })) as QueryRun;
    expect(run.error).toBeNull();
    expect(run.results).toHaveLength(2);
    expect(run.results[0]?.rows[0]).toEqual(["t", null, '{"a": 1}']);
    expect(run.results[0]?.columns[0]).toMatchObject({ type: "bool" });
    expect(run.results[1]?.command).toBe("SHOW");
  });

  it("maps SQL errors with their position", async () => {
    const run = (await harness.behavior.callRpc("query_run", { connectionId: connection.id, sql: "select nope from subscribers" })) as QueryRun;
    expect(run.error).toMatchObject({ kind: "sql", code: "42703", position: 8 });
  });

  it("refuses writes until the connection allows them", async () => {
    const blocked = (await harness.behavior.callRpc("query_run", { connectionId: connection.id, sql: "create table bb_plugin_test (id int)" })) as QueryRun;
    expect(blocked.error).toMatchObject({ kind: "sql", code: "25006" });
    await harness.behavior.callRpc("connections_set_writes", { id: connection.id, allowWrites: true });
    try {
      const created = (await harness.behavior.callRpc("query_run", { connectionId: connection.id, sql: "create table bb_plugin_test (id int); insert into bb_plugin_test values (1), (2)" })) as QueryRun;
      expect(created.error).toBeNull();
      expect(created.results.map((set) => [set.command, set.rowCount])).toEqual([
        ["CREATE", null],
        ["INSERT", 2],
      ]);
      expect(created.readOnly).toBe(false);
      const refreshed = (await harness.behavior.callRpc("schema_get", { connectionId: connection.id, refresh: false })) as SchemaSnapshot;
      expect(refreshed.tables.some((table) => table.name === "bb_plugin_test")).toBe(true);
    } finally {
      await harness.behavior.callRpc("query_run", { connectionId: connection.id, sql: "drop table if exists bb_plugin_test" });
      await harness.behavior.callRpc("connections_set_writes", { id: connection.id, allowWrites: false });
    }
  });

  it("cancels a running query", async () => {
    const queryId = "qry_canceltest";
    const pending = harness.behavior.callRpc("query_run", { connectionId: connection.id, sql: "select pg_sleep(20)", queryId }) as Promise<QueryRun>;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { cancelled } = (await harness.behavior.callRpc("query_cancel", { queryId })) as { cancelled: boolean };
    expect(cancelled).toBe(true);
    const run = await pending;
    expect(run.error?.kind).toBe("cancelled");
  });

  it("explains a statement without executing writes", async () => {
    const result = (await harness.behavior.callRpc("query_explain", { connectionId: connection.id, sql: "select * from subscribers where status = 'active'", analyze: true })) as ExplainResult;
    expect(result.error).toBeNull();
    const root = result.plan?.[0] as { Plan: { "Node Type": string }; "Execution Time": number };
    expect(root.Plan["Node Type"]).toBeTruthy();
    expect(root["Execution Time"]).toBeGreaterThan(0);
  });

  it("introspects tables, columns, keys, and lists databases", async () => {
    const snapshot = (await harness.behavior.callRpc("schema_get", { connectionId: connection.id, refresh: true })) as SchemaSnapshot;
    const subscribers = snapshot.tables.find((table) => table.name === "subscribers");
    expect(subscribers).toMatchObject({ schema: "public", kind: "table", comment: "One row per provisioned SIM" });
    expect(subscribers?.columns.find((column) => column.name === "id")).toMatchObject({ type: "bigint", primaryKey: true, nullable: false });
    expect(subscribers?.columns.find((column) => column.name === "imsi")?.comment).toBe("International mobile subscriber identity");
    const invoices = snapshot.tables.find((table) => table.schema === "billing" && table.name === "invoices");
    expect(invoices?.foreignKeys[0]).toMatchObject({ refSchema: "public", refTable: "subscribers" });
    expect(snapshot.tables.find((table) => table.name === "active_subscribers")?.kind).toBe("view");
    const { databases } = (await harness.behavior.callRpc("databases_list", { connectionId: connection.id })) as { databases: string[] };
    expect(databases).toContain(connection.database);
  });

  it("switches the database and the role that follows it", async () => {
    const hss = (await harness.behavior.callRpc("connections_save", input({ name: "nucleus", database: "hss", userFollowsDatabase: true }))) as Connection;
    const result = (await harness.behavior.callRpc("connections_test", input({ id: hss.id, name: "nucleus", database: "hss", userFollowsDatabase: true, password: undefined }))) as TestResult;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user).toBe("hss");
    await harness.behavior.callRpc("connections_delete", { id: hss.id });
  });

  it("answers agents read-only and refuses writes", async () => {
    const reply = text(await harness.behavior.callAgentTool(QUERY_TOOL, { sql: "select name, price_cents from plans order by id", limit: 10 }));
    expect(reply).toContain("Basic");
    expect(reply).toContain("3 rows");
    const refused = await harness.behavior.callAgentTool(QUERY_TOOL, { sql: "delete from plans" });
    expect(text(refused)).toContain("Only read-only SQL");
    expect((refused as { isError?: boolean }).isError).toBe(true);
    const schema = text(await harness.behavior.callAgentTool(SCHEMA_TOOL, { search: "invoice" }));
    expect(schema).toContain("billing.invoices");
    const detail = text(await harness.behavior.callAgentTool(SCHEMA_TOOL, { table: "subscribers" }));
    expect(detail).toContain("imsi");
    expect(detail).toContain("Indexes:");
  });

  it("serves the bb db CLI", async () => {
    const list = await harness.behavior.runCli(["connections"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("*\tlocal\t");
    const query = await harness.behavior.runCli(["query", "select count(*) as n from subscribers", "--limit", "5"]);
    expect(query.exitCode).toBe(0);
    expect(query.stdout).toContain("60");
    const refused = await harness.behavior.runCli(["query", "delete from plans"]);
    expect(refused.exitCode).not.toBe(0);
    const history = await harness.behavior.runCli(["history", "--limit", "3", "--json"]);
    expect(JSON.parse(history.stdout)).toHaveLength(3);
    const schema = await harness.behavior.runCli(["schema", "billing.invoices"]);
    expect(schema.stdout).toContain("subscriber_id");
  });

  it("records history for every surface", async () => {
    const { entries } = (await harness.behavior.callRpc("history_list", { connectionId: connection.id, query: "", limit: 100 })) as { entries: Array<{ source: string }> };
    expect(new Set(entries.map((entry) => entry.source))).toEqual(new Set(["editor", "agent", "cli"]));
  });
});
