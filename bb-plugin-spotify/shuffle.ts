import type { PlannedTrack, ShuffleOptions, Track } from "./contract";
import type { TrackHistory } from "./store";

export const SESSION_LIMIT = 100;
const DAY_MS = 86_400_000;
const SPREAD_WINDOW = 8;

export interface Candidate {
  track: Track;
  history: TrackHistory | null;
}

export type Random = () => number;

export function isSkipProne(history: TrackHistory | null): boolean {
  return history !== null && history.plays >= 3 && history.skips / history.plays >= 0.6;
}

export function freshness(history: TrackHistory | null, now: number, freshDays: number): number {
  if (history === null) return 1.2;
  return Math.min(1.5, Math.max(0.15, (now - history.lastPlayedAt) / (freshDays * DAY_MS)));
}

export function freshReason(history: TrackHistory | null, now: number, freshDays: number): string | null {
  if (history === null) return "new to your history";
  const days = Math.floor((now - history.lastPlayedAt) / DAY_MS);
  return days >= freshDays ? `unheard for ${days} days` : null;
}

export function dedupe(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.track.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function weightedOrder<T>(items: readonly T[], weight: (item: T) => number, random: Random): T[] {
  return items
    .map((item) => ({ item, key: Math.pow(Math.max(random(), 1e-12), 1 / Math.max(weight(item), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.item);
}

const leadArtist = (track: Track) => track.artists[0]?.name.toLowerCase() ?? "";

export function spread<T>(items: readonly T[], trackOf: (item: T) => Track, window = SPREAD_WINDOW): T[] {
  const pending = [...items];
  const result: T[] = [];
  while (pending.length > 0) {
    const recentArtists = result.slice(-2).map((item) => leadArtist(trackOf(item)));
    const previous = result.length === 0 ? null : trackOf(result[result.length - 1]!);
    const window_ = pending.slice(0, window).map(trackOf);
    const differs = (track: Track) => previous === null || (leadArtist(track) !== leadArtist(previous) && track.album.id !== previous.album.id);
    const counts = new Map<string, number>();
    for (const item of pending) counts.set(leadArtist(trackOf(item)), (counts.get(leadArtist(trackOf(item))) ?? 0) + 1);
    const [heavy, heavyCount] = [...counts].reduce((top, entry) => (entry[1] > top[1] ? entry : top), ["", 0]);
    const forced = heavyCount * 2 > pending.length ? pending.findIndex((item) => leadArtist(trackOf(item)) === heavy && differs(trackOf(item))) : -1;
    const best = window_.findIndex((track) => differs(track) && !recentArtists.includes(leadArtist(track)));
    const fallback = window_.findIndex(differs);
    result.push(pending.splice(forced !== -1 ? forced : best !== -1 ? best : Math.max(fallback, 0), 1)[0]!);
  }
  return result;
}

export interface Plan {
  tracks: PlannedTrack[];
  dropped: number;
}

export function planShuffle(candidates: readonly Candidate[], options: ShuffleOptions, now: number, random: Random): Plan {
  const unique = dedupe(candidates);
  const kept = options.noSkips ? unique.filter((candidate) => !isSkipProne(candidate.history)) : unique;
  const ordered = weightedOrder(kept, (candidate) => (options.fresh ? freshness(candidate.history, now, options.freshDays) : 1), random);
  const shaped = options.spread ? spread(ordered, (candidate) => candidate.track) : ordered;
  return {
    tracks: shaped.slice(0, SESSION_LIMIT).map((candidate) => ({
      track: candidate.track,
      reason: options.fresh ? freshReason(candidate.history, now, options.freshDays) : null,
    })),
    dropped: unique.length - kept.length,
  };
}

export function applyVibeOrder(pool: readonly Candidate[], order: readonly { index: number; note: string | null }[], options: ShuffleOptions): PlannedTrack[] {
  const used = new Set<number>();
  const picked = order.flatMap(({ index, note }) => {
    if (used.has(index) || pool[index] === undefined) return [];
    used.add(index);
    return [{ track: pool[index]!.track, reason: note }];
  });
  return (options.spread ? spread(picked, (item) => item.track, 3) : picked).slice(0, SESSION_LIMIT);
}

export function seededRandom(seed: number): Random {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}
