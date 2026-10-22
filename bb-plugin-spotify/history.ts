import type { Playlist, Stats, Track } from "./contract";
import type { PlayRecord, PlayRow } from "./store";

export interface Observation {
  at: number;
  track: Track | null;
  progressMs: number;
  isPlaying: boolean;
  contextUri: string | null;
}

export interface Listening {
  track: Track;
  contextUri: string | null;
  startedAt: number;
  lastAt: number;
  lastProgress: number;
  maxProgress: number;
  listenedMs: number;
  wasPlaying: boolean;
}

const SLACK_MS = 3_000;
const DAY_MS = 86_400_000;

export function isSkip(listenedMs: number, maxProgress: number, durationMs: number): boolean {
  return listenedMs < Math.min(30_000, durationMs * 0.5) && maxProgress < durationMs - 10_000;
}

function finish(listening: Listening, endedAt: number): PlayRecord {
  return {
    track: listening.track,
    startedAt: listening.startedAt,
    endedAt,
    listenedMs: Math.round(listening.listenedMs),
    skipped: isSkip(listening.listenedMs, listening.maxProgress, listening.track.durationMs),
    contextUri: listening.contextUri,
    source: "observed",
  };
}

function start(observation: Observation & { track: Track }): Listening {
  return {
    track: observation.track,
    contextUri: observation.contextUri,
    startedAt: observation.at - observation.progressMs,
    lastAt: observation.at,
    lastProgress: observation.progressMs,
    maxProgress: observation.progressMs,
    listenedMs: observation.isPlaying ? observation.progressMs : 0,
    wasPlaying: observation.isPlaying,
  };
}

export function observe(current: Listening | null, observation: Observation): { next: Listening | null; finished: PlayRecord | null } {
  if (observation.track === null) return { next: null, finished: current === null ? null : finish(current, current.lastAt) };
  const observed = observation as Observation & { track: Track };
  if (current === null) return { next: start(observed), finished: null };
  if (current.track.id !== observation.track.id) return { next: start(observed), finished: finish(current, observation.at - observation.progressMs) };

  const elapsed = observation.at - current.lastAt;
  const delta = observation.progressMs - current.lastProgress;
  const restarted = observation.progressMs < 10_000 && current.lastProgress > current.track.durationMs - 15_000;
  if (restarted) return { next: start(observed), finished: finish(current, observation.at - observation.progressMs) };

  const counted = (current.wasPlaying || observation.isPlaying) && delta > 0 && delta <= elapsed + SLACK_MS ? delta : 0;
  return {
    next: {
      ...current,
      lastAt: observation.at,
      lastProgress: observation.progressMs,
      maxProgress: Math.max(current.maxProgress, observation.progressMs),
      listenedMs: current.listenedMs + counted,
      wasPlaying: observation.isPlaying,
    },
    finished: null,
  };
}

interface StatsInput {
  now: number;
  plays: readonly PlayRow[];
  tracks: ReadonlyMap<string, Track>;
  firstPlayAt: number | null;
  playlists: readonly Playlist[];
  contextsLastPlayed: ReadonlyMap<string, number>;
  utcOffsetMinutes?: number;
}

export function computeStats(input: StatsInput): Stats {
  const { now } = input;
  const recent = input.plays.filter((play) => play.endedAt >= now - 30 * DAY_MS);
  const listened = (since: number) => input.plays.filter((play) => play.endedAt >= since).reduce((sum, play) => sum + play.listenedMs, 0);

  const artists = new Map<string, { plays: number; listenedMs: number }>();
  const tracks = new Map<string, { plays: number; listenedMs: number }>();
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  const offset = (input.utcOffsetMinutes ?? -new Date(now).getTimezoneOffset()) * 60_000;

  for (const play of recent) {
    const track = input.tracks.get(play.trackId);
    const counted = play.skipped ? 0 : 1;
    const tally = tracks.get(play.trackId) ?? { plays: 0, listenedMs: 0 };
    tracks.set(play.trackId, { plays: tally.plays + counted, listenedMs: tally.listenedMs + play.listenedMs });
    for (const artist of track?.artists.slice(0, 1) ?? []) {
      const entry = artists.get(artist.name) ?? { plays: 0, listenedMs: 0 };
      artists.set(artist.name, { plays: entry.plays + counted, listenedMs: entry.listenedMs + play.listenedMs });
    }
    const local = new Date(play.startedAt + offset);
    byHour[local.getUTCHours()]! += play.listenedMs;
    byWeekday[local.getUTCDay()]! += play.listenedMs;
  }

  const rank = <T extends { plays: number; listenedMs: number }>(entries: T[]) => entries.sort((a, b) => b.listenedMs - a.listenedMs || b.plays - a.plays).slice(0, 10);
  const historyDays = input.firstPlayAt === null ? 0 : (now - input.firstPlayAt) / DAY_MS;
  const forgotten =
    historyDays < 14
      ? []
      : input.playlists
          .map((playlist) => ({ playlistId: playlist.id, name: playlist.name, lastPlayedAt: input.contextsLastPlayed.get(playlist.uri) ?? null }))
          .filter((entry) => entry.lastPlayedAt === null || entry.lastPlayedAt < now - 30 * DAY_MS)
          .sort((a, b) => (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0))
          .slice(0, 5);

  return {
    since: input.firstPlayAt,
    listenedMs7: listened(now - 7 * DAY_MS),
    listenedMs30: listened(now - 30 * DAY_MS),
    plays30: recent.filter((play) => !play.skipped).length,
    skipRate30: recent.length === 0 ? null : recent.filter((play) => play.skipped).length / recent.length,
    topArtists: rank([...artists].map(([name, entry]) => ({ name, ...entry }))),
    topTracks: rank(
      [...tracks].flatMap(([id, entry]) => {
        const track = input.tracks.get(id);
        return track === undefined ? [] : [{ name: track.name, track, ...entry }];
      }),
    ),
    byHour,
    byWeekday,
    forgotten,
  };
}
