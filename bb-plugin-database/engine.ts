import pg from "pg";
import type { Connection, ExplainResult, QueryError, QueryRun, ResultSet, SchemaSnapshot, TestResult } from "./contract.js";
import { COLUMNS_SQL, DATABASES_SQL, FOREIGN_KEYS_SQL, INDEXES_SQL, TABLES_SQL, VERSION_SQL, shapeSnapshot, type Row } from "./introspect.js";
import { newId } from "./store.js";
import { cursorable, splitStatements } from "./sql.js";

const { Pool } = pg;
type Pool = pg.Pool;
type PoolClient = pg.PoolClient;

const TEXT_TYPES: pg.CustomTypesConfig = { getTypeParser: () => (value: string) => value };
const SCHEMA_TTL_MS = 5 * 60_000;
const QUERY_CANCELED = "57014";
const CURSOR = "bb_database_cursor";

export interface RunOptions {
  maxRows: number;
  readOnly: boolean;
  timeoutMs: number;
  id?: string;
}

export interface EngineDeps {
  password(connection: Connection): Promise<string>;
  authError(error: unknown, connection: Connection): Promise<QueryError | null>;
  log(message: string): void;
  now?(): number;
}

interface PoolEntry {
  pool: Pool;
  fingerprint: string;
  typeNames: Promise<Map<number, string>> | null;
}

interface Running {
  client: PoolClient | null;
  pool: Pool | null;
  cancelled: boolean;
}

class CancelledBeforeStart extends Error {
  readonly code = QUERY_CANCELED;
  readonly severity = "ERROR";
  constructor() {
    super("canceling statement due to user request");
  }
}

interface CachedSchema {
  fingerprint: string;
  fetchedAt: number;
  snapshot: SchemaSnapshot;
}

export function effectiveUser(connection: Connection): string {
  return connection.userFollowsDatabase ? connection.database : connection.user;
}

function fingerprintOf(connection: Connection): string {
  return JSON.stringify([connection.host, connection.port, connection.database, effectiveUser(connection), connection.ssl, connection.auth]);
}

function isDatabaseError(error: unknown): error is pg.DatabaseError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string" && "severity" in error;
}

