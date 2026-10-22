import type { z } from "zod";
import type { Playlist, PlayRequest, Repeat, SearchResult, Track } from "../contract";
import { AuthError, refreshTokens, type Fetch, type Tokens } from "./auth";
import {
  likedPlaylist,
  page,
  parseDevice,
  parsePlaylist,
  parseRepeat,
  parseSearch,
  parseTrack,
  playlistEntryTrack,
  playlistSnapshot,
  rawDevices,
  rawPlayerSchema,
  rawPlayHistory,
  rawPlaylistEntry,
  rawPlaylistPage,
  rawQueue,
  rawSavedTrack,
  rawSearch,
} from "./parse";

export const API_URL = "https://api.spotify.com/v1";

const IMAGE_HOSTS = /^https:\/\/(i\.scdn\.co|mosaic\.scdn\.co|image-cdn-[a-z0-9-]+\.spotifycdn\.com|[a-z0-9-]+\.spotifycdn\.com)\//;

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

export interface TokenStore {
  get(): (Tokens & { clientId: string }) | null;
  save(tokens: Tokens): void;
  clear(): void;
}

export interface ClientOptions {
  fetch: Fetch;
  tokens: TokenStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onDisconnected?: (reason: string) => void;
}

type Query = Record<string, string | number | boolean | null | undefined>;

const REASONS: Record<string, string> = {
  NO_ACTIVE_DEVICE: "Nothing is playing on a Spotify device. Open Spotify on this Mac or pick a device.",
  PREMIUM_REQUIRED: "Spotify only allows playback control with a Premium account.",
  UNKNOWN: "Spotify could not do that right now.",
};

function friendly(status: number, reason: string | null, message: string | null): string {
  if (reason !== null && reason in REASONS) return REASONS[reason]!;
  if (status === 404 && message?.toLowerCase().includes("device")) return REASONS.NO_ACTIVE_DEVICE!;
  if (status === 403 && message?.toLowerCase().includes("premium")) return REASONS.PREMIUM_REQUIRED!;
  if (status === 403) return `Spotify refused the request${message ? `: ${message}` : ""}.`;
  if (status === 429) return "Spotify is rate limiting requests. Try again in a few seconds.";
  return `Spotify returned ${status}${message ? `: ${message}` : ""}.`;
}

export interface PlaylistListing {
  playlist: Playlist;
  snapshotId: string | null;
}

export interface RecentPlay {
  track: Track;
  playedAt: number;
  contextUri: string | null;
}

