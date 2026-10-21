export type StatementKind = "read" | "write" | "control";

export interface Statement {
  text: string;
  skeleton: string;
}

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

export function splitStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let text = "";
  let skeleton = "";
  let i = 0;
  const push = () => {
    const trimmed = text.trim();
    if (trimmed !== "") statements.push({ text: trimmed, skeleton: skeleton.trim() });
    text = "";
    skeleton = "";
  };
  while (i < sql.length) {
    const char = sql[i]!;
    const next = sql[i + 1];
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      text += sql.slice(i, stop);
      skeleton += " ";
      i = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      text += sql.slice(i, j);
      skeleton += " ";
      i = j;
      continue;
    }
    if (char === "'" || char === '"') {
      const escaped = char === "'" && /[eE]$/.test(text);
      let j = i + 1;
      while (j < sql.length) {
        if (escaped && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === char) {
          if (sql[j + 1] === char) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      const stop = Math.min(j + 1, sql.length);
      text += sql.slice(i, stop);
      skeleton += char === "'" ? "''" : '""';
      i = stop;
      continue;
    }
    if (char === "$") {
      const match = DOLLAR_TAG.exec(sql.slice(i));
      if (match !== null) {
        const tag = match[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        text += sql.slice(i, stop);
        skeleton += "''";
        i = stop;
        continue;
      }
    }
    if (char === ";") {
      push();
      i += 1;
      continue;
    }
    text += char;
    skeleton += char;
    i += 1;
  }
  push();
  return statements;
}

export function firstKeyword(skeleton: string): string {
  const match = /^\s*\(*\s*([A-Za-z_]+)/.exec(skeleton);
  return match === null ? "" : match[1]!.toLowerCase();
}

const CONTROL = new Set([
  "set",
  "reset",
  "begin",
  "start",
  "commit",
  "end",
  "rollback",
  "abort",
  "savepoint",
  "release",
  "discard",
  "listen",
  "unlisten",
  "notify",
  "load",
  "prepare",
  "execute",
  "deallocate",
]);
const READ = new Set(["select", "with", "values", "table", "show"]);
const CURSORABLE = new Set(["select", "with", "values", "table"]);
const MODIFYING = /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|vacuum|reindex|cluster|refresh|call|do|lock|comment|import)\b/i;

export function classifyStatement(statement: Statement): StatementKind {
  const keyword = firstKeyword(statement.skeleton);
  if (CONTROL.has(keyword)) return "control";
  if (keyword === "explain") {
    const inner = statement.skeleton.replace(/^\s*explain\s*(\([^)]*\))?\s*(analyze\s*|verbose\s*)*/i, "");
    return classifyStatement({ text: inner, skeleton: inner });
  }
  if (!READ.has(keyword)) return "write";
  return MODIFYING.test(statement.skeleton) ? "write" : "read";
}

export function isReadOnlyScript(sql: string): boolean {
  const statements = splitStatements(sql);
  return statements.length > 0 && statements.every((statement) => classifyStatement(statement) === "read");
}

export function cursorable(statement: Statement): boolean {
  return CURSORABLE.has(firstKeyword(statement.skeleton)) && classifyStatement(statement) === "read";
}

export function touchesSchema(sql: string): boolean {
  return splitStatements(sql).some((statement) => /\b(create|alter|drop|comment|rename)\b/i.test(statement.skeleton));
}

const FENCE = /```(?:sql|postgresql|postgres|pgsql)?[^\n]*\n([\s\S]*?)```/i;

export function extractSql(reply: string): { sql: string; explanation: string } {
  const match = FENCE.exec(reply);
  if (match !== null) {
    const explanation = reply
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return { sql: match[1]!.trim(), explanation };
  }
  const trimmed = reply.trim();
  const statements = splitStatements(trimmed);
  const keyword = statements[0] === undefined ? "" : firstKeyword(statements[0].skeleton);
  if (READ.has(keyword) || keyword === "explain" || MODIFYING.test(keyword)) return { sql: trimmed, explanation: "" };
  return { sql: "", explanation: trimmed };
}

export function textTable(columns: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | null>>, maxCellWidth = 60): string {
  const cell = (value: string | null) => {
    const text = value === null ? "NULL" : value.replace(/\s+/g, " ");
    return text.length > maxCellWidth ? `${text.slice(0, maxCellWidth - 1)}…` : text;
  };
  const body = rows.map((row) => row.map(cell));
  const widths = columns.map((column, index) => Math.max(column.length, ...body.map((row) => (row[index] ?? "").length)));
  const line = (cells: readonly string[]) => cells.map((value, index) => value.padEnd(widths[index] ?? 0)).join(" | ").trimEnd();
  return [line(columns), widths.map((width) => "-".repeat(width)).join("-+-"), ...body.map(line)].join("\n");
}

export function quoteIdentifier(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

export function qualifiedName(schema: string, name: string): string {
  return schema === "public" ? quoteIdentifier(name) : `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}
