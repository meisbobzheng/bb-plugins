import { useEffect, useState } from "react";
import { experimental_copyToClipboard as copyToClipboard } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { QueryRun, ResultSet } from "../contract";
import { cn } from "../lib/utils";
import { EmptyState, ErrorPanel, Kbd, Spinner, formatCount, formatMs, prettyType } from "./bits";
import { downloadText, exportFilename, toCsv, toJson, toMarkdown } from "./export";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export interface ResultsProps {
  run: QueryRun | null;
  sql: string;
  running: boolean;
  connectionName: string;
  onCancel(): void;
}

const BOOLEAN_TYPES = new Set(["bool"]);

function display(value: string, type: string): string {
  if (BOOLEAN_TYPES.has(type)) return value === "t" ? "true" : value === "f" ? "false" : value;
  return value;
}

async function copy(text: string, what: string): Promise<void> {
  const ok = await copyToClipboard({ text });
  if (ok) toast.success(`Copied ${what}`);
  else toast.error(`Could not copy ${what}`);
}

export function ExportMenu({ set, connectionName }: { set: ResultSet; connectionName: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" aria-label="Export results">
          <Icon name="Download" className="size-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void copy(toMarkdown(set), "Markdown table")}>Copy as Markdown</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copy(toCsv(set), "CSV")}>Copy as CSV</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copy(toJson(set), "JSON")}>Copy as JSON</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => downloadText(exportFilename(connectionName, "csv"), toCsv(set), "text/csv")}>Download CSV</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadText(exportFilename(connectionName, "json"), toJson(set), "application/json")}>Download JSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Grid({ set, durationMs, connectionName }: { set: ResultSet; durationMs: number; connectionName: string }) {
  const [selected, setSelected] = useState<{ row: number; column: number } | null>(null);
  useEffect(() => setSelected(null), [set]);
  const selectedValue = selected === null ? undefined : set.rows[selected.row]?.[selected.column];
  const selectedColumn = selected === null ? null : set.columns[selected.column];

  if (set.columns.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <EmptyState className="m-3">
          <span className="font-medium text-foreground">{set.command}</span> affected {formatCount(set.rowCount ?? 0, "row")} in {formatMs(durationMs)}.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 font-mono text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 border-b border-r border-border bg-card px-2 py-1 text-right font-normal text-muted-foreground">#</th>
              {set.columns.map((column, index) => (
                <th key={index} className="border-b border-r border-border bg-card px-2 py-1 text-left font-semibold" title={column.type}>
                  {column.name}
                  <span className="ml-1.5 font-normal text-muted-foreground">{prettyType(column.type)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {set.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-state-hover">
                <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-2 py-0.5 text-right text-muted-foreground">{rowIndex + 1}</td>
                {row.map((value, columnIndex) => {
                  const isSelected = selected?.row === rowIndex && selected.column === columnIndex;
                  const type = set.columns[columnIndex]?.type ?? "";
                  return (
                    <td
                      key={columnIndex}
                      onClick={() => setSelected({ row: rowIndex, column: columnIndex })}
                      onDoubleClick={() => void copy(value ?? "NULL", "cell")}
                      className={cn("max-w-[32rem] cursor-default truncate border-b border-r border-border px-2 py-0.5", isSelected && "bg-state-active ring-1 ring-inset ring-ring")}
                      title={value === null ? "NULL" : value.length > 200 ? `${value.slice(0, 200)}…` : value}
                    >
                      {value === null ? <span className="italic text-muted-foreground">NULL</span> : display(value, type)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center gap-3 border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <span>
          {formatCount(set.rows.length, "row")}
          {set.truncated ? <span className="ml-1 text-amber-600 dark:text-amber-400">(first {set.rows.length}; add a LIMIT or raise the row cap in settings)</span> : null}
        </span>
        <span>·</span>
        <span>{formatMs(durationMs)}</span>
        <span className="flex-1" />
        {selectedValue === undefined || selectedColumn === undefined ? (
          <span className="hidden sm:inline">Click a cell to inspect it, double-click to copy</span>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-medium text-foreground">{selectedColumn?.name}</span>
            <span className="min-w-0 max-w-[40rem] truncate font-mono" title={selectedValue ?? "NULL"}>
              {selectedValue === null ? "NULL" : selectedValue}
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-1.5" aria-label="Copy cell" onClick={() => void copy(selectedValue ?? "NULL", "cell")}>
              <Icon name="Copy" className="size-3.5" />
            </Button>
          </span>
        )}
        <ExportMenu set={set} connectionName={connectionName} />
      </footer>
    </div>
  );
}

export function Results({ run, sql, running, connectionName, onCancel }: ResultsProps) {
  if (running) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
        <Spinner className="size-5" />
        <span>Running…</span>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <Icon name="Square" className="size-3.5" />
          Cancel
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    );
  }
  if (run === null) {
    return (
      <div className="p-3">
        <EmptyState>
          Run a query with <Kbd>⌘↵</Kbd>, explain it with <Kbd>⇧⌘↵</Kbd>, or describe what you want above the editor.
        </EmptyState>
      </div>
    );
  }
  if (run.error !== null) return <ErrorPanel error={run.error} sql={sql} />;
  if (run.results.length === 0) {
    return (
      <div className="p-3">
        <EmptyState>Nothing to run.</EmptyState>
      </div>
    );
  }
  if (run.results.length === 1) return <Grid set={run.results[0]!} durationMs={run.durationMs} connectionName={connectionName} />;
  return (
    <Tabs defaultValue="0" className="flex h-full min-h-0 flex-col">
      <TabsList className="h-8 w-full justify-start rounded-none border-b border-border bg-transparent px-2">
        {run.results.map((set, index) => (
          <TabsTrigger key={index} value={String(index)} className="h-7 text-xs">
            {set.command}
            <span className="ml-1 text-muted-foreground">{set.columns.length === 0 ? `${set.rowCount ?? 0}` : set.rows.length}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {run.results.map((set, index) => (
        <TabsContent key={index} value={String(index)} className="mt-0 min-h-0 flex-1">
          <Grid set={set} durationMs={run.durationMs} connectionName={connectionName} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
