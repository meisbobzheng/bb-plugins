export const STATE_CHANGED = "launcher-state-changed";
export const MAX_USAGE_ENTRIES = 400;

export interface Usage {
  count: number;
  lastUsedAt: number;
}

export interface LauncherState {
  pinnedProjectIds: string[];
  usage: Record<string, Usage>;
}

export const EMPTY_STATE: LauncherState = { pinnedProjectIds: [], usage: {} };

const HOUR = 3_600_000;
const RECENCY_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [4 * HOUR, 100],
  [24 * HOUR, 80],
  [72 * HOUR, 60],
  [168 * HOUR, 40],
  [720 * HOUR, 20],
];

export function frecency(usage: Usage | undefined, now: number): number {
  if (usage === undefined) return 0;
  const age = now - usage.lastUsedAt;
  const weight = RECENCY_BUCKETS.find(([limit]) => age < limit)?.[1] ?? 10;
  return usage.count * weight;
}

export function recordUsage(
  usage: Record<string, Usage>,
  key: string,
  now: number,
): Record<string, Usage> {
  const next = {
    ...usage,
    [key]: { count: (usage[key]?.count ?? 0) + 1, lastUsedAt: now },
  };
  const keys = Object.keys(next);
  if (keys.length <= MAX_USAGE_ENTRIES) return next;
  const kept = keys
    .sort((a, b) => frecency(next[b], now) - frecency(next[a], now))
    .slice(0, MAX_USAGE_ENTRIES);
  return Object.fromEntries(kept.map((id) => [id, next[id]!]));
}
