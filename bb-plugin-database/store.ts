import { randomBytes } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Database } from "better-sqlite3";
import { authSchema, type Connection, type ConnectionInput, type HistoryEntry, type HistorySource, type SavedQuery } from "./contract.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const HISTORY_CAP = 2_000;
const ACTIVE_KEY = "active-connection";

export function newId(prefix: string): string {
  return `${prefix}_${Array.from(randomBytes(8), (byte) => ALPHABET[byte % ALPHABET.length]).join("")}`;
}

interface ConnectionRow {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  user_follows_database: number;
  auth: string;
  ssl: number;
  allow_writes: number;
  password: string | null;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: number;
  connection_id: string | null;
  connection_name: string;
  database: string;
  sql: string;
  source: HistorySource;
  prompt: string | null;
  started_at: string;
  duration_ms: number;
  row_count: number | null;
  error: string | null;
}

interface SavedRow {
  id: string;
  connection_id: string | null;
  name: string;
  sql: string;
  created_at: string;
  updated_at: string;
}

export interface HistoryInput {
  connectionId: string;
  connectionName: string;
  database: string;
  sql: string;
  source: HistorySource;
  prompt: string | null;
  startedAt: string;
  durationMs: number;
  rowCount: number | null;
  error: string | null;
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    database: row.database,
    user: row.user,
    userFollowsDatabase: row.user_follows_database === 1,
    auth: authSchema.parse(JSON.parse(row.auth)),
    ssl: row.ssl === 1,
    allowWrites: row.allow_writes === 1,
    hasPassword: row.password !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHistory(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    database: row.database,
    sql: row.sql,
    source: row.source,
    prompt: row.prompt,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    rowCount: row.row_count,
    error: row.error,
  };
}

function toSaved(row: SavedRow): SavedQuery {
  return { id: row.id, connectionId: row.connection_id, name: row.name, sql: row.sql, createdAt: row.created_at, updatedAt: row.updated_at };
}

export interface Store {
  listConnections(): Connection[];
  getConnection(id: string): Connection | null;
  findConnection(ref: string): Connection | null;
  saveConnection(input: ConnectionInput, now: string): Connection;
  deleteConnection(id: string): boolean;
  setWrites(id: string, allowWrites: boolean, now: string): Connection | null;
  setDatabase(id: string, database: string, now: string): Connection | null;
  password(id: string): string | null;
  activeId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
  recordHistory(input: HistoryInput): HistoryEntry;
  listHistory(filter: { connectionId: string | null; query: string; limit: number }): HistoryEntry[];
  clearHistory(connectionId: string | null): number;
  listSaved(connectionId: string | null): SavedQuery[];
  saveQuery(input: { id?: string; connectionId: string | null; name: string; sql: string }, now: string): SavedQuery;
  deleteSaved(id: string): boolean;
}