export function describeError(error: unknown, cancelled = false): QueryError {
  if (isDatabaseError(error)) {
    const timeout = error.code === QUERY_CANCELED && /statement timeout/i.test(error.message);
    return {
      kind: error.code === QUERY_CANCELED ? (cancelled || !timeout ? "cancelled" : "timeout") : error.code === "28000" || error.code === "28P01" ? "auth" : "sql",
      message: error.message,
      code: error.code ?? null,
      position: error.position === undefined ? null : Number(error.position),
      detail: error.detail ?? null,
      hint: error.hint ?? null,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error ? ((error as { code?: unknown }).code as string | undefined) : undefined;
  const connectionProblem = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|timeout|terminated|closed/i.test(`${code ?? ""} ${message}`);
  return { kind: connectionProblem ? "connection" : "sql", message, code: code ?? null, position: null, detail: null, hint: null };
}

function shapeResult(result: pg.QueryArrayResult<Array<string | null>>, typeNames: Map<number, string>, maxRows: number, command?: string): ResultSet {
  const rows = result.rows.slice(0, maxRows);
  return {
    columns: result.fields.map((field) => ({ name: field.name, type: typeNames.get(field.dataTypeID) ?? String(field.dataTypeID), typeId: field.dataTypeID })),
    rows,
    rowCount: result.rowCount,
    command: command ?? result.command,
    truncated: result.rows.length > maxRows,
  };
}

export class Engine {
  private readonly pools = new Map<string, PoolEntry>();
  private readonly running = new Map<string, Running>();
  private readonly schemas = new Map<string, CachedSchema>();
  private readonly now: () => number;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now;
  }

  private entry(connection: Connection): PoolEntry {
    const fingerprint = fingerprintOf(connection);
    const existing = this.pools.get(connection.id);
    if (existing !== undefined && existing.fingerprint === fingerprint) return existing;
    if (existing !== undefined) void existing.pool.end().catch(() => undefined);
    const pool = new Pool({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: effectiveUser(connection),
      password: () => this.deps.password(connection),
      ssl: connection.ssl ? { rejectUnauthorized: false } : false,
      max: 4,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 15_000,
      allowExitOnIdle: true,
      application_name: "bb-database",
      types: TEXT_TYPES,
    });
    pool.on("error", (error) => this.deps.log(`idle client error on ${connection.name}: ${error.message}`));
    const created = { pool, fingerprint, typeNames: null };
    this.pools.set(connection.id, created);
    return created;
  }

  private typeNames(entry: PoolEntry, client: PoolClient): Promise<Map<number, string>> {
    if (entry.typeNames === null) {
      entry.typeNames = client
        .query<{ oid: string; typname: string }>("SELECT oid, typname FROM pg_type")
        .then((result) => new Map(result.rows.map((row) => [Number(row.oid), row.typname])))
        .catch((error: unknown) => {
          entry.typeNames = null;
          throw error;
        });
    }
    return entry.typeNames;
  }

  private async failure(error: unknown, connection: Connection, cancelled: boolean): Promise<QueryError> {
    return (await this.deps.authError(error, connection)) ?? describeError(error, cancelled);
  }

  private async withClient<T>(connection: Connection, options: Pick<RunOptions, "readOnly" | "timeoutMs">, work: (client: PoolClient, entry: PoolEntry) => Promise<T>): Promise<T> {
    const entry = this.entry(connection);
    const client = await entry.pool.connect();
    let failure: unknown = null;
    try {
      await client.query(`SET default_transaction_read_only = ${options.readOnly ? "on" : "off"}`);
      await client.query(`SET statement_timeout = ${Math.max(0, Math.round(options.timeoutMs))}`);
      return await work(client, entry);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      const broken = failure !== null && !isDatabaseError(failure);
      if (!broken) await client.query("ROLLBACK").catch(() => undefined);
      client.release(broken ? (failure instanceof Error ? failure : new Error(String(failure))) : undefined);
    }
  }

  async run(connection: Connection, sql: string, options: RunOptions): Promise<QueryRun> {
    const id = options.id ?? newId("qry");
    const startedAt = new Date(this.now()).toISOString();
    const started = this.now();
    const finish = (results: ResultSet[], error: QueryError | null): QueryRun => ({
      id,
      results,
      error,
      durationMs: this.now() - started,
      startedAt,
      readOnly: options.readOnly,
    });
    const running: Running = { client: null, pool: null, cancelled: false };
    this.running.set(id, running);
    try {
      return await this.withClient(connection, options, async (client, entry) => {
        if (running.cancelled) throw new CancelledBeforeStart();
        running.client = client;
        running.pool = entry.pool;
        const typeNames = await this.typeNames(entry, client);
        const statements = splitStatements(sql);
        if (statements.length === 0) return finish([], null);
        const single = statements.length === 1 ? statements[0]! : null;
        if (single !== null && cursorable(single)) {
          await client.query("BEGIN");
          try {
            const prefix = `DECLARE ${CURSOR} NO SCROLL CURSOR FOR `;
            await client.query(prefix + single.text).catch((error: unknown) => {
              if (isDatabaseError(error) && error.position !== undefined) {
                const position = Number(error.position) - prefix.length;
                error.position = position > 0 ? String(position) : undefined;
              }
              throw error;
            });
            const fetched = await client.query<Array<string | null>>({ text: `FETCH ${options.maxRows + 1} FROM ${CURSOR}`, rowMode: "array", types: TEXT_TYPES });
            await client.query("COMMIT");
            return finish([shapeResult({ ...fetched, rowCount: Math.min(fetched.rows.length, options.maxRows) }, typeNames, options.maxRows, "SELECT")], null);
          } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw error;
          }
        }
        const result = await client.query<Array<string | null>>({ text: sql, rowMode: "array", types: TEXT_TYPES });
        const list = Array.isArray(result) ? result : [result];
        return finish(
          list.map((item) => shapeResult(item, typeNames, options.maxRows)),
          null,
        );
      });
    } catch (error) {
      return finish([], await this.failure(error, connection, running.cancelled));
    } finally {
      this.running.delete(id);
    }
  }

  async cancel(queryId: string): Promise<boolean> {
    const running = this.running.get(queryId);
    if (running === undefined) return false;
    running.cancelled = true;
    if (running.client === null || running.pool === null) return true;
    const pid = (running.client as unknown as { processID?: number | null }).processID;
    if (pid === null || pid === undefined) return true;
    await running.pool.query("SELECT pg_cancel_backend($1)", [pid]).catch((error: unknown) => this.deps.log(`cancel failed: ${String(error)}`));
    return true;
  }

  async explain(connection: Connection, sql: string, analyze: boolean, options: Pick<RunOptions, "readOnly" | "timeoutMs">): Promise<ExplainResult> {
    const started = this.now();
    const statements = splitStatements(sql);
    if (statements.length !== 1) {
      return {
        plan: null,
        error: { kind: "refused", message: "Explain one statement at a time.", code: null, position: null, detail: null, hint: null },
        durationMs: 0,
      };
    }
    try {
      return await this.withClient(connection, options, async (client) => {
        await client.query("BEGIN");
        try {
          const flags = analyze ? "ANALYZE true, BUFFERS true" : "ANALYZE false";
          const result = await client.query<[string]>({ text: `EXPLAIN (${flags}, FORMAT JSON) ${statements[0]!.text}`, rowMode: "array", types: TEXT_TYPES });
          const plan = JSON.parse(result.rows[0]?.[0] ?? "[]") as ExplainResult["plan"];
          return { plan, error: null, durationMs: this.now() - started };
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
        }
      });
    } catch (error) {
      return { plan: null, error: await this.failure(error, connection, false), durationMs: this.now() - started };
    }
  }

  async databases(connection: Connection, timeoutMs: number): Promise<string[]> {
    return this.withClient(connection, { readOnly: true, timeoutMs }, async (client) => {
      const result = await client.query<{ datname: string }>(DATABASES_SQL);
      return result.rows.map((row) => row.datname);
    });
  }

  async schema(connection: Connection, refresh: boolean, timeoutMs: number): Promise<SchemaSnapshot> {
    const fingerprint = fingerprintOf(connection);
    const cached = this.schemas.get(connection.id);
    if (!refresh && cached !== undefined && cached.fingerprint === fingerprint && this.now() - cached.fetchedAt < SCHEMA_TTL_MS) return cached.snapshot;
    const snapshot = await this.withClient(connection, { readOnly: true, timeoutMs }, async (client) => {
      const rows = async (text: string) => (await client.query<Row>(text)).rows;
      const version = await rows(VERSION_SQL);
      const tables = await rows(TABLES_SQL);
      const columns = await rows(COLUMNS_SQL);
      const indexes = await rows(INDEXES_SQL);
      const foreignKeys = await rows(FOREIGN_KEYS_SQL);
      return shapeSnapshot({ version, tables, columns, indexes, foreignKeys }, new Date(this.now()).toISOString());
    });
    this.schemas.set(connection.id, { fingerprint, fetchedAt: this.now(), snapshot });
    return snapshot;
  }

  invalidateSchema(connectionId: string): void {
    this.schemas.delete(connectionId);
  }

  async test(connection: Connection, timeoutMs: number): Promise<TestResult> {
    const started = this.now();
    try {
      return await this.withClient(connection, { readOnly: true, timeoutMs }, async (client) => {
        const result = await client.query<{ version: string; database: string; user: string }>(`${VERSION_SQL}, current_user AS "user"`);
        const row = result.rows[0]!;
        return { ok: true, serverVersion: row.version, user: row.user, database: row.database, latencyMs: this.now() - started };
      });
    } catch (error) {
      return { ok: false, error: await this.failure(error, connection, false) };
    }
  }

  forget(connectionId: string): void {
    const entry = this.pools.get(connectionId);
    if (entry !== undefined) void entry.pool.end().catch(() => undefined);
    this.pools.delete(connectionId);
    this.schemas.delete(connectionId);
  }

  async dispose(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    this.schemas.clear();
    await Promise.all(pools.map((entry) => entry.pool.end().catch(() => undefined)));
  }
}
