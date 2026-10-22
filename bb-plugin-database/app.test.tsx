// @vitest-environment jsdom
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { inputOf } from "./components/ConnectionDialog";
import { columnWidths } from "./components/Results";
import { resetSession } from "./components/session";
import type { Connection, HistoryEntry, QueryRun, SchemaSnapshot } from "./contract";

vi.mock("./components/Editor", () => ({
  Editor: ({ value }: { value: string }) => <textarea data-testid="sql-editor" value={value} readOnly />,
  namespaceOf: () => ({}),
}));

const CONNECTION: Connection = {
  id: "con_1a2b3c4d",
  name: "local",
  host: "127.0.0.1",
  port: 5432,
  database: "bbtest",
  user: "postgres",
  userFollowsDatabase: false,
  auth: { kind: "password" },
  ssl: false,
  allowWrites: false,
  hasPassword: true,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
};

const SNAPSHOT: SchemaSnapshot = {
  fetchedAt: "2026-10-21T00:00:00.000Z",
  serverVersion: "18.4",
  database: "bbtest",
  tables: [
    {
      schema: "public",
      name: "subscribers",
      kind: "table",
      estimatedRows: 60,
      comment: null,
      columns: [{ name: "id", type: "int8", nullable: false, default: null, primaryKey: true, comment: null }],
      indexes: [],
      foreignKeys: [],
    },
  ],
};

const RUN: QueryRun = {
  id: "qry_11111111",
  results: [{ columns: [{ name: "n", type: "int8", typeId: 20 }], rows: [["60"]], rowCount: 1, command: "SELECT", truncated: false }],
  error: null,
  durationMs: 4,
  startedAt: "2026-10-21T00:00:00.000Z",
  readOnly: true,
};

const HISTORY: HistoryEntry = {
  id: 1,
  connectionId: CONNECTION.id,
  connectionName: "local",
  database: "bbtest",
  sql: "select count(*) as n from subscribers",
  source: "ask",
  prompt: "how many subscribers",
  startedAt: "2026-10-21T00:00:00.000Z",
  durationMs: 4,
  rowCount: 1,
  error: null,
};

function settle() {
  return act(() => new Promise((resolve) => setTimeout(resolve, 30)));
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}

async function load() {
  return loadPluginApp(() => import("./app"));
}

const baseRpc = {
  connections_list: () => ({ connections: [CONNECTION], activeId: CONNECTION.id }),
  schema_get: () => SNAPSHOT,
  status: () => ({ claude: { available: true, path: "claude", model: "sonnet" }, awsProfiles: [], maxRows: 500 }),
  history_list: () => ({ entries: [HISTORY] }),
  saved_list: () => ({ queries: [] }),
};

