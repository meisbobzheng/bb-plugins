import type { ReactElement, ReactNode } from "react";
import type { HistorySource, QueryError } from "../contract";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn("rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground", className)}>
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Icon name="Spinner" className={cn("size-4 animate-spin", className)} aria-hidden />;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("rounded border border-border bg-muted px-1 font-sans text-[10px] text-muted-foreground", className)}>{children}</kbd>;
}

export function formatMs(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatCount(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

export function prettyType(type: string): string {
  return type.startsWith("_") ? `${type.slice(1)}[]` : type;
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

const SOURCE_LABELS: Record<HistorySource, string> = { editor: "Editor", ask: "Ask", agent: "Agent", cli: "CLI" };

export function SourceBadge({ source }: { source: HistorySource }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded px-1 text-[10px] font-semibold uppercase tracking-wide",
        source === "ask" ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : source === "agent" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-muted text-muted-foreground",
      )}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

export function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
  pressed,
  className,
  children,
}: {
  label: string;
  icon: string;
  onClick(): void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Hint label={label}>
      <Button size="sm" variant="ghost" className={cn("h-7 gap-1.5 px-2 text-xs", className)} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
        <Icon name={icon} className="size-3.5" />
        {children}
      </Button>
    </Hint>
  );
}

export function Hint({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const ERROR_TITLES: Record<QueryError["kind"], string> = {
  sql: "Query failed",
  auth: "Authentication failed",
  connection: "Could not connect",
  cancelled: "Cancelled",
  timeout: "Timed out",
  refused: "Refused",
};

export function positionToLine(sql: string, position: number | null): string | null {
  if (position === null || position < 1 || position > sql.length + 1) return null;
  const before = sql.slice(0, position - 1);
  const line = before.split("\n").length;
  const column = position - (before.lastIndexOf("\n") + 1);
  return `line ${line}, column ${column}`;
}

const RETRYABLE: ReadonlySet<QueryError["kind"]> = new Set(["auth", "connection", "timeout"]);

export function ErrorPanel({ error, sql, onRetry }: { error: QueryError; sql: string; onRetry?(): void }) {
  const where = positionToLine(sql, error.position);
  return (
    <div role="alert" className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium text-destructive-text">
        <Icon name="AlertCircle" className="size-4" aria-hidden />
        {ERROR_TITLES[error.kind]}
        {error.code === null ? null : <span className="font-mono text-xs font-normal text-muted-foreground">{error.code}</span>}
        {where === null ? null : <span className="text-xs font-normal text-muted-foreground">at {where}</span>}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{error.message}</p>
      {error.detail === null ? null : <p className="mt-1 text-xs text-muted-foreground">{error.detail}</p>}
      {error.hint === null ? null : <p className="mt-1 text-xs text-muted-foreground">Hint: {error.hint}</p>}
      {onRetry === undefined || !RETRYABLE.has(error.kind) ? null : (
        <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={onRetry}>
          <Icon name="RotateCcw" className="size-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}

export function Confirm({
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="text-sm text-muted-foreground">{body}</div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
