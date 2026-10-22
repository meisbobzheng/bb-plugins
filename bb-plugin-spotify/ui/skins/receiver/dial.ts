import { LIKED_ID, type Playlist, type ShuffleOptions } from "../../../contract";

export const KNOB = ["off", "spread", "fresh", "vibe"] as const;
export type KnobMode = (typeof KNOB)[number];

export const MODES = ["tracks", "stats", "history", "search"] as const;
export type Mode = (typeof MODES)[number];

export const FRESH_DAYS = [7, 14, 30, 60, 90, 180, 365];

export function stationsOf(playlists: readonly Playlist[] | null): Playlist[] {
  const rank = (entry: Playlist) => (entry.id === LIKED_ID ? 0 : entry.readable ? 1 : 2);
  return [...(playlists ?? [])].sort((a, b) => rank(a) - rank(b));
}

export function bandSize(width: number, count: number): number {
  const most = Math.max(3, Math.min(10, Math.floor(width / 112)));
  return Math.max(1, Math.ceil(count / Math.max(1, Math.ceil(count / most))));
}

export const wrap = (index: number, length: number) => ((index % length) + length) % length;

export const slotAt = (slot: number, size: number) => (slot + 0.5) / size;

export function needleAt(index: number, band: number, size: number): number {
  if (index < 0) return 0;
  const home = Math.floor(index / size);
  if (home !== band) return home < band ? 0 : 1;
  return slotAt(index % size, size);
}

export function knobOf(options: ShuffleOptions): KnobMode {
  if (options.vibe) return "vibe";
  if (options.fresh) return "fresh";
  return options.spread ? "spread" : "off";
}

export function knobPatch(mode: KnobMode, vibe: string): Partial<ShuffleOptions> {
  return { spread: mode !== "off", fresh: mode === "fresh" || mode === "vibe", vibe: mode === "vibe" ? vibe : null };
}

export function knobText(mode: KnobMode, options: ShuffleOptions, vibe: string): string {
  if (mode === "off") return "Plain shuffle · no smart rules";
  if (mode === "spread") return "Spread · no artist or album twice in a row";
  if (mode === "fresh") return `Fresh · favors songs unheard for ${options.freshDays} days`;
  return `Vibe · "${vibe}"`;
}

export function stepDays(days: number, delta: 1 | -1): number {
  const next = delta > 0 ? FRESH_DAYS.find((value) => value > days) : [...FRESH_DAYS].reverse().find((value) => value < days);
  return next ?? days;
}
