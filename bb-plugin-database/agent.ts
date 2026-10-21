import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { describeTable } from "./ask.js";
import { LIMITS, type Connection, type QueryRun, type TableInfo } from "./contract.js";
import { ServiceError, type Service } from "./service.js";
import { qualifiedName, textTable } from "./sql.js";

export const QUERY_TOOL = "db_query";
export const SCHEMA_TOOL = "db_schema";
const TOOL_ROWS = 50;
const TOOL_MAX_ROWS = 500;
const TOOL_OUTPUT_BYTES = 100_000;
const SCHEMA_TABLES = 60;

function clip(text: string, limit = TOOL_OUTPUT_BYTES): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… output truncated` : text;
}

export function describeRun(run: QueryRun): string {
  if (run.error !== null) {
    const parts = [`${run.error.kind === "sql" ? "SQL error" : run.error.kind}: ${run.error.message}`];
    if (run.error.detail !== null) parts.push(`Detail: ${run.error.detail}`);
    if (run.error.hint !== null) parts.push(`Hint: ${run.error.hint}`);
    return parts.join("\n");
  }
  if (run.results.length === 0) return `Done in ${Math.round(run.durationMs)} ms; no statements.`;
  return run.results
    .map((set) => {
      if (set.columns.length === 0) return `${set.command}: ${set.rowCount ?? 0} row${set.rowCount === 1 ? "" : "s"} affected`;
      const count = `${set.rows.length} row${set.rows.length === 1 ? "" : "s"}${set.truncated ? " (truncated; add a LIMIT or raise limit)" : ""}`;
      return `${textTable(set.columns.map((column) => column.name), set.rows)}\n(${count}, ${Math.round(run.durationMs)} ms)`;
    })
    .join("\n\n");
}

export function describeConnection(connection: Connection, active: boolean): string {
  const auth = connection.auth.kind === "rds-iam" ? `IAM via ${connection.auth.profile}` : "password";
  const user = connection.userFollowsDatabase ? "(= database)" : connection.user;
  return [active ? "*" : " ", connection.name, `${connection.host}:${connection.port}/${connection.database}`, user, auth, connection.allowWrites ? "writes on" : "read-only"].join("\t");
}

export function detailTable(table: TableInfo): string {
  const lines = [
    `${qualifiedName(table.schema, table.name)} (${table.kind}${table.estimatedRows === null ? "" : `, ~${table.estimatedRows} rows`})`,
    ...(table.comment === null ? [] : [table.comment]),
    "",
    textTable(
      ["column", "type", "nullable", "default", "key"],
      table.columns.map((column) => [column.name, column.type, column.nullable ? "yes" : "no", column.default ?? "", column.primaryKey ? "PK" : ""]),
    ),
  ];
  if (table.indexes.length > 0) lines.push("", "Indexes:", ...table.indexes.map((index) => `  ${index.definition}`));
  if (table.foreignKeys.length > 0) lines.push("", "Foreign keys:", ...table.foreignKeys.map((key) => `  ${key.name}: ${key.definition}`));
  return lines.join("\n");
}

export function matchTables(tables: readonly TableInfo[], search: string): TableInfo[] {
  const terms = search
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");
  if (terms.length === 0) return [...tables];
  return tables.filter((table) => {
    const haystack = [table.schema, table.name, ...table.columns.map((column) => column.name)].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function findTable(tables: readonly TableInfo[], ref: string): TableInfo | null {
  const [left, right] = ref.toLowerCase().split(".");
  const schema = right === undefined ? null : left;
  const name = right ?? left;
  return tables.find((table) => table.name.toLowerCase() === name && (schema === null || table.schema.toLowerCase() === schema)) ?? null;
}

function cliError(error: unknown): never {
  if (error instanceof PluginCliError) throw error;
  if (error instanceof ServiceError) throw new PluginCliError(error.message, { code: "database_error", ...(error.hint === null ? {} : { hint: error.hint }) });
  throw new PluginCliError(error instanceof Error ? error.message : String(error), { code: "database_error" });
}

export function registerAgentSurfaces(bb: BbPluginApi, service: Service): void {
  const connectionParam = z.string().max(LIMITS.name).optional().describe("Connection name or id; omit for the active connection");

  bb.agents.registerTool({
    name: QUERY_TOOL,
    description:
      "Run read-only SQL against one of the user's configured PostgreSQL connections and return the rows as a text table. Writes are refused; the user runs those from the Database page.",
    instructions: `When the user asks about data in their database, call ${SCHEMA_TOOL} first to learn the tables and columns, then ${QUERY_TOOL} with precise SQL. Select the columns the question needs rather than SELECT *, prefer aggregates when a count answers the question, and never read secret or key material into the conversation. Run \`bb db connections\` to see the configured connections.`,
    presentation: { label: { pending: "Querying database", completed: "Queried database" } },
    parameters: z.object({
      sql: z.string().min(1).max(LIMITS.sql).describe("Read-only PostgreSQL: SELECT, WITH, VALUES, TABLE, SHOW, or EXPLAIN"),
      connection: connectionParam,
      limit: z.number().int().min(1).max(TOOL_MAX_ROWS).default(TOOL_ROWS).describe(`Rows to return per result (max ${TOOL_MAX_ROWS})`),
    }),
    async execute({ sql, connection, limit }) {
      try {
        const target = await service.resolve(connection);
        const run = await service.run(target, sql, { source: "agent", forceReadOnly: true, maxRows: limit });
        const text = clip(describeRun(run));
        return run.error === null ? `${target.name} (${target.database}):\n${text}` : { content: [{ type: "text", text }], isError: true };
      } catch (error) {
        const message = error instanceof ServiceError ? [error.message, error.hint].filter((part) => part !== null).join(" ") : String(error);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  });

  bb.agents.registerTool({
    name: SCHEMA_TOOL,
    description: "List the tables and columns of one of the user's configured PostgreSQL connections, or describe one table in full with its indexes and foreign keys.",
    presentation: { label: { pending: "Reading database schema", completed: "Read database schema" } },
    parameters: z.object({
      connection: connectionParam,
      search: z.string().max(200).default("").describe("Words that must appear in the schema, table, or column names; empty lists everything"),
      table: z.string().max(200).optional().describe('One table to describe in full, e.g. "subscribers" or "billing.invoices"'),
    }),
    async execute({ connection, search, table }) {
      try {
        const target = await service.resolve(connection);
        const snapshot = await service.schema(target, false);
        const header = `${target.name}: database ${snapshot.database}, PostgreSQL ${snapshot.serverVersion}`;
        if (table !== undefined) {
          const found = findTable(snapshot.tables, table);
          return found === null ? { content: [{ type: "text", text: `No table "${table}" in ${snapshot.database}.` }], isError: true } : `${header}\n\n${detailTable(found)}`;
        }
        const matches = matchTables(snapshot.tables, search);
        if (matches.length === 0) return `${header}\nNo tables match "${search}".`;
        const shown = matches.slice(0, SCHEMA_TABLES).map(describeTable);
        const more = matches.length > SCHEMA_TABLES ? [`(${matches.length - SCHEMA_TABLES} more tables; narrow with search)`] : [];
        return clip([header, "", ...shown, ...more].join("\n"));
      } catch (error) {
        const message = error instanceof ServiceError ? [error.message, error.hint].filter((part) => part !== null).join(" ") : String(error);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  });

  const json = { json: { type: "boolean", description: "Print the result as JSON" } } as const;
  const connectionOption = { connection: { type: "string", aliases: ["c", "conn"], description: "Connection name or id; defaults to the active connection" } } as const;
  const output = (asJson: boolean, value: unknown, text: string) => ({ exitCode: 0, stdout: asJson ? `${JSON.stringify(value)}\n` : `${text}\n` });

  bb.cli.register(
    defineCli({
      name: "db",
      summary: "Query configured PostgreSQL databases read-only, inspect their schema, and turn plain-language requests into SQL",
      commands: {
        connections: cliCommand({
          summary: "List configured connections; the active one is marked with *",
          aliases: ["ls", "list"],
          options: json,
          async run({ options }) {
            const { connections, activeId } = await service.connections();
            const lines = connections.map((connection) => describeConnection(connection, connection.id === activeId));
            return output(options.json, { connections, activeId }, lines.length === 0 ? "No connections. Add one on the Database page in bb." : lines.join("\n"));
          },
        }),
        use: cliCommand({
          summary: "Make a connection the active one for agents and the CLI",
          positionals: [{ name: "connection", description: "Connection name or id", required: true }],
          options: json,
          async run({ positionals, options }) {
            try {
              const connection = await service.resolve(positionals.connection);
              await service.activate(connection.id);
              return output(options.json, connection, `Active connection: ${connection.name} (${connection.database}).`);
            } catch (error) {
              cliError(error);
            }
          },
        }),
        query: cliCommand({
          summary: "Run read-only SQL and print the rows",
          aliases: ["q", "sql"],
          positionals: [{ name: "sql", description: "SQL to run; quote it", variadic: true }],
          options: {
            ...json,
            ...connectionOption,
            limit: { type: "integer", min: 1, max: LIMITS.maxRows, default: 100, description: `Rows to print per result (max ${LIMITS.maxRows})` },
          },
          async run({ positionals, options }) {
            const sql = positionals.sql.join(" ").trim();
            if (sql === "") throw new PluginCliError("Pass the SQL to run.", { code: "invalid_value", hint: 'Example: bb db query "select count(*) from subscribers"' });
            try {
              const connection = await service.resolve(options.connection);
              const run = await service.run(connection, sql, { source: "cli", forceReadOnly: true, maxRows: options.limit });
              if (run.error !== null) {
                throw new PluginCliError([run.error.message, run.error.detail].filter((part) => part !== null).join("\n"), {
                  code: run.error.kind === "refused" ? "read_only" : "query_failed",
                  ...(run.error.hint === null ? {} : { hint: run.error.hint }),
                });
              }
              return output(options.json, run, describeRun(run));
            } catch (error) {
              cliError(error);
            }
          },
        }),
        schema: cliCommand({
          summary: "List tables and columns, or describe one table",
          aliases: ["tables", "describe"],
          positionals: [{ name: "table", description: 'Table to describe, e.g. subscribers or billing.invoices' }],
          options: { ...json, ...connectionOption, search: { type: "string", description: "Only tables whose schema, name, or columns contain these words" } },
          async run({ positionals, options }) {
            try {
              const connection = await service.resolve(options.connection);
              const snapshot = await service.schema(connection, false);
              if (positionals.table !== undefined) {
                const found = findTable(snapshot.tables, positionals.table);
                if (found === null) throw new PluginCliError(`No table "${positionals.table}" in ${snapshot.database}.`, { code: "not_found", hint: "Run `bb db schema` to list tables." });
                return output(options.json, found, detailTable(found));
              }
              const matches = matchTables(snapshot.tables, options.search ?? "");
              return output(options.json, matches, matches.length === 0 ? "No tables match." : matches.map(describeTable).join("\n"));
            } catch (error) {
              cliError(error);
            }
          },
        }),
        databases: cliCommand({
          summary: "List the databases on a connection's server",
          options: { ...json, ...connectionOption },
          async run({ options }) {
            try {
              const connection = await service.resolve(options.connection);
              const databases = await service.databases(connection);
              return output(options.json, databases, databases.join("\n"));
            } catch (error) {
              cliError(error);
            }
          },
        }),
        ask: cliCommand({
          summary: "Turn a plain-language request into SQL and, when it is read-only, run it",
          positionals: [{ name: "request", description: "What you want to know, in plain words", variadic: true }],
          options: { ...json, ...connectionOption, "dry-run": { type: "boolean", description: "Print the SQL without running it" } },
          async run({ positionals, options }) {
            const prompt = positionals.request.join(" ").trim();
            if (prompt === "") throw new PluginCliError("Describe what you want to query.", { code: "invalid_value" });
            try {
              const connection = await service.resolve(options.connection);
              const result = await service.ask(connection, prompt, null, !options["dry-run"]);
              const lines = [result.sql, ...(result.explanation === "" ? [] : ["", result.explanation])];
              if (result.run !== null) lines.push("", describeRun(result.run));
              else if (!result.readOnly) lines.push("", "This statement changes data, so it was not run. Review it on the Database page.");
              return output(options.json, result, lines.join("\n"));
            } catch (error) {
              cliError(error);
            }
          },
        }),
        history: cliCommand({
          summary: "Show recent queries",
          positionals: [{ name: "search", description: "Words to match in the SQL or request", variadic: true }],
          options: { ...json, ...connectionOption, limit: { type: "integer", min: 1, max: LIMITS.historyLimit, default: 20, description: "Entries to print" } },
          async run({ positionals, options }) {
            try {
              const connectionId = options.connection === undefined ? null : (await service.resolve(options.connection)).id;
              const entries = service.history({ connectionId, query: positionals.search.join(" "), limit: options.limit });
              const lines = entries.map((entry) =>
                [entry.startedAt.slice(0, 19).replace("T", " "), entry.connectionName, entry.source, entry.error === null ? `${entry.rowCount ?? "-"} rows` : "error", entry.sql.replace(/\s+/g, " ").slice(0, 120)].join("\t"),
              );
              return output(options.json, entries, lines.length === 0 ? "No history yet." : lines.join("\n"));
            } catch (error) {
              cliError(error);
            }
          },
        }),
        test: cliCommand({
          summary: "Check that a connection can log in",
          positionals: [{ name: "connection", description: "Connection name or id; defaults to the active connection" }],
          options: json,
          async run({ positionals, options }) {
            try {
              const connection = await service.resolve(positionals.connection);
              const result = await service.testConnection({ ...connection, password: undefined });
              if (!result.ok) throw new PluginCliError(result.error.message, { code: result.error.kind, ...(result.error.hint === null ? {} : { hint: result.error.hint }) });
              return output(options.json, result, `Connected to ${result.database} as ${result.user} on PostgreSQL ${result.serverVersion} in ${Math.round(result.latencyMs)} ms.`);
            } catch (error) {
              cliError(error);
            }
          },
        }),
      },
    }),
  );
}
