import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Spend } from "./spend";
import type { ContextUsage, PlanUsage } from "./sources";

export interface MeterData {
  context: ContextUsage | null;
  spend: Spend | null;
  plan: PlanUsage | null;
}

const tokenFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const usdFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

const formatTokens = (tokens: number) => tokenFormat.format(tokens);

function percentOf(used: number, total: number) {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function toneClass(percent: number) {
  if (percent >= 90) return "text-destructive";
  if (percent >= 75) return "text-warning-text";
  return "text-muted-foreground";
}

function formatResetsIn(resetsAt: string, now: number) {
  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function Ring({ percent }: { percent: number }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(percent, 100) / 100);
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden="true">
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

function Bar({ percent }: { percent: number }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", toneClass(percent))}>
      <div className="h-full rounded-full bg-current" style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", strong && "font-medium")}>
      <span className={cn("min-w-0 truncate", !strong && "text-muted-foreground")}>{label}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

function ContextSection({ context }: { context: ContextUsage }) {
  const percent = percentOf(context.usedTokens, context.modelContextWindow);
  const autoCompactAt = context.snapshot?.autoCompactAtTokens;
  return (
    <Section title={context.estimated ? "Context (estimated)" : "Context"}>
      <Row
        label={`${percent}% used`}
        value={`${formatTokens(context.usedTokens)} / ${formatTokens(context.modelContextWindow)}`}
      />
      <Bar percent={percent} />
      {autoCompactAt ? <Row label="Auto-compacts at" value={formatTokens(autoCompactAt)} /> : null}
    </Section>
  );
}

function SpendSection({ spend }: { spend: Spend }) {
  const priced = spend.turns > spend.unpricedTurns;
  return (
    <Section title="Tokens">
      <Row label="Input" value={formatTokens(spend.input)} />
      <Row label="Cache read" value={formatTokens(spend.cacheRead)} />
      <Row label="Cache write" value={formatTokens(spend.cacheWrite)} />
      <Row label="Output" value={formatTokens(spend.output)} />
      <Row label="API-equivalent cost" value={priced ? usdFormat.format(spend.costUsd) : "—"} strong />
      {spend.unpricedTurns > 0 ? (
        <p className="text-xs text-muted-foreground">
          {spend.unpricedTurns} of {spend.turns} turns used a model without a known price.
        </p>
      ) : null}
    </Section>
  );
}

function PlanSection({ plan }: { plan: PlanUsage }) {
  const now = Date.now();
  return (
    <Section title={plan.planLabel ? `Plan usage · ${plan.planLabel}` : "Plan usage"}>
      {plan.windows.map((window) => (
        <div key={window.id} className="space-y-1">
          <Row
            label={window.label}
            value={
              window.resetsAt
                ? `${Math.round(window.usedPercent)}% · resets in ${formatResetsIn(window.resetsAt, now)}`
                : `${Math.round(window.usedPercent)}%`
            }
          />
          <Bar percent={window.usedPercent} />
        </div>
      ))}
    </Section>
  );
}

export function ThreadMeterView({ context, spend, plan }: MeterData) {
  if (!context && !spend?.turns && !plan?.windows.length) return null;
  const contextPercent = context ? percentOf(context.usedTokens, context.modelContextWindow) : null;
  const planPercent = plan?.windows.length
    ? Math.round(Math.max(...plan.windows.map((window) => window.usedPercent)))
    : null;
  const showCost = spend !== null && spend.turns > spend.unpricedTurns;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-2 px-2 text-xs font-normal tabular-nums text-muted-foreground"
          aria-label="Context, token cost, and plan usage"
        >
          {contextPercent !== null ? (
            <span className={cn("flex items-center gap-1", toneClass(contextPercent))}>
              <Ring percent={contextPercent} />
              {contextPercent}%
            </span>
          ) : null}
          {showCost ? <span>{usdFormat.format(spend.costUsd)}</span> : null}
          {planPercent !== null ? (
            <span className={toneClass(planPercent)}>{planPercent}% plan</span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 text-sm" mobileTitle="Thread usage">
        {context ? <ContextSection context={context} /> : null}
        {spend?.turns ? <SpendSection spend={spend} /> : null}
        {plan?.windows.length ? <PlanSection plan={plan} /> : null}
      </PopoverContent>
    </Popover>
  );
}