export function createStore(storage: BbPluginApi["storage"]): Store {
  const db: Database = storage.database();
  storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      database TEXT NOT NULL,
      user TEXT NOT NULL,
      user_follows_database INTEGER NOT NULL,
      auth TEXT NOT NULL,
      ssl INTEGER NOT NULL,
      allow_writes INTEGER NOT NULL DEFAULT 0,
      password TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT,
      connection_name TEXT NOT NULL,
      database TEXT NOT NULL,
      sql TEXT NOT NULL,
      source TEXT NOT NULL,
      prompt TEXT,
      started_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      row_count INTEGER,
      error TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS history_started_idx ON history (started_at DESC)`,
    `CREATE TABLE IF NOT EXISTS saved_queries (
      id TEXT PRIMARY KEY,
      connection_id TEXT,
      name TEXT NOT NULL,
      sql TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ]);

  const selectConnection = db.prepare<[string], ConnectionRow>("SELECT * FROM connections WHERE id = ?");
  const selectConnections = db.prepare<[], ConnectionRow>("SELECT * FROM connections ORDER BY name COLLATE NOCASE");
  const insertConnection = db.prepare(
    `INSERT INTO connections (id, name, host, port, database, user, user_follows_database, auth, ssl, allow_writes, password, created_at, updated_at)
     VALUES (@id, @name, @host, @port, @database, @user, @user_follows_database, @auth, @ssl, 0, @password, @now, @now)`,
  );
  const updateConnection = db.prepare(
    `UPDATE connections SET name = @name, host = @host, port = @port, database = @database, user = @user, user_follows_database = @user_follows_database,
       auth = @auth, ssl = @ssl, password = COALESCE(@password, CASE WHEN @clear = 1 THEN NULL ELSE password END), updated_at = @now
     WHERE id = @id`,
  );
  const insertHistory = db.prepare(
    `INSERT INTO history (connection_id, connection_name, database, sql, source, prompt, started_at, duration_ms, row_count, error)
     VALUES (@connection_id, @connection_name, @database, @sql, @source, @prompt, @started_at, @duration_ms, @row_count, @error)`,
  );
  const trimHistory = db.prepare(`DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ${HISTORY_CAP})`);
  const selectHistory = db.prepare<[number], HistoryRow>("SELECT * FROM history WHERE id = ?");
  const selectSaved = db.prepare<[string], SavedRow>("SELECT * FROM saved_queries WHERE id = ?");

  const get = (id: string): Connection | null => {
    const row = selectConnection.get(id);
    return row === undefined ? null : toConnection(row);
  };

  return {
    listConnections: () => selectConnections.all().map(toConnection),
    getConnection: get,
    findConnection(ref) {
      const byId = get(ref);
      if (byId !== null) return byId;
      const lower = ref.trim().toLowerCase();
      return selectConnections.all().map(toConnection).find((connection) => connection.name.toLowerCase() === lower) ?? null;
    },
    saveConnection(input, now) {
      const id = input.id ?? newId("con");
      const params = {
        id,
        name: input.name,
        host: input.host,
        port: input.port,
        database: input.database,
        user: input.user,
        user_follows_database: input.userFollowsDatabase ? 1 : 0,
        auth: JSON.stringify(input.auth),
        ssl: input.ssl ? 1 : 0,
        password: input.auth.kind === "password" ? (input.password ?? null) : null,
        clear: input.auth.kind !== "password" || input.password === null ? 1 : 0,
        now,
      };
      if (input.id !== undefined && get(input.id) !== null) updateConnection.run(params);
      else insertConnection.run(params);
      return get(id)!;
    },
    deleteConnection: (id) => db.prepare("DELETE FROM connections WHERE id = ?").run(id).changes > 0,
    setWrites(id, allowWrites, now) {
      db.prepare("UPDATE connections SET allow_writes = ?, updated_at = ? WHERE id = ?").run(allowWrites ? 1 : 0, now, id);
      return get(id);
    },
    setDatabase(id, database, now) {
      db.prepare("UPDATE connections SET database = ?, updated_at = ? WHERE id = ?").run(database, now, id);
      return get(id);
    },
    password: (id) => selectConnection.get(id)?.password ?? null,
    activeId: async () => (await storage.kv.get<string>(ACTIVE_KEY)) ?? null,
    setActiveId: async (id) => (id === null ? storage.kv.delete(ACTIVE_KEY) : storage.kv.set(ACTIVE_KEY, id)),
    recordHistory(input) {
      const result = insertHistory.run({
        connection_id: input.connectionId,
        connection_name: input.connectionName,
        database: input.database,
        sql: input.sql,
        source: input.source,
        prompt: input.prompt,
        started_at: input.startedAt,
        duration_ms: Math.round(input.durationMs),
        row_count: input.rowCount,
        error: input.error,
      });
      trimHistory.run();
      return toHistory(selectHistory.get(Number(result.lastInsertRowid))!);
    },
    listHistory({ connectionId, query, limit }) {
      const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term !== "");
      const clauses = ["1 = 1"];
      const params: Array<string | number> = [];
      if (connectionId !== null) {
        clauses.push("connection_id = ?");
        params.push(connectionId);
      }
      for (const term of terms) {
        clauses.push("(lower(sql) LIKE ? ESCAPE '\\' OR lower(coalesce(prompt, '')) LIKE ? ESCAPE '\\' OR lower(database) LIKE ? ESCAPE '\\')");
        const like = `%${term.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
        params.push(like, like, like);
      }
      params.push(limit);
      return db
        .prepare<Array<string | number>, HistoryRow>(`SELECT * FROM history WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`)
        .all(...params)
        .map(toHistory);
    },
    clearHistory(connectionId) {
      return connectionId === null
        ? db.prepare("DELETE FROM history").run().changes
        : db.prepare("DELETE FROM history WHERE connection_id = ?").run(connectionId).changes;
    },
    listSaved(connectionId) {
      const rows =
        connectionId === null
          ? db.prepare<[], SavedRow>("SELECT * FROM saved_queries ORDER BY name COLLATE NOCASE").all()
          : db.prepare<[string], SavedRow>("SELECT * FROM saved_queries WHERE connection_id = ? OR connection_id IS NULL ORDER BY name COLLATE NOCASE").all(connectionId);
      return rows.map(toSaved);
    },
    saveQuery(input, now) {
      const id = input.id ?? newId("sq");
      const existing = selectSaved.get(id);
      if (existing === undefined) {
        db.prepare("INSERT INTO saved_queries (id, connection_id, name, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
          id,
          input.connectionId,
          input.name,
          input.sql,
          now,
          now,
        );
      } else {
        db.prepare("UPDATE saved_queries SET connection_id = ?, name = ?, sql = ?, updated_at = ? WHERE id = ?").run(input.connectionId, input.name, input.sql, now, id);
      }
      return toSaved(selectSaved.get(id)!);
    },
    deleteSaved: (id) => db.prepare("DELETE FROM saved_queries WHERE id = ?").run(id).changes > 0,
  };
}
