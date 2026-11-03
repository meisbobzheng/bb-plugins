import { setImmediate } from "node:timers/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Clause } from "./docx.js";
import { clauseDepth, parseQuery } from "./specs.js";

export const MARK_START = "\u0002";
export const MARK_END = "\u0003";

const BATCH = 200;
const IDENTIFY_TERMS = 32;
const IDENTIFY_CANDIDATES = 40;
const SHINGLE = 3;
const STOPWORDS = new Set(
  "a an and are as at be by for from has have if in into is it its may not of on or shall should that the their then there these this to was were when which will with".split(" "),
);

export type Source = "3gpp" | "file";
export type JobKind = "fetch" | "file";
export type JobStatus = "queued" | "running" | "done" | "failed";
export type Match = "clause" | "subclause" | "contents" | "text";

export interface Spec {
  spec: string;
  kind: string;
  title: string;
  version: string;
  release: number;
  source: Source;
  origin: string;
  sha256: string;
  clauses: number;
  indexedAt: string;
}

export interface NewSpec {
  spec: string;
  kind: string;
  title: string;
  version: string;
  release: number;
  source: Source;
  origin: string;
  sha256: string;
}

export interface Hit {
  spec: string;
  kind: string;
  version: string;
  clause: string;
  title: string;
  snippet: string;
  match: Match;
}

export interface SearchResult {
  hits: Hit[];
  missing: string | null;
}

export interface Identified extends Hit {
  confidence: number;
}

export interface ClauseRef {
  clause: string;
  title: string;
}

export interface ClauseDocument {
  spec: Spec;
  clause: string;
  title: string;
  body: string;
  parent: ClauseRef | null;
  children: ClauseRef[];
}

