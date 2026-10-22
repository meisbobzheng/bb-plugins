import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { trackSchema, type Track } from "./contract";
import type { Tokens } from "./spotify/auth";
import type { TokenStore } from "./spotify/client";

export interface PlayRecord {
  track: Track;
  startedAt: number;
  endedAt: number;
  listenedMs: number;
  skipped: boolean;
  contextUri: string | null;
  source: "observed" | "recent";
}

export interface PlayRow {
  trackId: string;
  startedAt: number;
  endedAt: number;
  listenedMs: number;
  durationMs: number;
  skipped: boolean;
  contextUri: string | null;
}

export interface TrackHistory {
  plays: number;
  skips: number;
  lastPlayedAt: number;
}

interface AuthRow {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  user_id: string;
  user_name: string | null;
  client_id: string;
}

interface PlayDbRow {
  track_id: string;
  started_at: number;
  ended_at: number;
  listened_ms: number;
  duration_ms: number;
  skipped: number;
  context_uri: string | null;
}

const MIGRATIONS = [
  `CREATE TABLE auth (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     access_token TEXT NOT NULL,
     refresh_token TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     scope TEXT NOT NULL,
     user_id TEXT NOT NULL,
     user_name TEXT,
     client_id TEXT NOT NULL,
     connected_at INTEGER NOT NULL
   )`,
  `CREATE TABLE tracks (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE plays (
     id INTEGER PRIMARY KEY,
     track_id TEXT NOT NULL,
     started_at INTEGER NOT NULL,
     ended_at INTEGER NOT NULL,
     listened_ms INTEGER NOT NULL,
     duration_ms INTEGER NOT NULL,
     skipped INTEGER NOT NULL,
     context_uri TEXT,
     source TEXT NOT NULL
   )`,
  `CREATE INDEX plays_track ON plays (track_id, ended_at)`,
  `CREATE INDEX plays_ended ON plays (ended_at)`,
  `CREATE TABLE playlist_cache (playlist_id TEXT PRIMARY KEY, version TEXT NOT NULL, json TEXT NOT NULL, fetched_at INTEGER NOT NULL)`,
];

function toPlay(row: PlayDbRow): PlayRow {
  return {
    trackId: row.track_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    listenedMs: row.listened_ms,
    durationMs: row.duration_ms,
    skipped: row.skipped === 1,
    contextUri: row.context_uri,
  };
}

