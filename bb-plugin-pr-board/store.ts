import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { pullDetailSchema, type Draft, type Finding, type PullDetail, type Severity, type Side } from "./contract.js";

export interface PullKey {
  repo: string;
  number: number;
}

export interface NewFinding {
  path: string;
  side: Side;
  startLine: number | null;
  endLine: number | null;
  severity: Severity;
  title: string;
  body: string;
}

export type DraftInput = Omit<Draft, "id"> & { id: string | null };

interface FindingRow {
  id: string;
  path: string;
  side: Side;
  start_line: number | null;
  end_line: number | null;
  severity: Severity;
  title: string;
  body: string;
  head_sha: string | null;
  dismissed: number;
}

interface DraftRow {
  id: string;
  path: string;
  side: Side;
  start_line: number;
  end_line: number;
  body: string;
}

function toFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    path: row.path,
    side: row.side,
    startLine: row.start_line,
    endLine: row.end_line,
    severity: row.severity,
    title: row.title,
    body: row.body,
    headSha: row.head_sha,
    dismissed: row.dismissed === 1,
  };
}

function toDraft(row: DraftRow): Draft {
  return { id: row.id, path: row.path, side: row.side, startLine: row.start_line, endLine: row.end_line, body: row.body };
}

export function createStore(storage: BbPluginApi["storage"]) {
  const db = storage.database();
  storage.migrate(db, [
    `CREATE TABLE review_threads (
      thread_id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX review_threads_pull ON review_threads (repo, number, created_at)`,
    `CREATE TABLE findings (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      head_sha TEXT,
      path TEXT NOT NULL,
      side TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      dismissed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL
    )`,
    `CREATE INDEX findings_pull ON findings (repo, number, position)`,
    `CREATE TABLE drafts (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      path TEXT NOT NULL,
      side TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX drafts_pull ON drafts (repo, number, created_at)`,
    `CREATE TABLE pull_details (
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      version TEXT NOT NULL,
      detail TEXT NOT NULL,
      PRIMARY KEY (repo, number)
    )`,
  ]);

  const statements = {
    recordThread: db.prepare(
      "INSERT OR REPLACE INTO review_threads (thread_id, repo, number, created_at) VALUES (?, ?, ?, ?)",
    ),
    threadsForPull: db.prepare(
      "SELECT thread_id FROM review_threads WHERE repo = ? AND number = ? ORDER BY created_at DESC",
    ),
    pullForThread: db.prepare("SELECT repo, number FROM review_threads WHERE thread_id = ?"),
    findings: db.prepare(
      "SELECT id, path, side, start_line, end_line, severity, title, body, head_sha, dismissed FROM findings WHERE repo = ? AND number = ? ORDER BY position",
    ),
    findingCounts: db.prepare(
      "SELECT repo, number, COUNT(*) AS count FROM findings WHERE dismissed = 0 GROUP BY repo, number",
    ),
    clearFindings: db.prepare("DELETE FROM findings WHERE repo = ? AND number = ?"),
    insertFinding: db.prepare(
      `INSERT INTO findings (id, thread_id, repo, number, head_sha, path, side, start_line, end_line, severity, title, body, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    maxFindingPosition: db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM findings WHERE repo = ? AND number = ?"),
    dismissFinding: db.prepare("UPDATE findings SET dismissed = ? WHERE id = ?"),
    pullForFinding: db.prepare("SELECT repo, number FROM findings WHERE id = ?"),
    drafts: db.prepare(
      "SELECT id, path, side, start_line, end_line, body FROM drafts WHERE repo = ? AND number = ? ORDER BY created_at",
    ),
    upsertDraft: db.prepare(
      `INSERT INTO drafts (id, repo, number, path, side, start_line, end_line, body, created_at)
       VALUES (@id, @repo, @number, @path, @side, @startLine, @endLine, @body, @createdAt)
       ON CONFLICT (id) DO UPDATE SET path = @path, side = @side, start_line = @startLine, end_line = @endLine, body = @body`,
    ),
    draft: db.prepare("SELECT id, path, side, start_line, end_line, body FROM drafts WHERE id = ?"),
    pullForDraft: db.prepare("SELECT repo, number FROM drafts WHERE id = ?"),
    deleteDraft: db.prepare("DELETE FROM drafts WHERE id = ?"),
    clearDrafts: db.prepare("DELETE FROM drafts WHERE repo = ? AND number = ?"),
    pullDetail: db.prepare("SELECT version, detail FROM pull_details WHERE repo = ? AND number = ?"),
    savePullDetail: db.prepare("INSERT OR REPLACE INTO pull_details (repo, number, version, detail) VALUES (?, ?, ?, ?)"),
  };

  return {
    recordThread(threadId: string, pull: PullKey, now: number): void {
      statements.recordThread.run(threadId, pull.repo, pull.number, now);
    },
    threadsForPull(pull: PullKey): string[] {
      return (statements.threadsForPull.all(pull.repo, pull.number) as Array<{ thread_id: string }>).map((row) => row.thread_id);
    },
    pullForThread(threadId: string): PullKey | null {
      return (statements.pullForThread.get(threadId) as PullKey | undefined) ?? null;
    },
    findings(pull: PullKey): Finding[] {
      return (statements.findings.all(pull.repo, pull.number) as FindingRow[]).map(toFinding);
    },
    findingCounts(): Map<string, number> {
      const rows = statements.findingCounts.all() as Array<PullKey & { count: number }>;
      return new Map(rows.map((row) => [`${row.repo}#${row.number}`, row.count]));
    },
    recordFindings(threadId: string, pull: PullKey, headSha: string | null, findings: readonly NewFinding[], replace: boolean): void {
      db.transaction(() => {
        if (replace) statements.clearFindings.run(pull.repo, pull.number);
        const start = (statements.maxFindingPosition.get(pull.repo, pull.number) as { position: number }).position + 1;
        findings.forEach((finding, index) => {
          statements.insertFinding.run(
            randomUUID(),
            threadId,
            pull.repo,
            pull.number,
            headSha,
            finding.path,
            finding.side,
            finding.startLine,
            finding.endLine,
            finding.severity,
            finding.title,
            finding.body,
            start + index,
          );
        });
      })();
    },
    dismissFinding(id: string, dismissed: boolean): PullKey | null {
      statements.dismissFinding.run(dismissed ? 1 : 0, id);
      return (statements.pullForFinding.get(id) as PullKey | undefined) ?? null;
    },
    drafts(pull: PullKey): Draft[] {
      return (statements.drafts.all(pull.repo, pull.number) as DraftRow[]).map(toDraft);
    },
    saveDraft(pull: PullKey, draft: DraftInput, now: number): Draft {
      if (draft.id !== null) {
        const owner = statements.pullForDraft.get(draft.id) as PullKey | undefined;
        if (owner === undefined || owner.repo !== pull.repo || owner.number !== pull.number) {
          throw new Error("That draft comment does not exist on this pull request.");
        }
      }
      const id = draft.id ?? randomUUID();
      statements.upsertDraft.run({ ...draft, id, repo: pull.repo, number: pull.number, createdAt: now });
      return toDraft(statements.draft.get(id) as DraftRow);
    },
    deleteDraft(id: string): PullKey | null {
      const pull = (statements.pullForDraft.get(id) as PullKey | undefined) ?? null;
      statements.deleteDraft.run(id);
      return pull;
    },
    clearDrafts(pull: PullKey): void {
      statements.clearDrafts.run(pull.repo, pull.number);
    },
    pullDetail(pull: PullKey): { version: string; detail: PullDetail } | null {
      const row = statements.pullDetail.get(pull.repo, pull.number) as { version: string; detail: string } | undefined;
      if (row === undefined) return null;
      const parsed = pullDetailSchema.safeParse(JSON.parse(row.detail));
      return parsed.success ? { version: row.version, detail: parsed.data } : null;
    },
    savePullDetail(pull: PullKey, version: string, detail: PullDetail): void {
      statements.savePullDetail.run(pull.repo, pull.number, version, JSON.stringify(detail));
    },
  };
}

export type Store = ReturnType<typeof createStore>;