export function createClient(options: ClientOptions) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let refreshing: Promise<string> | null = null;

  async function accessToken(force: boolean): Promise<string> {
    const stored = options.tokens.get();
    if (stored === null) throw new SpotifyError("Spotify is not connected.", 401, "NOT_CONNECTED");
    if (!force && stored.expiresAt - 60_000 > now()) return stored.accessToken;
    refreshing ??= refreshTokens(options.fetch, { clientId: stored.clientId, refreshToken: stored.refreshToken, now: now() })
      .then((tokens) => {
        options.tokens.save(tokens);
        return tokens.accessToken;
      })
      .catch((error: unknown) => {
        if (error instanceof AuthError && error.revoked) {
          options.tokens.clear();
          options.onDisconnected?.(error.message);
          throw new SpotifyError("Spotify signed this plugin out. Connect again in settings.", 401, "NOT_CONNECTED");
        }
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  function url(path: string, query?: Query): string {
    const target = path.startsWith("https://") ? new URL(path) : new URL(`${API_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== null && value !== undefined) target.searchParams.set(key, String(value));
    return target.toString();
  }

  async function request(method: string, path: string, init: { query?: Query; body?: unknown } = {}, attempt = 0): Promise<unknown> {
    const token = await accessToken(false);
    const response = await options.fetch(url(path, init.query), {
      method,
      headers: { authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (response.status === 401 && attempt === 0) {
      await accessToken(true);
      return request(method, path, init, attempt + 1);
    }
    if (response.status === 429 && attempt === 0) {
      const wait = Number(response.headers.get("retry-after") ?? "1");
      if (Number.isFinite(wait) && wait <= 5) {
        await sleep(Math.max(0.2, wait) * 1000);
        return request(method, path, init, attempt + 1);
      }
    }
    const text = await response.text();
    const json: unknown = text === "" ? null : safeJson(text);
    if (!response.ok) {
      const error = (json as { error?: { message?: string; reason?: string } } | null)?.error;
      const reason = error?.reason ?? null;
      throw new SpotifyError(friendly(response.status, reason, error?.message ?? null), response.status, reason);
    }
    return json;
  }

  async function get<T extends z.ZodType>(schema: T, path: string, query?: Query): Promise<z.infer<T>> {
    return schema.parse(await request("GET", path, { query }));
  }

  async function collect<T>(first: string, query: Query, max: number, pick: (item: unknown) => T | null): Promise<{ items: T[]; total: number }> {
    const items: T[] = [];
    let next: string | null = url(first, query);
    let total = 0;
    while (next !== null && items.length < max) {
      const pageData = rawPlaylistPage.parse(await request("GET", next));
      total = pageData.total ?? total;
      for (const raw of pageData.items) {
        const item = pick(raw);
        if (item !== null) items.push(item);
      }
      next = pageData.next && pageData.next.startsWith(API_URL) ? pageData.next : null;
    }
    return { items: items.slice(0, max), total };
  }

  const player = (deviceId?: string | null) => ({ device_id: deviceId ?? undefined });

  return {
    async player() {
      const json = await request("GET", "/me/player", { query: { additional_types: "track" } });
      if (json === null) return null;
      const raw = rawPlayerSchema.parse(json);
      return {
        isPlaying: raw.is_playing,
        progressMs: Math.max(0, Math.round(raw.progress_ms ?? 0)),
        track: parseTrack(raw.item),
        device: raw.device ? parseDevice(raw.device) : null,
        shuffle: raw.shuffle_state ?? false,
        repeat: parseRepeat(raw.repeat_state),
        context: raw.context ? { uri: raw.context.uri, kind: raw.context.type } : null,
      };
    },

    async devices() {
      return (await get(rawDevices, "/me/player/devices")).devices.map(parseDevice);
    },

    async play(play: PlayRequest, deviceId: string | null) {
      const body: Record<string, unknown> = {};
      if (play.contextUri !== null) body.context_uri = play.contextUri;
      if (play.uris !== null) body.uris = play.uris;
      if (play.offsetUri !== null) body.offset = { uri: play.offsetUri };
      await request("PUT", "/me/player/play", { query: player(deviceId), body });
    },
    resume: (deviceId: string | null) => request("PUT", "/me/player/play", { query: player(deviceId) }),
    pause: (deviceId: string | null) => request("PUT", "/me/player/pause", { query: player(deviceId) }),
    next: (deviceId: string | null) => request("POST", "/me/player/next", { query: player(deviceId) }),
    previous: (deviceId: string | null) => request("POST", "/me/player/previous", { query: player(deviceId) }),
    seek: (positionMs: number, deviceId: string | null) => request("PUT", "/me/player/seek", { query: { position_ms: positionMs, ...player(deviceId) } }),
    volume: (percent: number, deviceId: string | null) => request("PUT", "/me/player/volume", { query: { volume_percent: percent, ...player(deviceId) } }),
    shuffle: (state: boolean, deviceId: string | null) => request("PUT", "/me/player/shuffle", { query: { state, ...player(deviceId) } }),
    repeat: (state: Repeat, deviceId: string | null) => request("PUT", "/me/player/repeat", { query: { state, ...player(deviceId) } }),
    transfer: (deviceId: string, play: boolean) => request("PUT", "/me/player", { body: { device_ids: [deviceId], play } }),

    async queue(): Promise<Track[]> {
      const raw = await get(rawQueue, "/me/player/queue");
      return raw.queue.map(parseTrack).filter((track): track is Track => track !== null);
    },
    addToQueue: (uri: string) => request("POST", "/me/player/queue", { query: { uri } }),

    async playlists(myId: string, max = 500): Promise<PlaylistListing[]> {
      const { items } = await collect("/me/playlists", { limit: 50 }, max, (raw) => {
        const playlist = parsePlaylist(raw, myId);
        return playlist === null ? null : { playlist, snapshotId: playlistSnapshot(raw) };
      });
      return items;
    },

    async liked(myId: string): Promise<{ playlist: Playlist; latestAddedAt: string | null }> {
      const first = await get(page(rawSavedTrack), "/me/tracks", { limit: 1 });
      return { playlist: likedPlaylist(myId, first.total ?? 0), latestAddedAt: first.items[0]?.added_at ?? null };
    },

    async likedTracks(max: number): Promise<Track[]> {
      const { items } = await collect("/me/tracks", { limit: 50 }, max, (raw) => {
        const saved = rawSavedTrack.safeParse(raw);
        return saved.success ? parseTrack(saved.data.track) : null;
      });
      return items;
    },

    async playlistTracks(playlistId: string, max: number): Promise<Track[]> {
      const { items } = await collect(`/playlists/${encodeURIComponent(playlistId)}/items`, { limit: 50, additional_types: "track" }, max, (raw) => {
        const entry = rawPlaylistEntry.safeParse(raw);
        return entry.success ? playlistEntryTrack(entry.data) : null;
      });
      return items;
    },

    async search(query: string, myId: string, limit: number): Promise<SearchResult> {
      const raw = await get(rawSearch, "/search", { q: query, type: "track,playlist,artist,album", limit: Math.min(10, limit) });
      return parseSearch(raw, myId);
    },

    async libraryContains(uris: readonly string[]): Promise<boolean[]> {
      const json = await request("GET", "/me/library/contains", { query: { uris: uris.join(",") } });
      return Array.isArray(json) ? json.map((value) => value === true) : uris.map(() => false);
    },
    librarySave: (uris: readonly string[]) => request("PUT", "/me/library", { query: { uris: uris.join(",") } }),
    libraryRemove: (uris: readonly string[]) => request("DELETE", "/me/library", { query: { uris: uris.join(",") } }),

    async recentlyPlayed(): Promise<RecentPlay[]> {
      const raw = await get(page(rawPlayHistory), "/me/player/recently-played", { limit: 50 });
      return raw.items.flatMap((item) => {
        const track = parseTrack(item.track);
        const playedAt = Date.parse(item.played_at);
        return track === null || Number.isNaN(playedAt) ? [] : [{ track, playedAt, contextUri: item.context?.uri ?? null }];
      });
    },

    async image(imageUrl: string): Promise<string> {
      if (!IMAGE_HOSTS.test(imageUrl)) throw new SpotifyError("That image is not on Spotify's image CDN.", 400, null);
      const response = await options.fetch(imageUrl);
      if (!response.ok) throw new SpotifyError(`The cover image returned ${response.status}.`, response.status, null);
      const type = response.headers.get("content-type") ?? "image/jpeg";
      if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new SpotifyError("The cover is not an image.", 415, null);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 2_000_000) throw new SpotifyError("The cover image is too large.", 413, null);
      return `data:${type};base64,${bytes.toString("base64")}`;
    },
  };
}

export type SpotifyClient = ReturnType<typeof createClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
