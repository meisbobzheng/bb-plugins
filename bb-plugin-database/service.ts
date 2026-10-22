import { authError, createTokenCache, isCredentialError, listAwsProfiles } from "./auth.js";
import { createAsker, extractSql, schemaText, type Asker } from "./ask.js";
import type { ChangedKind } from "./channel.js";
import type {
  AskResult,
  AwsProfile,
  Connection,
  ConnectionInput,
  ExplainResult,
  HistoryEntry,
  HistorySource,
  QueryRun,
  SavedQuery,
  SchemaSnapshot,
  Status,
  TestResult,
} from "./contract.js";
import { Engine } from "./engine.js";
import { isReadOnlyScript, touchesSchema } from "./sql.js";
import type { Store } from "./store.js";

export interface Settings {
  maxRows: number;
  statementTimeoutSeconds: number;
  askModel: string;
  claudePath: string;
}

export interface ServiceDeps {
  store: Store;
  settings(): Promise<Settings>;
  publish(kind: ChangedKind): void;
  log(message: string): void;
  now?(): Date;
  asker?: Asker;
  profiles?(): Promise<AwsProfile[]>;
  commandExists?(command: string): Promise<boolean>;
}

export interface RunRequest {
  source: HistorySource;
  prompt?: string | null;
  maxRows?: number;
  forceReadOnly?: boolean;
  queryId?: string;
}

const PROFILE_TTL_MS = 60_000;
const ASK_ATTEMPTS = 2;
const ASK_TIMEOUT_MS = 120_000;
const TEST_ID = "con_testtest";

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function refused(message: string, hint: string | null = null): QueryRun["error"] {
  return { kind: "refused", message, code: null, position: null, detail: null, hint };
}

