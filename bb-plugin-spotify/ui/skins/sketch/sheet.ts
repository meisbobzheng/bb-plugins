import type { DuckState, Playlist } from "../../../contract";

export type Layout = "full" | "compact" | "tight";

export function layoutFor({ width, height }: { width: number; height: number }): Layout {
  if (width === 0) return "full";
  if (width >= 900 && height >= 560) return "full";
  return width >= 540 ? "compact" : "tight";
}

export function tagFor(reason: string | null, vibe: boolean): "fresh" | "vibe" | "spread" | null {
  if (reason === null) return null;
  if (/^(unheard|new to)/.test(reason)) return "fresh";
  return vibe ? "vibe" : "spread";
}

export function vibeEnds(vibe: string | null): [string, string] {
  const text = vibe?.trim() ?? "";
  const arc = /(?:start|begin|open)\w*\s+(?:with\s+|on\s+)?([\w'-]+).*?(?:end|finish|close)\w*\s+(?:with\s+|on\s+)?([\w'-]+)/i.exec(text) ?? /([\w'-]+)\s*(?:→|->|to|into)\s*(?:an?\s+|the\s+)?([\w'-]+)/i.exec(text);
  return arc === null ? ["now", "later"] : [arc[1]!.toLowerCase(), arc[2]!.toLowerCase()];
}

export function duckLine(duck: DuckState): string | null {
  if (!duck.active) return null;
  const titles = duck.threads.map((thread) => `'${thread.title}'`);
  const who = titles.length === 0 ? "an agent needs you" : `${titles.length === 1 ? "thread " : ""}${titles.slice(0, 2).join(", ")}${titles.length > 2 ? ` +${titles.length - 2}` : ""} ${titles.length === 1 ? "needs" : "need"} you`;
  return `♪ ${duck.mode === "pause" ? "paused" : "lowered"} · ${who}`;
}

const FRESH_STEPS = [7, 14, 30, 60, 90, 180, 365] as const;

export const nextDays = (days: number): number => FRESH_STEPS.find((value) => value > days) ?? FRESH_STEPS[0];

export function stamp(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${two(date.getFullYear() % 100)}`;
}

export const revision = (palette: string, palettes: readonly string[]): string => String.fromCharCode(65 + Math.max(0, palettes.indexOf(palette)));

export const weekBars = (byWeekday: readonly number[]): number[] => [...byWeekday.slice(1), byWeekday[0] ?? 0];

export const fractionAt = (clientX: number, left: number, width: number): number => (width > 0 ? Math.min(1, Math.max(0, (clientX - left) / width)) : 0);

export function ordered(playlists: Playlist[] | null, query: string): Playlist[] {
  const needle = query.trim().toLowerCase();
  const matched = (playlists ?? []).filter((entry) => needle === "" || entry.name.toLowerCase().includes(needle));
  return [...matched.filter((entry) => entry.readable), ...matched.filter((entry) => !entry.readable)];
}

export function playlistMeta(playlist: Playlist): string {
  const who = playlist.kind === "liked" ? "all your hearts" : !playlist.readable ? "followed · play only" : playlist.collaborative ? "drawn together" : playlist.ownedByMe ? "by you" : `by ${playlist.owner}`;
  return `${playlist.kind === "liked" ? "collection" : "playlist"} · ${who} · ${playlist.trackCount.toLocaleString()} tracks`;
}
