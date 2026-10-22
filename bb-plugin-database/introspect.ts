import type { SchemaSnapshot, TableInfo, TableKind } from "./contract.js";

const HIDDEN = "n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname NOT LIKE 'pg\\_%'";
const RELKINDS = "c.relkind IN ('r', 'p', 'v', 'm', 'f')";

export const DATABASES_SQL = "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname";

export const TABLES_SQL = `
SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
       CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS estimated_rows,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE ${RELKINDS} AND ${HIDDEN}
ORDER BY 1, 2`;

export const COLUMNS_SQL = `
SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
       format_type(a.atttypid, a.atttypmod) AS type,
       NOT a.attnotnull AS nullable,
       pg_get_expr(d.adbin, d.adrelid) AS "default",
       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY (i.indkey)) AS primary_key,
       col_description(c.oid, a.attnum) AS comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attnum > 0 AND NOT a.attisdropped AND ${RELKINDS} AND ${HIDDEN}
ORDER BY 1, 2, a.attnum`;

export const INDEXES_SQL = `
SELECT n.nspname AS schema, c.relname AS table, ic.relname AS name,
       pg_get_indexdef(i.indexrelid) AS definition, i.indisunique AS "unique", i.indisprimary AS "primary"
FROM pg_index i
JOIN pg_class c ON c.oid = i.indrelid
JOIN pg_class ic ON ic.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE ${HIDDEN}
ORDER BY 1, 2, 3`;

export const FOREIGN_KEYS_SQL = `
SELECT n.nspname AS schema, c.relname AS table, con.conname AS name,
       pg_get_constraintdef(con.oid) AS definition, rn.nspname AS ref_schema, rc.relname AS ref_table
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_class rc ON rc.oid = con.confrelid
JOIN pg_namespace rn ON rn.oid = rc.relnamespace
WHERE con.contype = 'f' AND ${HIDDEN}
ORDER BY 1, 2, 3`;

export const VERSION_SQL = "SELECT current_setting('server_version') AS version, current_database() AS database";

export const INTROSPECTION_SQL = [VERSION_SQL, TABLES_SQL, COLUMNS_SQL, INDEXES_SQL, FOREIGN_KEYS_SQL].join(";\n");

const KINDS: Record<string, TableKind> = { r: "table", p: "partitioned-table", v: "view", m: "materialized-view", f: "foreign-table" };

export type Row = Record<string, string | null>;

export interface IntrospectionRows {
  version: Row[];
  tables: Row[];
  columns: Row[];
  indexes: Row[];
  foreignKeys: Row[];
}

function text(row: Row, key: string): string {
  return row[key] ?? "";
}

function nullable(row: Row, key: string): string | null {
  return row[key] ?? null;
}

function bool(row: Row, key: string): boolean {
  const value = row[key];
  return value === "t" || value === "true";
}

export function shapeSnapshot(rows: IntrospectionRows, fetchedAt: string): SchemaSnapshot {
  const tables = new Map<string, TableInfo>();
  const key = (row: Row, nameKey: string) => `${text(row, "schema")}.${text(row, nameKey)}`;
  for (const row of rows.tables) {
    const estimated = nullable(row, "estimated_rows");
    tables.set(key(row, "name"), {
      schema: text(row, "schema"),
      name: text(row, "name"),
      kind: KINDS[text(row, "kind")] ?? "table",
      estimatedRows: estimated === null ? null : Number(estimated),
      comment: nullable(row, "comment"),
      columns: [],
      indexes: [],
      foreignKeys: [],
    });
  }
  for (const row of rows.columns) {
    tables.get(key(row, "table"))?.columns.push({
      name: text(row, "name"),
      type: text(row, "type"),
      nullable: bool(row, "nullable"),
      default: nullable(row, "default"),
      primaryKey: bool(row, "primary_key"),
      comment: nullable(row, "comment"),
    });
  }
  for (const row of rows.indexes) {
    tables.get(key(row, "table"))?.indexes.push({
      name: text(row, "name"),
      definition: text(row, "definition"),
      unique: bool(row, "unique"),
      primary: bool(row, "primary"),
    });
  }
  for (const row of rows.foreignKeys) {
    tables.get(key(row, "table"))?.foreignKeys.push({
      name: text(row, "name"),
      definition: text(row, "definition"),
      refSchema: text(row, "ref_schema"),
      refTable: text(row, "ref_table"),
    });
  }
  const version = rows.version[0];
  return { fetchedAt, serverVersion: version?.version ?? "unknown", database: version?.database ?? "", tables: [...tables.values()] };
}