export interface Job {
  id: number;
  kind: JobKind;
  target: string;
  release: number | null;
  status: JobStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SpecRow {
  id: number;
  spec: string;
  kind: string;
  title: string;
  version: string;
  release: number;
  source: Source;
  origin: string;
  sha256: string;
  clauses: number;
  indexed_at: number;
}

interface HitRow {
  spec: string;
  kind: string;
  version: string;
  clause: string;
  title: string;
  body: string;
  snippet?: string | null;
}

interface JobRow {
  id: number;
  kind: JobKind;
  target: string;
  release: number | null;
  status: JobStatus;
  note: string | null;
  created_at: number;
  updated_at: number;
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

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function shingles(tokens: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (let index = 0; index + SHINGLE <= tokens.length; index++) set.add(tokens.slice(index, index + SHINGLE).join(" "));
  return set;
}

function excerpt(body: string, length = 200): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= length ? flat : `${flat.slice(0, length).replace(/\s\S*$/, "")}…`;
}

function toSpec(row: SpecRow): Spec {
  return {
    spec: row.spec,
    kind: row.kind,
    title: row.title,
    version: row.version,
    release: row.release,
    source: row.source,
    origin: row.origin,
    sha256: row.sha256,
    clauses: row.clauses,
    indexedAt: new Date(row.indexed_at).toISOString(),
  };
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind,
    target: row.target,
    release: row.release,
    status: row.status,
    note: row.note,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toHit(row: HitRow, match: Match): Hit {
  const snippet = row.snippet?.includes(MARK_START) ? row.snippet : excerpt(row.body);
  return { spec: row.spec, kind: row.kind, version: row.version, clause: row.clause, title: row.title, snippet, match };
}

export function createStore(storage: BbPluginApi["storage"]) {
  const db = storage.database();
  storage.migrate(db, [
    `CREATE TABLE specs (
      id INTEGER PRIMARY KEY,
      spec TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      release INTEGER NOT NULL,
      source TEXT NOT NULL,
      origin TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      clauses INTEGER NOT NULL,
      state TEXT NOT NULL,
      indexed_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX specs_ready ON specs (spec) WHERE state = 'ready'`,
    `CREATE TABLE clauses (
      seq INTEGER PRIMARY KEY,
      spec_id INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      clause TEXT NOT NULL COLLATE NOCASE,
      title TEXT NOT NULL,
      depth INTEGER NOT NULL,
      body TEXT NOT NULL
    )`,
    `CREATE INDEX clauses_lookup ON clauses (spec_id, clause)`,
    `CREATE INDEX clauses_order ON clauses (spec_id, ord)`,
    `CREATE VIRTUAL TABLE clauses_fts USING fts5(
      title, body,
      content='clauses', content_rowid='seq', tokenize='porter unicode61 remove_diacritics 2'
    )`,
    `CREATE TRIGGER clauses_ai AFTER INSERT ON clauses BEGIN
      INSERT INTO clauses_fts (rowid, title, body) VALUES (new.seq, new.title, new.body);
    END`,
    `CREATE TRIGGER clauses_ad AFTER DELETE ON clauses BEGIN
      INSERT INTO clauses_fts (clauses_fts, rowid, title, body) VALUES ('delete', old.seq, old.title, old.body);
    END`,
    `CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      release INTEGER,
      status TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX jobs_status ON jobs (status, id)`,
  ]);

  const specColumns = "s.id, s.spec, s.kind, s.title, s.version, s.release, s.source, s.origin, s.sha256, s.clauses, s.indexed_at";
  const hitColumns = "s.spec, s.kind, s.version, c.clause, c.title, c.body";
  const ready = "JOIN specs s ON s.id = c.spec_id AND s.state = 'ready'";
  const statements = {
    spec: db.prepare(`SELECT ${specColumns} FROM specs s WHERE s.spec = ? AND s.state = 'ready'`),
    specs: db.prepare(`SELECT ${specColumns} FROM specs s WHERE s.state = 'ready' ORDER BY s.spec`),
    sha: db.prepare("SELECT 1 FROM specs WHERE sha256 = ? AND state = 'ready'"),
    insertSpec: db.prepare(
      `INSERT INTO specs (spec, kind, title, version, release, source, origin, sha256, clauses, state, indexed_at)
       VALUES (@spec, @kind, @title, @version, @release, @source, @origin, @sha256, @clauses, 'indexing', @now)`,
    ),
    insertClause: db.prepare(
      "INSERT INTO clauses (spec_id, ord, clause, title, depth, body) VALUES (@specId, @ord, @clause, @title, @depth, @body)",
    ),
    retire: db.prepare("UPDATE specs SET state = 'retired' WHERE spec = ? AND state = 'ready'"),
    publish: db.prepare("UPDATE specs SET state = 'ready' WHERE id = ?"),
    staleOne: db.prepare("SELECT id FROM specs WHERE state != 'ready' LIMIT 1"),
    clauseBatch: db.prepare("SELECT seq FROM clauses WHERE spec_id = ? LIMIT ?"),
    deleteClause: db.prepare("DELETE FROM clauses WHERE seq = ?"),
    deleteSpec: db.prepare("DELETE FROM specs WHERE id = ?"),
    clause: db.prepare(`SELECT ${hitColumns}, c.depth FROM clauses c ${ready} WHERE s.spec = ? AND c.clause = ? ORDER BY c.ord LIMIT 1`),
    children: db.prepare(
      `SELECT ${hitColumns} FROM clauses c ${ready} WHERE s.spec = ? AND c.clause LIKE ? ESCAPE '\\' AND c.depth = ? ORDER BY c.ord LIMIT ?`,
    ),
    descendants: db.prepare(`SELECT c.clause, c.title, c.body FROM clauses c ${ready} WHERE s.spec = ? AND c.clause LIKE ? ESCAPE '\\' ORDER BY c.ord`),
    contents: db.prepare(`SELECT ${hitColumns} FROM clauses c ${ready} WHERE s.spec = ? AND c.depth = 1 ORDER BY c.ord LIMIT ?`),
    enqueue: db.prepare(
      "INSERT INTO jobs (kind, target, release, status, created_at, updated_at) VALUES (@kind, @target, @release, 'queued', @now, @now)",
    ),
    pending: db.prepare("SELECT id FROM jobs WHERE kind = ? AND target = ? AND status IN ('queued', 'running')"),
    next: db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1"),
    claim: db.prepare("UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'"),
    finish: db.prepare("UPDATE jobs SET status = @status, note = @note, updated_at = @now WHERE id = @id"),
    requeue: db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running'"),
    job: db.prepare("SELECT * FROM jobs WHERE id = ?"),
    jobs: db.prepare("SELECT * FROM jobs ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, id DESC LIMIT ?"),
    prune: db.prepare("DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at < ?"),
  };

  const prepared = new Map<string, ReturnType<typeof db.prepare>>();
  function prepare(sql: string) {
    const statement = prepared.get(sql) ?? db.prepare(sql);
    prepared.set(sql, statement);
    return statement;
  }

  async function dropStale(signal?: AbortSignal): Promise<void> {
    for (let row = statements.staleOne.get() as { id: number } | undefined; row !== undefined; row = statements.staleOne.get() as { id: number } | undefined) {
      const id = row.id;
      for (;;) {
        const batch = statements.clauseBatch.all(id, BATCH) as Array<{ seq: number }>;
        if (batch.length === 0) break;
        db.transaction(() => {
          for (const { seq } of batch) statements.deleteClause.run(seq);
        })();
        await setImmediate();
        signal?.throwIfAborted();
      }
      statements.deleteSpec.run(id);
    }
  }

  function like(clause: string): string {
    return `${clause.replace(/[\\%_]/g, (char) => `\\${char}`)}.%`;
  }

  function lookup(spec: string, clause: string, limit: number): Hit[] {
    const exact = statements.clause.get(spec, clause) as (HitRow & { depth: number }) | undefined;
    if (exact === undefined) return [];
    const children = statements.children.all(spec, like(exact.clause), exact.depth + 1, Math.max(0, limit - 1)) as HitRow[];
    return [toHit(exact, "clause"), ...children.map((row) => toHit(row, "subclause"))];
  }

  function textSearch(query: string, spec: string | null, limit: number, exclude: ReadonlySet<string>): Hit[] {
    const loose = ftsQuery(query);
    if (loose === null || limit <= 0) return [];
    const phrase = words(query);
    const filter = spec === null ? "" : "AND s.spec = @spec";
    const seen = new Set(exclude);
    const hits: Hit[] = [];
    for (const match of phrase.length > 1 ? [`"${phrase.join(" ")}"`, loose] : [loose]) {
      const rows = prepare(
        `SELECT ${hitColumns}, snippet(clauses_fts, 1, char(2), char(3), '…', 20) AS snippet
         FROM clauses_fts JOIN clauses c ON c.seq = clauses_fts.rowid ${ready}
         WHERE clauses_fts MATCH @match ${filter}
         ORDER BY bm25(clauses_fts, 8.0, 1.0) LIMIT @limit`,
      ).all({ match, spec, limit: limit + seen.size }) as HitRow[];
      for (const row of rows) {
        const key = `${row.spec} ${row.clause}`;
        if (hits.length === limit || seen.has(key)) continue;
        seen.add(key);
        hits.push(toHit(row, "text"));
      }
    }
    return hits;
  }

  function getSpec(spec: string): Spec | null {
    const row = statements.spec.get(spec) as SpecRow | undefined;
    return row === undefined ? null : toSpec(row);
  }

  return {
    getSpec,
    listSpecs(): Spec[] {
      return (statements.specs.all() as SpecRow[]).map(toSpec);
    },
    hasFile(sha256: string): boolean {
      return statements.sha.get(sha256) !== undefined;
    },
    async replace(spec: NewSpec, clauses: readonly Clause[], signal?: AbortSignal): Promise<Spec> {
      const id = Number(statements.insertSpec.run({ ...spec, clauses: clauses.length, now: Date.now() }).lastInsertRowid);
      for (let start = 0; start < clauses.length; start += BATCH) {
        db.transaction(() => {
          clauses.slice(start, start + BATCH).forEach((clause, offset) => {
            statements.insertClause.run({ specId: id, ord: start + offset, ...clause, depth: clause.depth || clauseDepth(clause.clause) });
          });
        })();
        await setImmediate();
        signal?.throwIfAborted();
      }
      db.transaction(() => {
        statements.retire.run(spec.spec);
        statements.publish.run(id);
      })();
      await dropStale(signal);
      return getSpec(spec.spec)!;
    },
    async remove(spec: string): Promise<boolean> {
      const removed = statements.retire.run(spec).changes > 0;
      await dropStale();
      return removed;
    },
    dropStale,
    search(input: { query: string; spec: string | null; limit: number }): SearchResult {
      const parsed = parseQuery(input.query);
      const spec = input.spec ?? parsed.spec;
      const text = parsed.spec === null ? input.query.trim() : parsed.text;
      if (spec !== null && getSpec(spec) === null) return { hits: [], missing: spec };
      const hits: Hit[] = [];
      if (spec !== null && parsed.clause !== null) hits.push(...lookup(spec, parsed.clause, text === "" ? input.limit : Math.ceil(input.limit / 2)));
      else if (spec !== null && text === "") {
        hits.push(...(statements.contents.all(spec, input.limit) as HitRow[]).map((row) => toHit(row, "contents")));
      }
      const seen = new Set(hits.map((hit) => `${hit.spec} ${hit.clause}`));
      hits.push(...textSearch(text, spec, input.limit - hits.length, seen));
      return { hits, missing: null };
    },
    identify(passage: string, limit: number): Identified[] {
      const tokens = words(passage);
      const wanted = shingles(tokens);
      if (wanted.size === 0) return [];
      const terms = [...new Set(tokens.filter((word) => word.length > 2 && !STOPWORDS.has(word)))]
        .sort((a, b) => b.length - a.length)
        .slice(0, IDENTIFY_TERMS);
      if (terms.length === 0) return [];
      const rows = prepare(
        `SELECT ${hitColumns} FROM clauses_fts JOIN clauses c ON c.seq = clauses_fts.rowid ${ready}
         WHERE clauses_fts MATCH @match ORDER BY bm25(clauses_fts, 1.0, 1.0) LIMIT ${IDENTIFY_CANDIDATES}`,
      ).all({ match: terms.map((term) => `"${term}"`).join(" OR ") }) as HitRow[];
      return rows
        .map((row) => {
          const body = shingles(words(`${row.title} ${row.body}`));
          let shared = 0;
          for (const shingle of wanted) if (body.has(shingle)) shared++;
          return { ...toHit(row, "text"), confidence: shared / wanted.size };
        })
        .filter((hit) => hit.confidence > 0)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);
    },
    clause(spec: string, clause: string, deep: boolean): ClauseDocument | null {
      const meta = getSpec(spec);
      const row = meta === null ? undefined : (statements.clause.get(spec, clause) as (HitRow & { depth: number }) | undefined);
      if (meta === null || row === undefined) return null;
      const parentId = row.clause.includes(".") ? row.clause.slice(0, row.clause.lastIndexOf(".")) : null;
      const parent = parentId === null ? undefined : (statements.clause.get(spec, parentId) as HitRow | undefined);
      const children = (statements.children.all(spec, like(row.clause), row.depth + 1, 500) as HitRow[]).map(({ clause, title }) => ({ clause, title }));
      const body = deep
        ? [row.body, ...(statements.descendants.all(spec, like(row.clause)) as HitRow[]).map((child) => `${child.clause} ${child.title}\n${child.body}`)].join("\n\n")
        : row.body;
      return { spec: meta, clause: row.clause, title: row.title, body, parent: parent === undefined ? null : { clause: parent.clause, title: parent.title }, children };
    },
    enqueue(kind: JobKind, target: string, release: number | null): Job {
      const existing = statements.pending.get(kind, target) as { id: number } | undefined;
      const id = existing?.id ?? Number(statements.enqueue.run({ kind, target, release, now: Date.now() }).lastInsertRowid);
      return toJob(statements.job.get(id) as JobRow);
    },
    claimJob(): Job | null {
      const row = statements.next.get() as JobRow | undefined;
      if (row === undefined || statements.claim.run(Date.now(), row.id).changes === 0) return null;
      return toJob({ ...row, status: "running" });
    },
    finishJob(id: number, status: "done" | "failed", note: string): void {
      statements.finish.run({ id, status, note, now: Date.now() });
    },
    requeueRunning(): number {
      return statements.requeue.run().changes;
    },
    job(id: number): Job | null {
      const row = statements.job.get(id) as JobRow | undefined;
      return row === undefined ? null : toJob(row);
    },
    jobs(limit: number): Job[] {
      return (statements.jobs.all(limit) as JobRow[]).map(toJob);
    },
    pruneJobs(before: number): number {
      return statements.prune.run(before).changes;
    },
  };
}

export type Store = ReturnType<typeof createStore>;