export function createStore(storage: BbPluginApi["storage"], now: () => number = Date.now) {
  const db = storage.database();
  storage.migrate(db, MIGRATIONS);

  const selectAuth = db.prepare<[], AuthRow>("SELECT access_token, refresh_token, expires_at, scope, user_id, user_name, client_id FROM auth WHERE id = 1");
  const upsertTrack = db.prepare("INSERT INTO tracks (id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at");
  const selectTrack = db.prepare<[string], { json: string }>("SELECT json FROM tracks WHERE id = ?");
  const insertPlay = db.prepare(
    "INSERT INTO plays (track_id, started_at, ended_at, listened_ms, duration_ms, skipped, context_uri, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const playColumns = "track_id, started_at, ended_at, listened_ms, duration_ms, skipped, context_uri";
  const selectPlaysSince = db.prepare<[number], PlayDbRow>(`SELECT ${playColumns} FROM plays WHERE ended_at >= ? ORDER BY ended_at`);
  const selectRecent = db.prepare<[number], PlayDbRow>(`SELECT ${playColumns} FROM plays ORDER BY ended_at DESC LIMIT ?`);
  const selectNear = db.prepare<[string, number, number, number, number], { n: number }>(
    "SELECT COUNT(*) AS n FROM plays WHERE track_id = ? AND ((ended_at BETWEEN ? AND ?) OR (started_at BETWEEN ? AND ?))",
  );
  const selectHistory = db.prepare<[], { track_id: string; plays: number; skips: number; last: number }>(
    "SELECT track_id, COUNT(*) AS plays, SUM(skipped) AS skips, MAX(ended_at) AS last FROM plays GROUP BY track_id",
  );
  const selectContexts = db.prepare<[], { context_uri: string; last: number }>(
    "SELECT context_uri, MAX(ended_at) AS last FROM plays WHERE context_uri IS NOT NULL GROUP BY context_uri",
  );
  const selectFirst = db.prepare<[], { first: number | null }>("SELECT MIN(started_at) AS first FROM plays");
  const selectCache = db.prepare<[string, string], { json: string }>("SELECT json FROM playlist_cache WHERE playlist_id = ? AND version = ?");
  const upsertCache = db.prepare(
    "INSERT INTO playlist_cache (playlist_id, version, json, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT (playlist_id) DO UPDATE SET version = excluded.version, json = excluded.json, fetched_at = excluded.fetched_at",
  );

  const parseTrackJson = (json: string): Track | null => {
    const parsed = trackSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  };

  const track = (id: string): Track | null => {
    const row = selectTrack.get(id);
    return row === undefined ? null : parseTrackJson(row.json);
  };

  const saveTracks = db.transaction((tracks: readonly Track[]) => {
    const at = now();
    for (const track of tracks) upsertTrack.run(track.id, JSON.stringify(track), at);
  });

  const tokens: TokenStore & {
    user(): { id: string; name: string | null } | null;
    connect(tokens: Tokens, clientId: string, user: { id: string; name: string | null }): void;
  } = {
    get() {
      const row = selectAuth.get();
      if (row === undefined) return null;
      return { accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at, scope: row.scope, clientId: row.client_id };
    },
    save(next) {
      db.prepare("UPDATE auth SET access_token = ?, refresh_token = ?, expires_at = ?, scope = ? WHERE id = 1").run(
        next.accessToken,
        next.refreshToken,
        next.expiresAt,
        next.scope,
      );
    },
    clear() {
      db.prepare("DELETE FROM auth").run();
    },
    user() {
      const row = selectAuth.get();
      return row === undefined ? null : { id: row.user_id, name: row.user_name };
    },
    connect(next, clientId, user) {
      db.prepare(
        `INSERT INTO auth (id, access_token, refresh_token, expires_at, scope, user_id, user_name, client_id, connected_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at, scope = excluded.scope, user_id = excluded.user_id, user_name = excluded.user_name,
           client_id = excluded.client_id, connected_at = excluded.connected_at`,
      ).run(next.accessToken, next.refreshToken, next.expiresAt, next.scope, user.id, user.name, clientId, now());
    },
  };

  return {
    tokens,
    saveTracks,
    track,
    recordPlay(play: PlayRecord) {
      saveTracks([play.track]);
      insertPlay.run(play.track.id, play.startedAt, play.endedAt, play.listenedMs, play.track.durationMs, play.skipped ? 1 : 0, play.contextUri, play.source);
    },
    hasPlayNear(trackId: string, at: number, windowMs: number): boolean {
      return (selectNear.get(trackId, at - windowMs, at + windowMs, at - windowMs, at + windowMs)?.n ?? 0) > 0;
    },
    playsSince(since: number): PlayRow[] {
      return selectPlaysSince.all(since).map(toPlay);
    },
    recentPlays(limit: number): PlayRow[] {
      return selectRecent.all(limit).map(toPlay);
    },
    trackHistory(): Map<string, TrackHistory> {
      return new Map(selectHistory.all().map((row) => [row.track_id, { plays: row.plays, skips: row.skips, lastPlayedAt: row.last }]));
    },
    contextsLastPlayed(): Map<string, number> {
      return new Map(selectContexts.all().map((row) => [row.context_uri, row.last]));
    },
    firstPlayAt(): number | null {
      return selectFirst.get()?.first ?? null;
    },
    cachedPlaylist(playlistId: string, version: string): Track[] | null {
      const row = selectCache.get(playlistId, version);
      if (row === undefined) return null;
      const parsed = trackSchema.array().safeParse(JSON.parse(row.json));
      return parsed.success ? parsed.data : null;
    },
    cachePlaylist(playlistId: string, version: string, tracks: readonly Track[]) {
      upsertCache.run(playlistId, version, JSON.stringify(tracks), now());
    },
    tracksById(ids: Iterable<string>): Map<string, Track> {
      const result = new Map<string, Track>();
      for (const id of ids) {
        const found = track(id);
        if (found !== null) result.set(id, found);
      }
      return result;
    },
  };
}

export type Store = ReturnType<typeof createStore>;