describe("Database page", () => {
  beforeEach(() => {
    resetSession();
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  });
  afterEach(cleanup);

  it("registers one nav panel with history and saved tabs", async () => {
    const app = await load();
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({ id: "database", path: "database" });
    expect(app.navPanels[0]?.fixedTabs?.map((tab) => tab.id)).toEqual(["history", "saved"]);
  });

  it("asks for a connection when none exists", async () => {
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: { ...baseRpc, connections_list: () => ({ connections: [], activeId: null }) } });
    await settle();
    expect(await slot.findByText("Connect to a Postgres database")).toBeTruthy();
  });

  it("shows the schema and runs the editor contents", async () => {
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: { ...baseRpc, query_run: () => RUN } });
    await settle();
    expect(await slot.findByText("subscribers")).toBeTruthy();
    window.localStorage.setItem(`database:draft:${CONNECTION.id}`, "select count(*) as n from subscribers");
    cleanup();
    resetSession();
    const again = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: { ...baseRpc, query_run: () => RUN } });
    await settle();
    fireEvent.click(await again.findByRole("button", { name: /^Run/ }));
    await settle();
    expect(again.inspection.rpcCalls.find((call) => call.method === "query_run")?.input).toMatchObject({ connectionId: CONNECTION.id, sql: "select count(*) as n from subscribers" });
    expect(await again.findByText("60")).toBeTruthy();
    expect(again.getByText("1 row")).toBeTruthy();
  });

  it("hides the schema pane on request and remembers it", async () => {
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: baseRpc });
    await settle();
    expect((await slot.findByText("subscribers")).closest("aside")?.className).not.toMatch(/\bhidden\b/);
    fireEvent.click(slot.getByRole("button", { name: "Hide schema" }));
    expect(slot.getByText("subscribers").closest("aside")?.className).toMatch(/\bhidden\b/);
    expect(window.localStorage.getItem("database:schema-open")).toBe("0");
    cleanup();
    resetSession();
    const again = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: baseRpc });
    await settle();
    expect(await again.findByRole("button", { name: "Show schema" })).toBeTruthy();
  });

  it("starts with the schema pane hidden when the page is narrow", async () => {
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 480 } as DOMRect);
    try {
      const app = await load();
      const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: baseRpc });
      await settle();
      fireEvent.click(await slot.findByRole("button", { name: "Show schema" }));
      expect(slot.getByText("subscribers").closest("aside")?.className).not.toMatch(/\bhidden\b/);
    } finally {
      measure.mockRestore();
    }
  });

  it("explains a schema that failed to load and retries it", async () => {
    const app = await load();
    let attempts = 0;
    const schema_get = () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Connection terminated due to connection timeout");
      return SNAPSHOT;
    };
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: { ...baseRpc, schema_get } });
    await settle();
    expect((await slot.findByRole("alert")).textContent).toMatch(/Could not load the schema.*connection timeout/);
    fireEvent.click(slot.getByRole("button", { name: /Try again/ }));
    await settle();
    expect(await slot.findByText("subscribers")).toBeTruthy();
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "schema_get").at(-1)?.input).toMatchObject({ refresh: true });
  });

  it("clears the schema filter with Escape", async () => {
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: baseRpc });
    await settle();
    const filter = await slot.findByRole("textbox", { name: "Filter tables" });
    fireEvent.change(filter, { target: { value: "nothing-matches" } });
    expect(slot.getByText("No tables match.")).toBeTruthy();
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(slot.getByText("subscribers")).toBeTruthy();
  });

  it("lists history in its fixed tab", async () => {
    const app = await load();
    const tab = app.navPanels[0]!.fixedTabs!.find((candidate) => candidate.id === "history")!;
    const slot = renderSlot(tab, { subPath: "" }, { rpc: baseRpc });
    await settle();
    expect((await slot.findByText(/how many subscribers/)).closest("[data-vim-item]")).not.toBeNull();
    expect(slot.getByText("Ask")).toBeTruthy();
  });

  it("lets Vim walk the schema tree and move to the results pane", async () => {
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: baseRpc });
    await settle();
    expect((await slot.findByText("subscribers")).closest("[data-vim-item]")).not.toBeNull();
    expect(slot.getByText(/Run a query with/).closest("[data-vim-pane]")).not.toBeNull();
  });
});

