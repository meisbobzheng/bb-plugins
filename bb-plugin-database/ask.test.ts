import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildMessage, createAsker, describeTable, parseClaudeOutput, schemaText, type CommandRunner } from "./ask";
import type { SchemaSnapshot, TableInfo } from "./contract";

function table(schema: string, name: string, columns: string[], extra: Partial<TableInfo> = {}): TableInfo {
  return {
    schema,
    name,
    kind: "table",
    estimatedRows: 10,
    comment: null,
    columns: columns.map((column, index) => ({ name: column, type: "text", nullable: index > 0, default: null, primaryKey: index === 0, comment: null })),
    indexes: [],
    foreignKeys: [],
    ...extra,
  };
}

const snapshot: SchemaSnapshot = {
  fetchedAt: "2026-10-21T00:00:00.000Z",
  serverVersion: "18.4",
  database: "bbtest",
  tables: [
    table("public", "plans", ["id", "name"]),
    table("public", "subscribers", ["id", "imsi", "status"], { comment: "One row per SIM" }),
    table("billing", "invoices", ["id", "subscriber_id"], { foreignKeys: [{ name: "fk", definition: "FOREIGN KEY (subscriber_id) REFERENCES subscribers(id)", refSchema: "public", refTable: "subscribers" }] }),
  ],
};

describe("describeTable", () => {
  it("writes one compact line per table with keys and comments", () => {
    expect(describeTable(snapshot.tables[1]!)).toBe("subscribers [table] (id text PK NOT NULL, imsi text, status text) -- ~10 rows -- One row per SIM");
    expect(describeTable(snapshot.tables[2]!)).toBe("billing.invoices [table] (id text PK NOT NULL, subscriber_id text) -- ~10 rows\n  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id)");
  });
});

describe("schemaText", () => {
  it("lists every table when it fits", () => {
    const text = schemaText(snapshot, "how many subscribers");
    expect(text.split("\n").filter((line) => !line.startsWith(" "))).toHaveLength(3);
  });

  it("keeps the most relevant tables under a budget", () => {
    const text = schemaText(snapshot, "unpaid invoices", 150);
    expect(text).toContain("billing.invoices");
    expect(text).toMatch(/\(\d more tables omitted\)/);
  });
});

describe("buildMessage", () => {
  it("includes the schema, the editor SQL, and the failed attempt", () => {
    const message = buildMessage({ database: "bbtest", prompt: "count subscribers", currentSql: "select 1", previous: { sql: "select nope", error: 'column "nope" does not exist' } }, "SCHEMA");
    expect(message).toContain("Database: bbtest");
    expect(message).toContain("SCHEMA");
    expect(message).toContain("select 1");
    expect(message).toContain('It failed with: column "nope" does not exist');
    expect(message.trim().endsWith("count subscribers")).toBe(true);
  });
});

describe("parseClaudeOutput", () => {
  it("skips warning lines and reads the result envelope", () => {
    const stdout = ['Warning: claude.ai MCP servers blocked by enterprise policy', JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "```sql\nselect 1\n```", total_cost_usd: 0.01, modelUsage: { "claude-haiku-4-5": {}, "claude-sonnet-5": {} } })].join("\n");
    expect(parseClaudeOutput(stdout)).toEqual({ result: "```sql\nselect 1\n```", costUsd: 0.01, model: "claude-sonnet-5", isError: false });
  });

  it("throws when no result envelope is present", () => {
    expect(() => parseClaudeOutput("nothing here")).toThrow(/no result/);
  });
});

describe("createAsker", () => {
  it("runs claude in print mode with the system prompt and returns the text", async () => {
    const calls: Array<{ command: string; args: readonly string[]; stdin: string }> = [];
    const run: CommandRunner = async (command, args, { stdin }) => {
      calls.push({ command, args, stdin });
      return { code: 0, stdout: JSON.stringify({ type: "result", subtype: "success", result: "```sql\nselect 2\n```", total_cost_usd: 0.002, modelUsage: { "claude-sonnet-5": {} } }), stderr: "" };
    };
    const asker = createAsker({ claudePath: () => "claude", model: () => "sonnet", timeoutMs: 1000, run });
    const completion = await asker.complete({ database: "bbtest", prompt: "two", currentSql: null, previous: null }, "SCHEMA");
    expect(completion).toMatchObject({ text: "```sql\nselect 2\n```", costUsd: 0.002, model: "claude-sonnet-5" });
    expect(calls[0]?.args).toEqual(["-p", "--output-format", "json", "--model", "sonnet", "--tools", "", "--no-session-persistence", "--system-prompt", SYSTEM_PROMPT]);
    expect(calls[0]?.stdin).toContain("Request:\ntwo");
  });

  it("surfaces claude errors", async () => {
    const run: CommandRunner = async () => ({ code: 1, stdout: "", stderr: "Not logged in" });
    const asker = createAsker({ claudePath: () => "claude", model: () => "sonnet", timeoutMs: 1000, run });
    await expect(asker.complete({ database: "x", prompt: "y", currentSql: null, previous: null }, "")).rejects.toThrow(/Not logged in/);
  });
});