export function createService(deps: ServiceDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const transientPasswords = new Map<string, string>();
  let profileCache: { at: number; profiles: Promise<AwsProfile[]> } | null = null;

  const profiles = (): Promise<AwsProfile[]> => {
    if (deps.profiles !== undefined) return deps.profiles();
    if (profileCache === null || Date.now() - profileCache.at > PROFILE_TTL_MS) profileCache = { at: Date.now(), profiles: listAwsProfiles() };
    return profileCache.profiles;
  };

  const rdsToken = createTokenCache();
  const engine = new Engine({
    async password(connection) {
      if (connection.auth.kind === "rds-iam") {
        return rdsToken({ host: connection.host, port: connection.port, region: connection.auth.region, user: connection.userFollowsDatabase ? connection.database : connection.user, profile: connection.auth.profile });
      }
      const password = transientPasswords.get(connection.id) ?? store.password(connection.id);
      if (password === null) throw new ServiceError("No password is saved for this connection.", "Edit the connection and enter its password.");
      return password;
    },
    async authError(error, connection) {
      if (connection.auth.kind !== "rds-iam" || !isCredentialError(error)) return null;
      return authError(error, connection.auth.profile, await profiles());
    },
    log: deps.log,
  });

  const asker =
    deps.asker ??
    createAsker({
      claudePath: () => settingsCache.claudePath,
      model: () => settingsCache.askModel,
      timeoutMs: ASK_TIMEOUT_MS,
    });

  let settingsCache: Settings = { maxRows: 500, statementTimeoutSeconds: 60, askModel: "sonnet", claudePath: "claude" };
  const settings = async () => {
    settingsCache = await deps.settings();
    return settingsCache;
  };
  const timeoutMs = async () => (await settings()).statementTimeoutSeconds * 1000;

  async function resolve(ref: string | null | undefined): Promise<Connection> {
    if (ref !== null && ref !== undefined && ref.trim() !== "") {
      const found = store.findConnection(ref);
      if (found === null) throw new ServiceError(`No connection named "${ref}".`, "Run `bb db connections` to list connections.");
      return found;
    }
    const activeId = await store.activeId();
    const active = activeId === null ? null : store.getConnection(activeId);
    if (active !== null) return active;
    const first = store.listConnections()[0];
    if (first === undefined) throw new ServiceError("No database connections are configured.", "Open Database in the bb sidebar and add a connection.");
    return first;
  }

  async function run(connection: Connection, sql: string, request: RunRequest): Promise<QueryRun> {
    const current = await settings();
    const readOnly = request.forceReadOnly === true || !connection.allowWrites;
    const startedAt = now().toISOString();
    if (request.forceReadOnly === true && !isReadOnlyScript(sql)) {
      return {
        id: "refused",
        results: [],
        error: refused("Only read-only SQL (SELECT, WITH, VALUES, TABLE, SHOW, EXPLAIN) runs here.", "Run data-changing statements from the Database page with writes enabled."),
        durationMs: 0,
        startedAt,
        readOnly: true,
      };
    }
    const result = await engine.run(connection, sql, {
      maxRows: Math.min(request.maxRows ?? current.maxRows, current.maxRows),
      readOnly,
      timeoutMs: current.statementTimeoutSeconds * 1000,
      id: request.queryId,
    });
    store.recordHistory({
      connectionId: connection.id,
      connectionName: connection.name,
      database: connection.database,
      sql,
      source: request.source,
      prompt: request.prompt ?? null,
      startedAt: result.startedAt,
      durationMs: result.durationMs,
      rowCount: result.results.reduce<number | null>((total, set) => (set.rowCount === null ? total : (total ?? 0) + set.rowCount), null),
      error: result.error?.message ?? null,
    });
    deps.publish("history");
    if (result.error === null && touchesSchema(sql)) engine.invalidateSchema(connection.id);
    return result;
  }

  return {
    engine,
    resolve,
    run,
    async connections() {
      return { connections: store.listConnections(), activeId: await store.activeId() };
    },
    saveConnection(input: ConnectionInput): Connection {
      const connection = store.saveConnection(input, now().toISOString());
      engine.forget(connection.id);
      deps.publish("connections");
      return connection;
    },
    async deleteConnection(id: string): Promise<boolean> {
      const removed = store.deleteConnection(id);
      engine.forget(id);
      if ((await store.activeId()) === id) await store.setActiveId(null);
      if (removed) deps.publish("connections");
      return removed;
    },
    async testConnection(input: ConnectionInput): Promise<TestResult> {
      const stamp = now().toISOString();
      const connection: Connection = { ...input, id: TEST_ID, allowWrites: false, hasPassword: false, createdAt: stamp, updatedAt: stamp };
      const password = input.password ?? (input.id === undefined ? null : store.password(input.id));
      if (password !== null) transientPasswords.set(TEST_ID, password);
      try {
        return await engine.test(connection, await timeoutMs());
      } finally {
        transientPasswords.delete(TEST_ID);
        engine.forget(TEST_ID);
      }
    },
    async activate(id: string): Promise<string | null> {
      if (store.getConnection(id) === null) throw new ServiceError(`No connection ${id}.`);
      await store.setActiveId(id);
      deps.publish("connections");
      return id;
    },
    setWrites(id: string, allowWrites: boolean): Connection {
      const connection = store.setWrites(id, allowWrites, now().toISOString());
      if (connection === null) throw new ServiceError(`No connection ${id}.`);
      deps.publish("connections");
      return connection;
    },
    setDatabase(id: string, database: string): Connection {
      const connection = store.setDatabase(id, database, now().toISOString());
      if (connection === null) throw new ServiceError(`No connection ${id}.`);
      engine.forget(id);
      deps.publish("connections");
      return connection;
    },
    async databases(connection: Connection): Promise<string[]> {
      return engine.databases(connection, await timeoutMs());
    },
    async schema(connection: Connection, refresh: boolean): Promise<SchemaSnapshot> {
      return engine.schema(connection, refresh, await timeoutMs());
    },
    async explain(connection: Connection, sql: string, analyze: boolean): Promise<ExplainResult> {
      return engine.explain(connection, sql, analyze, { readOnly: !connection.allowWrites, timeoutMs: await timeoutMs() });
    },
    cancel: (queryId: string) => engine.cancel(queryId),
    async ask(connection: Connection, prompt: string, currentSql: string | null, execute: boolean): Promise<AskResult> {
      await settings();
      const snapshot = await engine.schema(connection, false, await timeoutMs());
      const schema = schemaText(snapshot, prompt);
      let previous: { sql: string; error: string } | null = null;
      let costUsd: number | null = null;
      let model = settingsCache.askModel;
      for (let attempt = 1; ; attempt += 1) {
        const completion = await asker.complete({ database: connection.database, prompt, currentSql, previous }, schema);
        costUsd = completion.costUsd === null ? costUsd : (costUsd ?? 0) + completion.costUsd;
        model = completion.model;
        const { sql, explanation } = extractSql(completion.text);
        if (sql === "") throw new ServiceError(explanation === "" ? "claude returned no SQL." : explanation);
        const readOnly = isReadOnlyScript(sql);
        if (!execute || !readOnly) return { sql, explanation, readOnly, run: null, attempts: attempt, costUsd, model };
        const result = await run(connection, sql, { source: "ask", prompt });
        if (result.error !== null && result.error.kind === "sql" && attempt < ASK_ATTEMPTS) {
          previous = { sql, error: result.error.message };
          continue;
        }
        return { sql, explanation, readOnly, run: result, attempts: attempt, costUsd, model };
      }
    },
    history: (filter: { connectionId: string | null; query: string; limit: number }): HistoryEntry[] => store.listHistory(filter),
    clearHistory(connectionId: string | null): number {
      const removed = store.clearHistory(connectionId);
      if (removed > 0) deps.publish("history");
      return removed;
    },
    listSaved: (connectionId: string | null): SavedQuery[] => store.listSaved(connectionId),
    saveQuery(input: { id?: string; connectionId: string | null; name: string; sql: string }): SavedQuery {
      const saved = store.saveQuery(input, now().toISOString());
      deps.publish("saved");
      return saved;
    },
    deleteSaved(id: string): boolean {
      const removed = store.deleteSaved(id);
      if (removed) deps.publish("saved");
      return removed;
    },
    async status(): Promise<Status> {
      const current = await settings();
      const available = deps.commandExists === undefined ? true : await deps.commandExists(current.claudePath);
      return { claude: { available, path: current.claudePath, model: current.askModel }, awsProfiles: await profiles(), maxRows: current.maxRows };
    },
    dispose: () => engine.dispose(),
  };
}

export type Service = ReturnType<typeof createService>;