describe("results grid", () => {
  const WIDE: QueryRun = {
    ...RUN,
    results: [
      {
        columns: [
          { name: "id", type: "int8", typeId: 20 },
          { name: "active", type: "bool", typeId: 16 },
        ],
        rows: Array.from({ length: 1000 }, (_, index) => [String(index + 1), index % 2 === 0 ? "t" : "f"]),
        rowCount: 1000,
        command: "SELECT",
        truncated: false,
      },
    ],
  };

  beforeEach(() => {
    resetSession();
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
    window.localStorage.setItem(`database:draft:${CONNECTION.id}`, "select id, active from subscribers");
  });
  afterEach(cleanup);

  async function run(rpc: Record<string, (input: unknown) => unknown>) {
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: { ...baseRpc, ...rpc } });
    await settle();
    fireEvent.click(await slot.findByRole("button", { name: /^Run/ }));
    await settle();
    return slot;
  }

  it("sizes columns from their longest value up to a cap", () => {
    const set = { ...RUN.results[0]!, columns: [...RUN.results[0]!.columns, { name: "note", type: "text", typeId: 25 }, { name: "ok", type: "bool", typeId: 16 }], rows: [["7", null, "f"], ["8", "x".repeat(500), "t"]] };
    expect(columnWidths(set)).toEqual([6, 60, 7]);
  });

  it("renders only the rows near the viewport", async () => {
    const slot = await run({ query_run: () => WIDE });
    const grid = slot.getByRole("region", { name: "Query results" });
    expect(grid.querySelectorAll("tr[data-row]").length).toBeLessThan(200);
    expect(grid.querySelector('tr[data-row="999"]')).toBeNull();
    Object.defineProperty(grid, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(grid, "scrollTop", { value: 21 * 980, configurable: true });
    fireEvent.scroll(grid);
    expect(grid.querySelector('tr[data-row="999"]')).not.toBeNull();
    expect(grid.querySelector('tr[data-row="0"]')).toBeNull();
  });

  it("moves through cells with the arrow keys and copies one with ⌘C", async () => {
    const slot = await run({ query_run: () => WIDE });
    const grid = slot.getByRole("region", { name: "Query results" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(grid.querySelector('tr[data-row="1"] > td[data-column="1"]')?.className).toMatch(/bg-state-active/);
    fireEvent.keyDown(grid, { key: "c", metaKey: true });
    await settle();
    expect(slot.inspection.experimental_clipboardWrites.at(-1)).toMatchObject({ text: "f" });
  });

  it("keeps the last results on screen while the next query runs", async () => {
    let calls = 0;
    const slot = await run({ query_run: () => (++calls === 1 ? RUN : new Promise(() => undefined)) });
    expect(slot.getByText("60")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: /^Run/ }));
    await settle();
    expect(slot.getByRole("status").textContent).toMatch(/Running/);
    expect(slot.getByText("60")).toBeTruthy();
  });

  it("retries a query that could not reach the server", async () => {
    const offline: QueryRun = {
      ...RUN,
      results: [],
      error: { kind: "connection", message: "Connection terminated due to connection timeout", code: null, position: null, detail: null, hint: "Check that 127.0.0.1:5432 is reachable from the bb server." },
    };
    let calls = 0;
    const slot = await run({ query_run: () => (++calls === 1 ? offline : RUN) });
    expect(slot.getByRole("alert").textContent).toMatch(/Could not connect.*is reachable/);
    fireEvent.click(slot.getByRole("button", { name: /Try again/ }));
    await settle();
    expect(slot.getByText("60")).toBeTruthy();
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "query_run").map((call) => (call.input as { sql: string }).sql)).toEqual(["select id, active from subscribers", "select id, active from subscribers"]);
  });
});

describe("connection form", () => {
  const form = { name: "x", host: "h", port: "5432", database: "db", user: "", userFollowsDatabase: true, authKind: "rds-iam" as const, profile: "nucleus-dev", region: "us-east-1", password: "", ssl: true };

  it("derives the role from the database when it follows it", () => {
    expect(inputOf(form, undefined)).toMatchObject({ user: "db", auth: { kind: "rds-iam", profile: "nucleus-dev", region: "us-east-1" } });
  });

  it("explains missing fields", () => {
    expect(inputOf({ ...form, port: "x" }, undefined)).toMatch(/Port/);
    expect(inputOf({ ...form, userFollowsDatabase: false }, undefined)).toMatch(/role/);
    expect(inputOf({ ...form, profile: "" }, undefined)).toMatch(/profile/);
  });

  it("sends the password only when typed", () => {
    expect(inputOf({ ...form, authKind: "password", password: "" }, "con_1a2b3c4d")).not.toHaveProperty("password");
    expect(inputOf({ ...form, authKind: "password", password: "pw" }, "con_1a2b3c4d")).toMatchObject({ id: "con_1a2b3c4d", password: "pw" });
  });
});
