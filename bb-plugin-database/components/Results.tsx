import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { experimental_copyToClipboard as copyToClipboard } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { QueryRun, ResultSet } from "../contract";
import { cn } from "../lib/utils";
import { EmptyState, ErrorPanel, Kbd, Spinner, formatCount, formatMs, prettyType } from "./bits";
import { downloadText, exportFilename, toCsv, toJson, toMarkdown } from "./export";
import { useElapsed } from "./hooks";
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
  onRetry(): void;
}

interface Cell {
  row: number;
  column: number;
}

const BOOLEAN_TYPES = new Set(["bool"]);
const ROW_ESTIMATE = 21;
const OVERSCAN = 30;
const WIDTH_CAP = 60;
const CELL_CHROME_PX = 17;
const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

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

export function columnWidths(set: ResultSet, cap = WIDTH_CAP): number[] {
  return set.columns.map((column, index) => {
    let widest = column.name.length + prettyType(column.type).length + 1;
    for (const row of set.rows) {
      if (widest >= cap) break;
      const value = row[index];
      widest = Math.max(widest, value === null || value === undefined ? 4 : display(value, column.type).length);
    }
    return Math.min(widest, cap);
  });
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function Grid({ set, durationMs, connectionName }: { set: ResultSet; durationMs: number; connectionName: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const rowHeight = useRef(ROW_ESTIMATE);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [range, setRange] = useState({ start: 0, end: OVERSCAN * 3 });
  const widths = useMemo(() => columnWidths(set), [set]);
  const selectedValue = selected === null ? undefined : set.rows[selected.row]?.[selected.column];
  const selectedColumn = selected === null ? null : set.columns[selected.column];

  const measure = useCallback(() => {
    const element = scroller.current;
    if (element === null) return;
    const first = Math.floor(element.scrollTop / rowHeight.current);
    const start = Math.max(0, Math.floor(first / OVERSCAN) * OVERSCAN - OVERSCAN);
    const end = Math.min(set.rows.length, start + Math.ceil(element.clientHeight / rowHeight.current) + OVERSCAN * 3);
    setRange((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, [set.rows.length]);

  useLayoutEffect(() => {
    const height = scroller.current?.querySelector("tbody tr[data-row]")?.getBoundingClientRect().height ?? 0;
    if (height > 0) rowHeight.current = height;
    measure();
  }, [measure]);

  useEffect(() => {
    const element = scroller.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  const reveal = ({ row, column }: Cell) => {
    const element = scroller.current;
    if (element === null) return;
    const header = element.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const top = row * rowHeight.current;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (header + top + rowHeight.current > element.scrollTop + element.clientHeight) element.scrollTop = header + top + rowHeight.current - element.clientHeight;
    const cell = element.querySelector<HTMLElement>(`tr[data-row="${row}"] > td[data-column="${column}"]`);
    const pinned = element.querySelector<HTMLElement>("thead th")?.offsetWidth ?? 0;
    if (cell === null) return;
    if (cell.offsetLeft < element.scrollLeft + pinned) element.scrollLeft = cell.offsetLeft - pinned;
    else if (cell.offsetLeft + cell.offsetWidth > element.scrollLeft + element.clientWidth) element.scrollLeft = cell.offsetLeft + cell.offsetWidth - element.clientWidth;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[event.key];
    if (move !== undefined && set.rows.length > 0) {
      event.preventDefault();
      const next = selected === null ? { row: 0, column: 0 } : { row: clamp(selected.row + move[0], set.rows.length - 1), column: clamp(selected.column + move[1], set.columns.length - 1) };
      setSelected(next);
      reveal(next);
    } else if (event.key === "Escape" && selected !== null) {
      setSelected(null);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && selectedValue !== undefined && (window.getSelection()?.toString() ?? "") === "") {
      event.preventDefault();
      void copy(selectedValue ?? "NULL", "cell");
    }
  };

  if (set.columns.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <EmptyState className="m-3">
          <span className="font-medium text-foreground">{set.command}</span> affected {formatCount(set.rowCount ?? 0, "row")} in {formatMs(durationMs)}.
        </EmptyState>
      </div>
    );
  }

  const numberWidth = String(set.rows.length).length + 1;
  const spacer = (rows: number) => (
    <tr aria-hidden style={{ height: rows * rowHeight.current }}>
      <td colSpan={set.columns.length + 1} className="p-0" />
    </tr>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} role="region" tabIndex={0} aria-label="Query results" onScroll={measure} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
        <table
          className="table-fixed border-separate border-spacing-0 font-mono text-xs"
          style={{ width: `calc(${widths.reduce((total, width) => total + width, numberWidth)}ch + ${(widths.length + 1) * CELL_CHROME_PX}px)`, minWidth: "100%" }}
        >
          <colgroup>
            <col style={{ width: `calc(${numberWidth}ch + ${CELL_CHROME_PX}px)` }} />
            {widths.map((width, index) => (
              <col key={index} style={{ width: `calc(${width}ch + ${CELL_CHROME_PX}px)` }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 border-b border-r border-border bg-card px-2 py-1 text-right font-normal text-muted-foreground">#</th>
              {set.columns.map((column, index) => (
                <th key={index} className="truncate border-b border-r border-border bg-card px-2 py-1 text-left font-semibold" title={`${column.name} ${prettyType(column.type)}`}>
                  {column.name}
                  <span className="ml-1.5 font-normal text-muted-foreground">{prettyType(column.type)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {range.start > 0 ? spacer(range.start) : null}
            {set.rows.slice(range.start, range.end).map((row, offset) => {
              const rowIndex = range.start + offset;
              return (
                <tr key={rowIndex} data-row={rowIndex} className="hover:bg-state-hover">
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-2 py-0.5 text-right text-muted-foreground">{rowIndex + 1}</td>
                  {row.map((value, columnIndex) => {
                    const isSelected = selected?.row === rowIndex && selected.column === columnIndex;
                    const type = set.columns[columnIndex]?.type ?? "";
                    return (
                      <td
                        key={columnIndex}
                        data-column={columnIndex}
                        onClick={() => setSelected({ row: rowIndex, column: columnIndex })}
                        onDoubleClick={() => void copy(value ?? "NULL", "cell")}
                        className={cn("cursor-default truncate border-b border-r border-border px-2 py-0.5", isSelected && "bg-state-active ring-1 ring-inset ring-ring")}
                        title={value === null ? "NULL" : value.length > 200 ? `${value.slice(0, 200)}…` : value}
                      >
                        {value === null ? <span className="italic text-muted-foreground">NULL</span> : display(value, type)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {range.end < set.rows.length ? spacer(set.rows.length - range.end) : null}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center gap-3 border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <span>
          {formatCount(set.rows.length, "row")}
          {set.truncated ? <span className="ml-1 text-warning-text">(first {set.rows.length}; add a LIMIT or raise the row cap in settings)</span> : null}
        </span>
        <span>·</span>
        <span>{formatMs(durationMs)}</span>
        <span className="flex-1" />
        {selectedValue === undefined || selectedColumn === undefined ? (
          <span className="hidden sm:inline">Click a cell to inspect it; arrow keys move, double-click or ⌘C copies</span>
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

export function Results({ run, sql, running, connectionName, onCancel, onRetry }: ResultsProps) {
  const elapsed = useElapsed(running);
  const label = `Running…${elapsed < 1_000 ? "" : ` ${Math.floor(elapsed / 1_000)} s`}`;
  const previous = run !== null && run.error === null && run.results.length > 0 ? run : null;
  if (running && previous === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
        <Spinner className="size-5" />
        <span>{label}</span>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <Icon name="Square" className="size-3.5" />
          Cancel
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    );
  }
  if (running && previous !== null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div role="status" className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          <span>{label}</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" onClick={onCancel}>
            <Icon name="Square" className="size-3" />
            Cancel
            <Kbd>Esc</Kbd>
          </Button>
        </div>
        <div aria-busy className="min-h-0 flex-1 opacity-60">
          <ResultSets run={previous} connectionName={connectionName} />
        </div>
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
  if (run.error !== null) return <ErrorPanel error={run.error} sql={sql} onRetry={onRetry} />;
  if (run.results.length === 0) {
    return (
      <div className="p-3">
        <EmptyState>Nothing to run.</EmptyState>
      </div>
    );
  }
  return <ResultSets run={run} connectionName={connectionName} />;
}

function ResultSets({ run, connectionName }: { run: QueryRun; connectionName: string }) {
  if (run.results.length === 1) return <Grid key={run.id} set={run.results[0]!} durationMs={run.durationMs} connectionName={connectionName} />;
  return (
    <Tabs key={run.id} defaultValue="0" className="flex h-full min-h-0 flex-col">
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
