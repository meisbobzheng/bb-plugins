import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Entry, EntryHit, SearchInput, SearchResult } from "./contract.js";
import { MARK_START, excerpt, isKind, type Kind } from "./library.js";
import { normalizeTags } from "./topics.js";

const TAG_FACETS = 50;

export interface EntryEdit {
  title: string;
  kind: Kind;
  summary: string;
  body: string;
  tags: readonly string[];
}

export interface NewEntry extends EntryEdit {
  threadId: string | null;
  threadTitle: string | null;
  messageId: string | null;
}

interface EntryRow {
  id: string;
  title: string;
  kind: string;
  summary: string;
  body: string;
  tags: string;
  thread_id: string | null;
  thread_title: string | null;
  message_id: string | null;
  created_at: number;
  updated_at: number;
}

interface Clause {
  sql: string;
  params: Record<string, string>;
}

function parseTags(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    title: row.title,
    kind: isKind(row.kind) ? row.kind : "note",
    summary: row.summary,
    body: row.body,
    tags: parseTags(row.tags),
    source: { threadId: row.thread_id, threadTitle: row.thread_title, messageId: row.message_id },
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toHit(row: EntryRow & { snippet: string | null }): EntryHit {
  const { body, ...entry } = toEntry(row);
  const snippet = row.snippet?.includes(MARK_START) ? row.snippet : entry.summary || excerpt(body, 200);
  return { ...entry, snippet };
}

export function ftsQuery(input: string): string | null {
  const terms = [...input.matchAll(/"([^"]*)"|(\S+)/g)].flatMap((match) => {
    const quoted = match[1] !== undefined;
    const words = (match[1] ?? match[2] ?? "").match(/[\p{L}\p{N}]+/gu);
    if (words === null) return [];
    return [`"${words.join(" ")}"${quoted ? "" : "*"}`];
  });
  return terms.length === 0 ? null : terms.join(" ");
}

function compile(clauses: readonly Clause[]): { where: string; params: Record<string, string> } {
  return {
    where: clauses.length === 0 ? "" : `WHERE ${clauses.map((clause) => clause.sql).join(" AND ")}`,
    params: Object.assign({}, ...clauses.map((clause) => clause.params)),
  };
}

