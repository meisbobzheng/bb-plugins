import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  on: "text-foreground",
  off: "text-muted-foreground",
  warn: "text-destructive",
} as const;

export function ValueBadge({ children, tone = "off" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return (
    <span className={cn("inline-block max-w-40 truncate rounded border border-border px-1.5 py-px text-[11px]", TONES[tone])}>
      {children}
    </span>
  );
}

export function Toggle({ on }: { on: boolean }) {
  return (
    <span
      role="img"
      aria-label={on ? "On" : "Off"}
      className={cn(
        "relative inline-flex h-4 w-7 items-center rounded-full transition-colors",
        on ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "absolute size-3 rounded-full bg-background shadow-sm transition-transform",
          on ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </span>
  );
}
