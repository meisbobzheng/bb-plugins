import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { SchemaSnapshot, TableInfo } from "./contract.js";
import { extractSql, qualifiedName } from "./sql.js";

const SCHEMA_BUDGET = 60_000;

export interface AskRequest {
  database: string;
  prompt: string;
  currentSql: string | null;
  previous: { sql: string; error: string } | null;
}

export interface Completion {
  text: string;
  costUsd: number | null;
  model: string;
  durationMs: number;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: readonly string[], options: { stdin: string; cwd: string; timeoutMs: number }) => Promise<CommandResult>;

export const SYSTEM_PROMPT = [
  "You translate requests written in plain language into PostgreSQL queries.",
  "Reply with exactly one SQL statement inside a ```sql fenced block, then one short sentence explaining what it returns.",
  "Use only the schemas, tables, and columns listed in the message. Qualify tables outside the public schema with their schema name.",
  "Prefer explicit column lists over SELECT *. Add LIMIT 100 to exploratory queries unless the request asks for every row or for an aggregate.",
  "Write data-changing statements only when the request clearly asks to insert, update, or delete.",
  "When the previous attempt failed, fix the statement so it runs; do not repeat the same mistake.",
].join(" ");

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((word) => word.length > 2);
}

function relevance(table: TableInfo, terms: readonly string[]): number {
  const names = [table.name, ...table.columns.map((column) => column.name)].map((name) => name.toLowerCase());
  return terms.reduce((score, term) => score + (names.some((name) => name.includes(term) || term.includes(name)) ? 1 : 0), 0);
}

export function describeTable(table: TableInfo): string {
  const columns = table.columns.map((column) => {
    const flags = [column.primaryKey ? "PK" : null, column.nullable ? null : "NOT NULL"].filter((flag) => flag !== null).join(" ");
    return `${column.name} ${column.type}${flags === "" ? "" : ` ${flags}`}`;
  });
  const rows = table.estimatedRows === null ? "" : ` -- ~${table.estimatedRows} rows`;
  const comment = table.comment === null ? "" : ` -- ${table.comment}`;
  const keys = table.foreignKeys.map((key) => `  ${key.definition}`);
  return [`${qualifiedName(table.schema, table.name)} [${table.kind}] (${columns.join(", ")})${rows}${comment}`, ...keys].join("\n");
}

export function schemaText(snapshot: SchemaSnapshot, prompt: string, budget = SCHEMA_BUDGET): string {
  const terms = words(prompt);
  const ranked = snapshot.tables
    .map((table, index) => ({ table, index, score: relevance(table, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const lines: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const { table } of ranked) {
    const text = describeTable(table);
    if (used + text.length > budget) {
      omitted += 1;
      continue;
    }
    lines.push(text);
    used += text.length + 1;
  }
  lines.sort();
  if (omitted > 0) lines.push(`(${omitted} more tables omitted)`);
  return lines.join("\n");
}

export function buildMessage(request: AskRequest, schema: string): string {
  const parts = [`Database: ${request.database}`, "", "Schema:", schema, ""];
  if (request.currentSql !== null && request.currentSql.trim() !== "") parts.push("SQL currently in the editor, for context:", "```sql", request.currentSql.trim(), "```", "");
  if (request.previous !== null) parts.push("Previous attempt:", "```sql", request.previous.sql, "```", `It failed with: ${request.previous.error}`, "");
  parts.push("Request:", request.prompt);
  return parts.join("\n");
}

export const spawnRunner: CommandRunner = (command, args, { stdin, cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude did not answer within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });

export function parseClaudeOutput(stdout: string): { result: string; costUsd: number | null; model: string | null; isError: boolean } {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.type !== "result") continue;
      const usage = parsed.modelUsage;
      const model = usage !== null && typeof usage === "object" ? (Object.keys(usage).find((name) => !name.includes("haiku")) ?? Object.keys(usage)[0] ?? null) : null;
      return {
        result: typeof parsed.result === "string" ? parsed.result : "",
        costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null,
        model,
        isError: parsed.is_error === true || parsed.subtype !== "success",
      };
    } catch {
      continue;
    }
  }
  throw new Error(`claude returned no result: ${stdout.trim().slice(0, 500) || "(empty output)"}`);
}

export interface Asker {
  complete(request: AskRequest, schema: string): Promise<Completion>;
}

export function createAsker(options: { claudePath: () => string; model: () => string; timeoutMs: number; run?: CommandRunner }): Asker {
  const run = options.run ?? spawnRunner;
  return {
    async complete(request, schema) {
      const started = Date.now();
      const model = options.model();
      const args = ["-p", "--output-format", "json", "--model", model, "--tools", "", "--no-session-persistence", "--system-prompt", SYSTEM_PROMPT];
      const result = await run(options.claudePath(), args, { stdin: buildMessage(request, schema), cwd: tmpdir(), timeoutMs: options.timeoutMs });
      if (result.code !== 0 && result.stdout.trim() === "") {
        throw new Error(`claude exited with ${result.code ?? "a signal"}: ${result.stderr.trim().slice(0, 500) || "no output"}`);
      }
      const parsed = parseClaudeOutput(result.stdout);
      if (parsed.isError) throw new Error(`claude could not answer: ${parsed.result.slice(0, 500) || result.stderr.trim().slice(0, 500)}`);
      return { text: parsed.result, costUsd: parsed.costUsd, model: parsed.model ?? model, durationMs: Date.now() - started };
    },
  };
}

export { extractSql };
