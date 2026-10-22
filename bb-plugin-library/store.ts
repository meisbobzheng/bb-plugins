import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { CatalogTag, Entry, EntryHit, SearchInput, SearchResult } from "./contract.js";
import { detectTags, normalizeTags, termFor, type TagDraft } from "./glossary.js";
import { MARK_START, TAG_GROUPS, excerpt, isKind, isTagGroup, sortByGroup, type Kind, type TagGroup, type TagRef } from "./library.js";

const TAG_FACETS = 400;

export type GroupMode = "keep" | "set";

export interface EntryEdit {
  title: string;
  kind: Kind;
  summary: string;
  body: string;
  tags: readonly TagDraft[];
}

export interface NewEntry extends EntryEdit {
  threadId: string | null;
  threadTitle: string | null;
  messageId: string | null;
}

export interface Retagged {
  id: string;
  title: string;
  added: string[];
}

export type RegroupResult = { ok: true; tag: string; group: TagGroup } | { ok: false; tag: string; group: TagGroup };

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
    `CREATE TABLE tag_groups (key TEXT PRIMARY KEY, tag TEXT NOT NULL, grp TEXT NOT NULL)`,
  ]);

  const columns = "e.id, e.title, e.kind, e.summary, e.body, e.tags, e.thread_id, e.thread_title, e.message_id, e.created_at, e.updated_at";
  const statements = {
    insert: db.prepare(
      `INSERT INTO entries (id, title, kind, summary, body, tags, thread_id, thread_title, message_id, created_at, updated_at)
       VALUES (@id, @title, @kind, @summary, @body, @tags, @threadId, @threadTitle, @messageId, @now, @now)`,
    ),
    get: db.prepare(`SELECT ${columns} FROM entries e WHERE e.id = ?`),
    all: db.prepare(`SELECT ${columns} FROM entries e ORDER BY e.seq`),
    update: db.prepare(
      "UPDATE entries SET title = @title, kind = @kind, summary = @summary, body = @body, tags = @tags, updated_at = @now WHERE id = @id",
    ),
    updateTags: db.prepare("UPDATE entries SET tags = ? WHERE id = ?"),
    remove: db.prepare("DELETE FROM entries WHERE id = ?"),
    forgetThread: db.prepare("UPDATE entries SET thread_id = NULL WHERE thread_id = ?"),
    groups: db.prepare("SELECT tag, grp FROM tag_groups"),
    setGroup: db.prepare("INSERT INTO tag_groups (key, tag, grp) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET tag = excluded.tag, grp = excluded.grp"),
    keepGroup: db.prepare("INSERT INTO tag_groups (key, tag, grp) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING"),
    clearGroup: db.prepare("DELETE FROM tag_groups WHERE key = ?"),
    tagCounts: db.prepare("SELECT t.value AS tag, COUNT(*) AS count FROM entries e JOIN json_each(e.tags) AS t GROUP BY lower(t.value)"),
    usedSpelling: db.prepare("SELECT t.value AS tag FROM entries e JOIN json_each(e.tags) AS t WHERE lower(t.value) = lower(?) LIMIT 1"),
  };

  const prepared = new Map<string, ReturnType<typeof db.prepare>>();
  function prepare(sql: string) {
    const statement = prepared.get(sql) ?? db.prepare(sql);
    prepared.set(sql, statement);
    return statement;
  }

  const registry = new Map<string, { tag: string; group: TagGroup }>();
  for (const row of statements.groups.all() as Array<{ tag: string; grp: string }>) {
    if (isTagGroup(row.grp)) registry.set(row.tag.toLowerCase(), { tag: row.tag, group: row.grp });
  }

  function groupOf(tag: string): TagGroup {
    return termFor(tag)?.group ?? registry.get(tag.toLowerCase())?.group ?? "other";
  }

  function refs(names: readonly string[]): TagRef[] {
    return sortByGroup(names.map((tag) => ({ tag, group: groupOf(tag) })));
  }

  function toEntry(row: EntryRow): Entry {
    return {
      id: row.id,
      title: row.title,
      kind: isKind(row.kind) ? row.kind : "note",
      summary: row.summary,
      body: row.body,
      tags: refs(parseTags(row.tags)),
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

  function assign(tag: string, group: TagGroup, mode: GroupMode): void {
    if (termFor(tag) !== undefined) return;
    const key = tag.toLowerCase();
    if (group === "other") {
      if (mode === "set") {
        statements.clearGroup.run(key);
        registry.delete(key);
      }
      return;
    }
    if (mode === "keep" && registry.has(key)) return;
    (mode === "set" ? statements.setGroup : statements.keepGroup).run(key, tag, group);
    registry.set(key, { tag, group });
  }

  function spelling(tag: string): string {
    const used = statements.usedSpelling.get(tag) as { tag: string } | undefined;
    return registry.get(tag.toLowerCase())?.tag ?? used?.tag ?? tag;
  }

  function storedTags(tags: readonly TagDraft[], mode: GroupMode): string {
    const normalized = normalizeTags(tags).map((draft) => ({ ...draft, tag: spelling(draft.tag) }));
    for (const { tag, group } of normalized) {
      if (group !== null) assign(tag, group, mode);
    }
    return JSON.stringify(normalized.map(({ tag }) => tag));
  }

  function editParams(edit: EntryEdit, mode: GroupMode) {
    return { title: edit.title, kind: edit.kind, summary: edit.summary, body: edit.body, tags: storedTags(edit.tags, mode) };
  }

  function get(id: string): Entry | null {
    const row = statements.get.get(id) as EntryRow | undefined;
    return row === undefined ? null : toEntry(row);
  }

  return {
    get,
    groupOf,
    create(entry: NewEntry, mode: GroupMode): Entry {
      const id = `lib_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      db.transaction(() => {
        statements.insert.run({
          ...editParams(entry, mode),
          id,
          threadId: entry.threadId,
          threadTitle: entry.threadTitle,
          messageId: entry.messageId,
          now: Date.now(),
        });
      })();
      return get(id)!;
    },
    update(id: string, edit: EntryEdit, mode: GroupMode): Entry | null {
      const changes = db.transaction(() => statements.update.run({ ...editParams(edit, mode), id, now: Date.now() }).changes)();
      return changes === 0 ? null : get(id);
    },
    remove(id: string): boolean {
      return statements.remove.run(id).changes > 0;
    },
    forgetThread(threadId: string): number {
      return statements.forgetThread.run(threadId).changes;
    },
    regroup(raw: string, group: TagGroup): RegroupResult {
      const builtIn = termFor(raw);
      if (builtIn !== undefined) return { ok: false, tag: builtIn.tag, group: builtIn.group };
      const tag = spelling(raw);
      assign(tag, group, "set");
      return { ok: true, tag, group: groupOf(tag) };
    },
    retag(dryRun: boolean): Retagged[] {
      const changed = (statements.all.all() as EntryRow[]).flatMap((row) => {
        const current = parseTags(row.tags);
        const known = new Set(current.map((tag) => tag.toLowerCase()));
        const detected = detectTags(`${row.title}\n${row.summary}\n${row.body}`);
        const tags = normalizeTags([...current, ...detected].map((tag) => ({ tag, group: null }))).map(
          ({ tag }) => registry.get(tag.toLowerCase())?.tag ?? tag,
        );
        if (JSON.stringify(tags) === row.tags) return [];
        return [{ id: row.id, title: row.title, added: tags.filter((tag) => !known.has(tag.toLowerCase())), tags }];
      });
      if (!dryRun) {
        db.transaction(() => {
          for (const { id, tags } of changed) statements.updateTags.run(JSON.stringify(tags), id);
        })();
      }
      return changed.map(({ id, title, added }) => ({ id, title, added }));
    },
    catalog(): CatalogTag[] {
      const used = new Map((statements.tagCounts.all() as Array<{ tag: string; count: number }>).map((row) => [row.tag.toLowerCase(), row]));
      const unused = [...registry.values()].filter(({ tag }) => !used.has(tag.toLowerCase())).map(({ tag }) => ({ tag, count: 0 }));
      const rows = [...used.values(), ...unused].map(({ tag, count }) => ({ tag, count, group: groupOf(tag), builtIn: termFor(tag) !== undefined }));
      rows.sort((a, b) => TAG_GROUPS.indexOf(a.group) - TAG_GROUPS.indexOf(b.group) || b.count - a.count || a.tag.localeCompare(b.tag));
      return rows;
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

      const top = `SELECT e.seq FROM ${from} ${all.where} ORDER BY ${order} LIMIT @limit`;
      const ranked = match === null ? `e.seq IN (${top})` : `entries_fts MATCH @match AND e.seq IN (${top})`;

      const rows = prepare(`SELECT ${columns}, ${snippet} AS snippet FROM ${from} WHERE ${ranked} ORDER BY ${order}`).all({
        ...all.params,
        limit: input.limit,
      }) as Array<EntryRow & { snippet: string | null }>;
      const total = prepare(`SELECT COUNT(*) AS count FROM ${from} ${all.where}`).get(all.params) as { count: number };
      const kinds = prepare(
        `SELECT e.kind AS kind, COUNT(*) AS count FROM ${from} ${anyKind.where} GROUP BY e.kind ORDER BY count DESC`,
      ).all(anyKind.params) as Array<{ kind: string; count: number }>;
      const tags = prepare(
        `SELECT t.value AS tag, COUNT(*) AS count FROM ${from} JOIN json_each(e.tags) AS t ${all.where}
         GROUP BY lower(t.value) ORDER BY count DESC, tag COLLATE NOCASE LIMIT ${TAG_FACETS}`,
      ).all(all.params) as Array<{ tag: string; count: number }>;

      return {
        entries: rows.map(toHit),
        total: total.count,
        kinds: kinds.flatMap(({ kind, count }) => (isKind(kind) ? [{ kind, count }] : [])),
        tags: tags.map(({ tag, count }) => ({ tag, count, group: groupOf(tag) })),
      };
    },
  };
}

export type Store = ReturnType<typeof createStore>;
