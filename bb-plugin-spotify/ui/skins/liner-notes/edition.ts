import type { DuckState, Play, Playlist, ShuffleSession, Stats, Track } from "../../../contract";
import { daysAgo } from "../../format";
import type { SpotifyData } from "../../model";

export interface Side {
  label: string;
  tracks: Track[];
  durationMs: number;
}

export type Phrase = { text: string; em?: boolean }[];

const NUMERALS: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function roman(value: number): string {
  let rest = Math.max(1, Math.floor(value));
  return NUMERALS.reduce((text, [size, glyph]) => {
    const count = Math.floor(rest / size);
    rest -= count * size;
    return text + glyph.repeat(count);
  }, "");
}

export function issueLine(date: Date): string {
  const dayOfYear = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86_400_000);
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "long" });
  return `Vol. ${roman(date.getFullYear() % 100)} · No. ${dayOfYear} · ${weekday}, ${date.getDate()} ${month} ${date.getFullYear()}`;
}

const total = (tracks: readonly Track[]) => tracks.reduce((sum, track) => sum + track.durationMs, 0);

export function sides(tracks: readonly Track[], minimum = 12): Side[] {
  const length = total(tracks);
  if (tracks.length < minimum) return [{ label: "A", tracks: [...tracks], durationMs: length }];
  let cut = 1;
  let elapsed = 0;
  let best = Infinity;
  tracks.slice(0, -1).forEach((track, index) => {
    elapsed += track.durationMs;
    const gap = Math.abs(elapsed - length / 2);
    if (gap < best) [best, cut] = [gap, index + 1];
  });
  const [a, b] = [tracks.slice(0, cut), tracks.slice(cut)];
  return [
    { label: "A", tracks: a, durationMs: total(a) },
    { label: "B", tracks: b, durationMs: total(b) },
  ];
}

export function contents(playlists: readonly Playlist[] | null, query: string): { yours: Playlist[]; followed: Playlist[]; order: Playlist[] } {
  const needle = query.trim().toLowerCase();
  const matched = (playlists ?? []).filter((entry) => needle === "" || entry.name.toLowerCase().includes(needle));
  const yours = matched.filter((entry) => entry.readable);
  const followed = matched.filter((entry) => !entry.readable);
  return { yours, followed, order: [...yours, ...followed] };
}

export const songs = (count: number) => `${count.toLocaleString()} ${count === 1 ? "song" : "songs"}`;

export const sentence = (text: string) => (/[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

export const quoted = (title: string) => `“${sentence(title)}”`;

export function runtime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds} s` : `${minutes} min ${seconds % 60} s`;
}

export function listened(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export function ago(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hr ago` : daysAgo(at, now);
}

const times = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`);

export function credits(track: Track, liked: boolean | null, stats: Stats | null, recent: readonly Play[], now = Date.now()): string[] {
  const plays = stats?.topTracks.find((entry) => entry.track.id === track.id)?.plays;
  const last = recent.find((play) => play.track.id === track.id);
  return [
    runtime(track.durationMs),
    track.explicit ? "Explicit" : null,
    liked ? "Kept in Liked Songs" : null,
    plays ? `Played ${times(plays)} this month` : null,
    last ? `Last heard ${ago(last.endedAt, now)}` : null,
  ].filter((part): part is string => part !== null);
}

export function kicker(data: SpotifyData): string {
  const { player, selection } = data;
  const track = player.track;
  if (track === null) return player.status === "no-device" ? "Off the air — no device" : "Nothing on the turntable";
  const verb = player.isPlaying ? "Now playing" : "Paused";
  const playing = selection.playlist !== null && selection.playlist.uri === player.context?.uri ? selection.tracks : null;
  const index = playing?.findIndex((entry) => entry.id === track.id) ?? -1;
  if (index >= 0) return `${verb} — track ${index + 1} of ${playing!.length}, ${selection.playlist!.name}`;
  return player.context?.name ? `${verb} — from ${player.context.name}` : verb;
}

export function prose(stats: Stats | null, now = Date.now()): Phrase {
  if (stats === null) return [{ text: "Tallying your listening…" }];
  if (stats.since === null) return [{ text: "No history yet. Liner Notes keeps a record of what you play while bb is running." }];
  const top = stats.topArtists[0];
  const phrase: Phrase =
    stats.listenedMs30 > 0
      ? [{ text: "This month you listened for " }, { text: listened(stats.listenedMs30), em: true }, ...(top ? [{ text: ", mostly " }, { text: top.name, em: true }] : []), { text: "." }]
      : [{ text: "Nothing played this month yet." }];
  const dusty = stats.forgotten[0];
  if (dusty === undefined) return phrase;
  if (dusty.lastPlayedAt === null) return [...phrase, { text: " " }, { text: dusty.name, em: true }, { text: " hasn't played here yet." }];
  const when = now - dusty.lastPlayedAt > 300 * 86_400_000 ? "last year" : new Date(dusty.lastPlayedAt).toLocaleDateString("en-US", { month: "long" });
  return [...phrase, { text: " You haven't played " }, { text: dusty.name, em: true }, { text: ` since ${when}.` }];
}

export function peakHour(byHour: readonly number[]): string | null {
  const max = Math.max(...byHour);
  if (!(max > 0)) return null;
  const hour = byHour.indexOf(max);
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return `${hour % 12} ${hour < 12 ? "a.m." : "p.m."}`;
}

const WINDOWS = [7, 14, 30, 60, 90, 180, 365];

export const nextWindow = (days: number) => WINDOWS.find((value) => value > days) ?? WINDOWS[0]!;

export function sessionNote(session: ShuffleSession | null): string | null {
  if (session === null) return null;
  const dropped = session.dropped === 0 ? "no skip-prone songs left out" : `${session.dropped} skip-prone ${session.dropped === 1 ? "song" : "songs"} left out`;
  const base = `Dealt ${session.tracks.length} from ${session.sourceName}; ${dropped}.`;
  return session.vibeError === null ? base : `${base} The shape couldn't be read (${session.vibeError}), so this is a plain smart shuffle.`;
}

export function duckNote(duck: DuckState): string | null {
  if (!duck.active) return null;
  const verb = duck.mode === "pause" ? "Paused" : "Lowered";
  if (duck.threads.length === 0) return `${verb} while an agent waits on you.`;
  const titles = new Intl.ListFormat("en", { type: "conjunction" }).format(duck.threads.map((thread) => `“${thread.title}”`));
  return `${verb} for ${titles}, waiting on you.`;
}
