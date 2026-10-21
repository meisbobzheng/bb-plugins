import { useMemo, useState } from "react";
import type { SchemaSnapshot, TableInfo, TableKind } from "../contract";
import { cn } from "../lib/utils";
import { qualifiedName, quoteIdentifier } from "../sql";
import { EmptyState, IconButton, Spinner, prettyType, relativeTime } from "./bits";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";

export interface SchemaBrowserProps {
  snapshot: SchemaSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh(): void;
  onPreview(table: TableInfo): void;
  onDescribe(table: TableInfo): void;
  onInsert(text: string): void;
}

const KIND_ICONS: Record<TableKind, string> = {
  table: "GridView",
  "partitioned-table": "GridView",
  view: "Eye",
  "materialized-view": "Layers",
  "foreign-table": "Cloud",
};

export function filterTables(tables: readonly TableInfo[], query: string): TableInfo[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");
  if (terms.length === 0) return [...tables];
  return tables.filter((table) => {
    const haystack = `${table.schema}.${table.name} ${table.columns.map((column) => column.name).join(" ")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function TableRow({ table, open, onToggle, onPreview, onDescribe, onInsert }: { table: TableInfo; open: boolean; onToggle(): void; onPreview(): void; onDescribe(): void; onInsert(text: string): void }) {
  return (
    <li>
      <div className="group flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-state-hover">
        <button type="button" onClick={onToggle} onDoubleClick={onPreview} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={table.comment ?? `${table.kind}: ${qualifiedName(table.schema, table.name)}`}>
          <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0 text-muted-foreground" />
          <Icon name={KIND_ICONS[table.kind]} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{table.name}</span>
          {table.estimatedRows === null || table.estimatedRows === 0 ? null : <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">~{table.estimatedRows.toLocaleString()}</span>}
        </button>
        <span className="hidden shrink-0 gap-0.5 group-hover:flex">
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" title="Preview 100 rows" aria-label={`Preview ${table.name}`} onClick={onPreview}>
            <Icon name="Play" className="size-3" />
          </button>
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" title="Describe" aria-label={`Describe ${table.name}`} onClick={onDescribe}>
            <Icon name="Info" className="size-3" />
          </button>
        </span>
      </div>
      {open ? (
        <ul className="ml-5 border-l border-border pl-2">
          {table.columns.map((column) => (
            <li key={column.name}>
              <button
                type="button"
                onClick={() => onInsert(quoteIdentifier(column.name))}
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-[11px] hover:bg-state-hover"
                title={[column.comment, column.default === null ? null : `default ${column.default}`, column.nullable ? "nullable" : "not null"].filter((part) => part !== null).join(" · ")}
              >
                {column.primaryKey ? <Icon name="database/key" className="size-3 shrink-0 text-amber-600 dark:text-amber-400" /> : <span className="size-3 shrink-0" />}
                <span className="truncate">{column.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {prettyType(column.type)}
                  {column.nullable ? "?" : ""}
                </span>
              </button>
            </li>
          ))}
          {table.foreignKeys.map((key) => (
            <li key={key.name} className="flex items-center gap-1.5 px-1 py-0.5 font-mono text-[11px] text-muted-foreground" title={key.definition}>
              <Icon name="Link" className="size-3 shrink-0" />
              <span className="truncate">
                → {key.refSchema === table.schema ? key.refTable : `${key.refSchema}.${key.refTable}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function SchemaBrowser({ snapshot, loading, error, onRefresh, onPreview, onDescribe, onInsert }: SchemaBrowserProps) {
  const [query, setQuery] = useState("");
  const [openTables, setOpenTables] = useState<ReadonlySet<string>>(() => new Set());
  const [closedSchemas, setClosedSchemas] = useState<ReadonlySet<string>>(() => new Set());
  const groups = useMemo(() => {
    const filtered = filterTables(snapshot?.tables ?? [], query);
    const bySchema = new Map<string, TableInfo[]>();
    for (const table of filtered) (bySchema.get(table.schema) ?? bySchema.set(table.schema, []).get(table.schema)!).push(table);
    return [...bySchema.entries()].sort(([a], [b]) => (a === "public" ? -1 : b === "public" ? 1 : a.localeCompare(b)));
  }, [snapshot, query]);

  const toggle = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <div className="relative min-w-0 flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter tables and columns" aria-label="Filter tables" className="h-7 pl-7 text-xs" />
        </div>
        <IconButton label="Refresh schema" icon="RotateCcw" onClick={onRefresh} disabled={loading} className={cn("h-7 w-7 px-0", loading && "[&_svg]:animate-spin")} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {snapshot === null && loading ? (
          <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
            <Spinner /> Loading schema…
          </div>
        ) : error !== null && snapshot === null ? (
          <p role="alert" className="m-2 whitespace-pre-wrap break-words text-xs text-destructive">
            {error}
          </p>
        ) : groups.length === 0 ? (
          <EmptyState className="m-2 py-4 text-xs">{query === "" ? "No tables in this database." : "No tables match."}</EmptyState>
        ) : (
          groups.map(([schema, tables]) => {
            const open = query !== "" || !closedSchemas.has(schema);
            return (
              <section key={schema} className="mb-1">
                <button
                  type="button"
                  onClick={() => setClosedSchemas((current) => toggle(current, schema))}
                  className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-state-hover"
                >
                  <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3" />
                  {schema}
                  <span className="ml-auto font-normal normal-case tracking-normal">{tables.length}</span>
                </button>
                {open ? (
                  <ul>
                    {tables.map((table) => {
                      const key = `${table.schema}.${table.name}`;
                      return (
                        <TableRow
                          key={key}
                          table={table}
                          open={openTables.has(key)}
                          onToggle={() => setOpenTables((current) => toggle(current, key))}
                          onPreview={() => onPreview(table)}
                          onDescribe={() => onDescribe(table)}
                          onInsert={onInsert}
                        />
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            );
          })
        )}
      </div>
      {snapshot === null ? null : (
        <footer className="truncate border-t border-border px-2 py-1 text-[11px] text-muted-foreground" title={`PostgreSQL ${snapshot.serverVersion}, refreshed ${snapshot.fetchedAt}`}>
          {snapshot.tables.length} tables · PostgreSQL {snapshot.serverVersion.split(" ")[0]} · {relativeTime(snapshot.fetchedAt)}
          {error === null ? null : <span className="ml-1 text-destructive">· refresh failed</span>}
        </footer>
      )}
    </div>
  );
}
