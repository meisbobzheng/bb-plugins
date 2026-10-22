import { useState } from "react";
import type { ExplainResult } from "../contract";
import { cn } from "../lib/utils";
import { EmptyState, ErrorPanel, formatMs } from "./bits";
import { Icon } from "./ui/icon";

type PlanNode = Record<string, unknown>;

function num(node: PlanNode, key: string): number | null {
  const value = node[key];
  return typeof value === "number" ? value : null;
}

function str(node: PlanNode, key: string): string | null {
  const value = node[key];
  return typeof value === "string" ? value : null;
}

function children(node: PlanNode): PlanNode[] {
  const plans = node.Plans;
  return Array.isArray(plans) ? (plans as PlanNode[]) : [];
}

export function nodeTime(node: PlanNode): number | null {
  const total = num(node, "Actual Total Time");
  const loops = num(node, "Actual Loops") ?? 1;
  return total === null ? null : total * loops;
}

export function selfTime(node: PlanNode): number | null {
  const total = nodeTime(node);
  if (total === null) return null;
  return Math.max(0, children(node).reduce((remaining, child) => remaining - (nodeTime(child) ?? 0), total));
}

export function rowEstimateRatio(node: PlanNode): number | null {
  const planned = num(node, "Plan Rows");
  const actual = num(node, "Actual Rows");
  if (planned === null || actual === null || planned === 0) return null;
  return (actual * (num(node, "Actual Loops") ?? 1)) / planned;
}

const CONDITION_KEYS = ["Index Cond", "Recheck Cond", "Hash Cond", "Merge Cond", "Join Filter", "Filter", "Sort Key", "Group Key", "One-Time Filter"] as const;
const LEGEND = "Bars show each node's own share of execution time; amber rows are off by more than 10× from the estimate.";

function title(node: PlanNode): string {
  const type = str(node, "Node Type") ?? "Node";
  const strategy = str(node, "Strategy");
  const join = str(node, "Join Type");
  const parts = [type];
  if (strategy !== null && strategy !== "Plain") parts.push(strategy);
  if (join !== null && join !== "Inner") parts.push(join);
  if (str(node, "Parallel Aware") === null && node["Parallel Aware"] === true) parts.push("(parallel)");
  return parts.join(" ");
}

function target(node: PlanNode): string | null {
  const relation = str(node, "Relation Name");
  const alias = str(node, "Alias");
  const index = str(node, "Index Name");
  const parts: string[] = [];
  if (relation !== null) parts.push(alias !== null && alias !== relation ? `${relation} AS ${alias}` : relation);
  if (index !== null) parts.push(`using ${index}`);
  const cte = str(node, "CTE Name");
  if (cte !== null) parts.push(`CTE ${cte}`);
  return parts.length === 0 ? null : parts.join(" ");
}

function Node({ node, depth, total }: { node: PlanNode; depth: number; total: number | null }) {
  const [open, setOpen] = useState(true);
  const kids = children(node);
  const self = selfTime(node);
  const share = self === null || total === null || total === 0 ? null : Math.min(1, self / total);
  const ratio = rowEstimateRatio(node);
  const misestimate = ratio !== null && (ratio > 10 || ratio < 0.1);
  const actualRows = num(node, "Actual Rows");
  return (
    <li>
      <div className="group relative flex items-start gap-1 py-1 pr-3 text-xs hover:bg-state-hover" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        {share === null ? null : <span aria-hidden className="absolute inset-y-0 left-0 bg-warning/10" style={{ width: `${Math.round(share * 100)}%` }} />}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn("relative mt-0.5 size-4 shrink-0 rounded text-muted-foreground hover:text-foreground", kids.length === 0 && "invisible")}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5" />
        </button>
        <div className="relative min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{title(node)}</span>
            {target(node) === null ? null : <span className="font-mono text-muted-foreground">{target(node)}</span>}
            <span className="flex-1" />
            {self === null ? (
              <span className="text-muted-foreground">cost {num(node, "Startup Cost")?.toFixed(2)}..{num(node, "Total Cost")?.toFixed(2)}</span>
            ) : (
              <span className="tabular-nums text-muted-foreground" title="Time in this node, excluding children, across all loops">
                {formatMs(self)}
                {share === null ? null : <span className="ml-1">({Math.round(share * 100)}%)</span>}
              </span>
            )}
            <span className={cn("tabular-nums", misestimate ? "text-warning-text" : "text-muted-foreground")} title="Rows: estimated → actual">
              rows {num(node, "Plan Rows")?.toLocaleString()}
              {actualRows === null ? null : ` → ${actualRows.toLocaleString()}`}
              {(num(node, "Actual Loops") ?? 1) > 1 ? ` ×${num(node, "Actual Loops")}` : null}
            </span>
          </div>
          {CONDITION_KEYS.map((key) => {
            const value = node[key];
            if (value === undefined) return null;
            const text = Array.isArray(value) ? value.join(", ") : String(value);
            return (
              <div key={key} className="truncate font-mono text-[11px] text-muted-foreground" title={text}>
                <span className="text-foreground/70">{key}:</span> {text}
              </div>
            );
          })}
        </div>
      </div>
      {open && kids.length > 0 ? (
        <ul>
          {kids.map((child, index) => (
            <Node key={index} node={child} depth={depth + 1} total={total} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function PlanView({ result, sql }: { result: ExplainResult; sql: string }) {
  if (result.error !== null) return <ErrorPanel error={result.error} sql={sql} />;
  const root = result.plan?.[0];
  const plan = root?.Plan;
  if (root === undefined || typeof plan !== "object" || plan === null) {
    return (
      <div className="p-3">
        <EmptyState>No plan returned.</EmptyState>
      </div>
    );
  }
  const execution = num(root, "Execution Time");
  const planning = num(root, "Planning Time");
  const total = execution ?? nodeTime(plan as PlanNode);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <ul>
          <Node node={plan as PlanNode} depth={0} total={total} />
        </ul>
      </div>
      <footer className="flex items-center gap-3 border-t border-border px-3 py-1 text-xs text-muted-foreground">
        {planning === null ? null : <span>planning {formatMs(planning)}</span>}
        {execution === null ? <span>estimated costs only; run Analyze for timings</span> : <span>execution {formatMs(execution)}</span>}
        <span className="flex-1" />
        <span className="min-w-0 truncate" title={LEGEND}>
          {LEGEND}
        </span>
      </footer>
    </div>
  );
}