export function createStore(storage: BbPluginApi["storage"]) {
  const db = storage.database();
  storage.migrate(db, [
    `CREATE TABLE entries (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT NOT NULL,
      thread_id TEXT,
      thread_title TEXT,
      message_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX entries_updated ON entries (updated_at)`,
    `CREATE INDEX entries_thread ON entries (thread_id)`,
    `CREATE VIRTUAL TABLE entries_fts USING fts5(
      title, summary, tags, body,
      content='entries', content_rowid='seq', tokenize='unicode61 remove_diacritics 2'
    )`,
    `CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entries_fts (rowid, title, summary, tags, body) VALUES (new.seq, new.title, new.summary, new.tags, new.body);
    END`,
    `CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
      INSERT INTO entries_fts (entries_fts, rowid, title, summary, tags, body) VALUES ('delete', old.seq, old.title, old.summary, old.tags, old.body);
    END`,
    `CREATE TRIGGER entries_au AFTER UPDATE OF title, summary, tags, body ON entries BEGIN
      INSERT INTO entries_fts (entries_fts, rowid, title, summary, tags, body) VALUES ('delete', old.seq, old.title, old.summary, old.tags, old.body);
      INSERT INTO entries_fts (rowid, title, summary, tags, body) VALUES (new.seq, new.title, new.summary, new.tags, new.body);
    END`,
  ]);

  const columns = "e.id, e.title, e.kind, e.summary, e.body, e.tags, e.thread_id, e.thread_title, e.message_id, e.created_at, e.updated_at";
  const statements = {
    insert: db.prepare(
      `INSERT INTO entries (id, title, kind, summary, body, tags, thread_id, thread_title, message_id, created_at, updated_at)
       VALUES (@id, @title, @kind, @summary, @body, @tags, @threadId, @threadTitle, @messageId, @now, @now)`,
    ),
    get: db.prepare(`SELECT ${columns} FROM entries e WHERE e.id = ?`),
    update: db.prepare(
      "UPDATE entries SET title = @title, kind = @kind, summary = @summary, body = @body, tags = @tags, updated_at = @now WHERE id = @id",
    ),
    remove: db.prepare("DELETE FROM entries WHERE id = ?"),
    forgetThread: db.prepare("UPDATE entries SET thread_id = NULL WHERE thread_id = ?"),
  };

  function get(id: string): Entry | null {
    const row = statements.get.get(id) as EntryRow | undefined;
    return row === undefined ? null : toEntry(row);
  }

  function editParams(edit: EntryEdit) {
    return { title: edit.title, kind: edit.kind, summary: edit.summary, body: edit.body, tags: JSON.stringify(normalizeTags(edit.tags)) };
  }

  return {
    get,
    create(entry: NewEntry): Entry {
      const id = `lib_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      statements.insert.run({
        ...editParams(entry),
        id,
        threadId: entry.threadId,
        threadTitle: entry.threadTitle,
        messageId: entry.messageId,
        now: Date.now(),
      });
      return get(id)!;
    },
    update(id: string, edit: EntryEdit): Entry | null {
      const { changes } = statements.update.run({ ...editParams(edit), id, now: Date.now() });
      return changes === 0 ? null : get(id);
    },
    remove(id: string): boolean {
      return statements.remove.run(id).changes > 0;
    },
    forgetThread(threadId: string): number {
      return statements.forgetThread.run(threadId).changes;
    },
    search(input: SearchInput): SearchResult {
      const match = ftsQuery(input.query);
      const filters: Clause[] = [];
      if (match !== null) filters.push({ sql: "entries_fts MATCH @match", params: { match } });
      input.tags.forEach((tag, index) => {
        filters.push({
          sql: `EXISTS (SELECT 1 FROM json_each(e.tags) AS f WHERE lower(f.value) = lower(@tag${index}))`,
          params: { [`tag${index}`]: tag },
        });
      });
      if (input.threadId !== null) filters.push({ sql: "e.thread_id = @threadId", params: { threadId: input.threadId } });
      const all = compile(input.kind === null ? filters : [...filters, { sql: "e.kind = @kind", params: { kind: input.kind } }]);
      const anyKind = compile(filters);
      const from = match === null ? "entries e" : "entries e JOIN entries_fts ON entries_fts.rowid = e.seq";
      const snippet = match === null ? "NULL" : "snippet(entries_fts, 3, char(2), char(3), '…', 24)";
      const order = match === null ? "e.updated_at DESC, e.seq DESC" : "bm25(entries_fts, 10.0, 5.0, 8.0, 1.0), e.updated_at DESC";

      const rows = db
        .prepare(`SELECT ${columns}, ${snippet} AS snippet FROM ${from} ${all.where} ORDER BY ${order} LIMIT @limit`)
        .all({ ...all.params, limit: input.limit }) as Array<EntryRow & { snippet: string | null }>;
      const total = db.prepare(`SELECT COUNT(*) AS count FROM ${from} ${all.where}`).get(all.params) as { count: number };
      const kinds = db
        .prepare(`SELECT e.kind AS kind, COUNT(*) AS count FROM ${from} ${anyKind.where} GROUP BY e.kind ORDER BY count DESC`)
        .all(anyKind.params) as Array<{ kind: string; count: number }>;
      const tags = db
        .prepare(
          `SELECT t.value AS tag, COUNT(*) AS count FROM ${from} JOIN json_each(e.tags) AS t ${all.where}
           GROUP BY lower(t.value) ORDER BY count DESC, tag COLLATE NOCASE LIMIT ${TAG_FACETS}`,
        )
        .all(all.params) as Array<{ tag: string; count: number }>;

      return {
        entries: rows.map(toHit),
        total: total.count,
        kinds: kinds.flatMap(({ kind, count }) => (isKind(kind) ? [{ kind, count }] : [])),
        tags,
      };
    },
  };
}

export type Store = ReturnType<typeof createStore>;
