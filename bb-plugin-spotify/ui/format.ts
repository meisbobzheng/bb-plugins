import type { Track } from "../contract";

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function hours(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const value = totalMinutes / 60;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} hr`;
}

export function playlistLength(tracks: readonly Track[]): string {
  const totalMinutes = Math.round(tracks.reduce((sum, track) => sum + track.durationMs, 0) / 60_000);
  return totalMinutes < 60 ? `${totalMinutes} min` : `${Math.floor(totalMinutes / 60)} hr ${totalMinutes % 60} min`;
}

export const artists = (track: Track) => track.artists.map((artist) => artist.name).join(", ");

export const trackUrl = (track: Track) => track.url ?? `https://open.spotify.com/track/${track.id}`;

export function daysAgo(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function monthDay(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}
