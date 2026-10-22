import type { Person, Severity } from "../contract";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";

export function Avatar({ person, className, title }: { person: Person; className?: string; title?: string }) {
  if (person.avatarUrl === null) {
    return (
      <span
        className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] uppercase", className)}
        title={title ?? person.login}
        aria-hidden
      >
        {person.login.slice(0, 1)}
      </span>
    );
  }
  return <img src={person.avatarUrl} alt="" title={title ?? person.login} className={cn("size-4 shrink-0 rounded-full", className)} />;
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

export const SEVERITY_STYLES: Record<Severity, string> = {
  blocker: "bg-destructive/15 text-destructive-text",
  major: "bg-warning/20 text-warning-text",
  minor: "bg-attention/20 text-foreground",
  nit: "bg-muted text-muted-foreground",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={cn("inline-flex h-4 shrink-0 items-center rounded px-1 text-[10px] font-semibold uppercase tracking-wide", SEVERITY_STYLES[severity])}>
      {severity}
    </span>
  );
}

export function lineLabel(startLine: number | null, endLine: number | null): string {
  if (startLine === null || endLine === null) return "";
  return startLine === endLine ? `L${startLine}` : `L${startLine}–${endLine}`;
}

export function ToolbarToggle({
  pressed,
  label,
  icon,
  showLabel,
  disabled = false,
  onClick,
}: {
  pressed: boolean;
  label: string;
  icon: string;
  showLabel: boolean;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      aria-pressed={pressed}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} className="size-3.5" />
      {showLabel ? label : null}
    </Button>
  );
}
