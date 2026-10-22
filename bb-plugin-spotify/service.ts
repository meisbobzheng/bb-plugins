import { randomUUID } from "node:crypto";
import {
  CHANNELS,
  IDLE_DUCK,
  LIKED_ID,
  shuffleOptionsSchema,
  shuffleSessionSchema,
  type AuthStatus,
  type Device,
  type DuckState,
  type LauncherItem,
  type Play,
  type PlayerCommand,
  type PlayerState,
  type Playlist,
  type PlayRequest,
  type SearchResult,
  type ShuffleOptions,
  type ShuffleSession,
  type Stats,
  type Track,
} from "./contract";
import { computeStats, observe, type Listening } from "./history";
import { applyVibeOrder, planShuffle, seededRandom, weightedOrder, isSkipProne, freshness, type Candidate } from "./shuffle";
import { authorizeUrl, createPkce, exchangeCode, fetchProfile, type Fetch } from "./spotify/auth";
import { createClient, SpotifyError, type PlaylistListing, type SpotifyClient } from "./spotify/client";
import { artistNames } from "./spotify/parse";
import type { Store } from "./store";
import { orderByVibe, VIBE_POOL, type CommandRunner } from "./vibe";

export interface ServiceSettings {
  clientId: string;
  vibeModel: string;
  claudePath: string;
  historyEnabled: boolean;
}

export interface Kv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ServiceDeps {
  store: Store;
  kv: Kv;
  fetch: Fetch;
  settings(): Promise<ServiceSettings>;
  redirectUri(): string;
  publish(channel: string, payload: unknown): void;
  log(message: string): void;
  launchApp(): Promise<boolean>;
  duckState(): DuckState;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  vibeRunner?: CommandRunner;
}

const MAX_SOURCE_TRACKS = 2_000;
const PKCE_TTL_MS = 10 * 60_000;
const ART_CACHE = 48;
const SESSION_KEY = "shuffle-session";
const OPTIONS_KEY = "shuffle-options";

export const PAGE_PATH = "/plugins/spotify/spotify";

const emptyState = (status: PlayerState["status"], at: number, duck: DuckState, error: string | null = null): PlayerState => ({
  status,
  error,
  fetchedAt: at,
  isPlaying: false,
  progressMs: 0,
  track: null,
  device: null,
  shuffle: false,
  repeat: "off",
  context: null,
  liked: null,
  duck,
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

class UnreadablePlaylistError extends Error {}

function signature(state: PlayerState): string {
  return JSON.stringify([
    state.status,
    state.error,
    state.isPlaying,
    state.track?.id,
    state.device?.id,
    state.device?.volumePercent,
    state.shuffle,
    state.repeat,
    state.liked,
    state.context?.uri,
    state.duck,
  ]);
}

function drifted(previous: PlayerState, next: PlayerState): boolean {
  const expected = previous.progressMs + (previous.isPlaying ? next.fetchedAt - previous.fetchedAt : 0);
  return Math.abs(expected - next.progressMs) > 2_500;
}

export function createService(deps: ServiceDeps) {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const { store } = deps;
  const pkce = new Map<string, { verifier: string; createdAt: number; clientId: string }>();
  const liked = new Map<string, boolean>();
  const art = new Map<string, string>();
  let state: PlayerState = emptyState(store.tokens.get() === null ? "disconnected" : "no-device", 0, IDLE_DUCK);
  let listening: Listening | null = null;
  let library: { at: number; playlists: PlaylistListing[]; liked: { playlist: Playlist; latestAddedAt: string | null } } | null = null;
  let polling: Promise<PlayerState> | null = null;
  let lastDevice: Device | null = null;
  let wake: (() => void) | null = null;

  const client: SpotifyClient = createClient({
    fetch: deps.fetch,
    tokens: store.tokens,
    now,
    onDisconnected: (reason) => {
      deps.log(`disconnected: ${reason}`);
      deps.publish(CHANNELS.auth, null);
    },
  });

  const connected = () => store.tokens.get() !== null;
  const me = () => {
    const user = store.tokens.user();
    if (user === null) throw new SpotifyError("Spotify is not connected. Connect it in the Spotify plugin settings.", 401, "NOT_CONNECTED");
    return user;
  };

  function setState(next: PlayerState) {
    const changed = signature(next) !== signature(state) || drifted(state, next);
    state = next;
    if (changed) deps.publish(CHANNELS.player, next);
    return next;
  }

  async function recordObservation(next: PlayerState) {
    if (!(await deps.settings()).historyEnabled) return;
    const result = observe(listening, {
      at: next.fetchedAt,
      track: next.status === "ok" ? next.track : null,
      progressMs: next.progressMs,
      isPlaying: next.isPlaying,
      contextUri: next.context?.uri ?? null,
    });
    listening = result.next;
    if (result.finished !== null) {
      store.recordPlay(result.finished);
      deps.publish(CHANNELS.history, null);
    }
  }

  function contextName(context: { uri: string; kind: string } | null, track: Track | null): string | null {
    if (context === null) return null;
    if (context.uri.endsWith(":collection")) return "Liked Songs";
    if (context.kind === "album") return track?.album.name ?? null;
    if (context.kind === "artist") return track?.artists[0]?.name ?? null;
    return library?.playlists.find((entry) => entry.playlist.uri === context.uri)?.playlist.name ?? null;
  }

  async function likedStatus(track: Track | null): Promise<boolean | null> {
    if (track === null) return null;
    const known = liked.get(track.id);
    if (known !== undefined) return known;
    try {
      const [value] = await client.libraryContains([track.uri]);
      liked.set(track.id, value === true);
      return value === true;
    } catch (error) {
      deps.log(`liked lookup failed: ${message(error)}`);
      return null;
    }
  }

  async function fetchState(): Promise<PlayerState> {
    const at = now();
    if (!connected()) return setState(emptyState("disconnected", at, deps.duckState()));
    try {
      const player = await client.player();
      if (player === null || player.device === null) {
        const next = setState(emptyState("no-device", at, deps.duckState()));
        await recordObservation(next);
        return next;
      }
      lastDevice = player.device;
      const next = setState({
        status: "ok",
        error: null,
        fetchedAt: at,
        isPlaying: player.isPlaying,
        progressMs: player.progressMs,
        track: player.track,
        device: player.device,
        shuffle: player.shuffle,
        repeat: player.repeat,
        context: player.context ? { ...player.context, name: contextName(player.context, player.track) } : null,
        liked: await likedStatus(player.track),
        duck: deps.duckState(),
      });
      await recordObservation(next);
      return next;
    } catch (error) {
      if (error instanceof SpotifyError && error.reason === "NOT_CONNECTED") return setState(emptyState("disconnected", at, deps.duckState()));
      deps.log(`player poll failed: ${message(error)}`);
      return setState({ ...state, status: "error", error: message(error), fetchedAt: at, duck: deps.duckState() });
    }
  }

  function poll(): Promise<PlayerState> {
    polling ??= fetchState().finally(() => {
      polling = null;
    });
    return polling;
  }

  async function targetDevice(): Promise<string | null> {
    if (state.device?.id) return state.device.id;
    const devices = await client.devices();
    const pick = devices.find((device) => device.isActive) ?? devices.find((device) => device.id === lastDevice?.id) ?? devices.find((device) => device.type === "Computer") ?? devices[0];
    if (pick?.id == null) throw new SpotifyError("No Spotify device is open. Open Spotify on this Mac, then try again.", 404, "NO_ACTIVE_DEVICE");
    return pick.id;
  }

  function settle(patch: Partial<PlayerState> | null, delayMs: number): Promise<PlayerState> | PlayerState {
    const followUp = wait(delayMs).then(poll);
    if (patch === null) return followUp;
    void followUp.catch(() => undefined);
    const at = now();
    const progressMs = Math.min(state.track?.durationMs ?? 0, state.progressMs + (state.isPlaying ? at - state.fetchedAt : 0));
    return setState({ ...state, progressMs, ...patch, fetchedAt: at });
  }

  async function command(input: PlayerCommand): Promise<PlayerState> {
    const device = state.device?.id ?? null;
    switch (input.kind) {
      case "toggle":
        return command({ kind: state.isPlaying ? "pause" : "play" });
      case "play":
        await client.resume(await targetDevice());
        return settle({ isPlaying: true }, 600);
      case "pause":
        await client.pause(device);
        return settle({ isPlaying: false }, 600);
      case "next":
        await client.next(device);
        return settle(null, 450);
      case "previous":
        await client.previous(device);
        return settle(null, 450);
      case "seek":
        await client.seek(input.positionMs, device);
        return settle({ progressMs: input.positionMs }, 600);
      case "volume":
        await client.volume(input.percent, device);
        return settle({ device: state.device === null ? null : { ...state.device, volumePercent: input.percent } }, 900);
      case "shuffle":
        await client.shuffle(input.state, device);
        return settle({ shuffle: input.state }, 600);
      case "repeat":
        await client.repeat(input.state, device);
        return settle({ repeat: input.state }, 600);
      case "transfer":
        await client.transfer(input.deviceId, input.play);
        return settle(null, 900);
      case "like": {
        const track = state.track;
        if (track === null) throw new Error("Nothing is playing to save.");
        await (input.liked ? client.librarySave([track.uri]) : client.libraryRemove([track.uri]));
        liked.set(track.id, input.liked);
        return setState({ ...state, liked: input.liked });
      }
    }
  }

  async function play(request: PlayRequest): Promise<PlayerState> {
    await client.play(request, await targetDevice());
    return settle(null, 700);
  }

  async function loadLibrary(refresh: boolean) {
    if (!refresh && library !== null && now() - library.at < 5 * 60_000) return library;
    const user = me();
    const [playlists, likedSongs] = await Promise.all([client.playlists(user.id), client.liked(user.id)]);
    library = { at: now(), playlists, liked: likedSongs };
    deps.publish(CHANNELS.library, null);
    return library;
  }

  async function playlists(refresh: boolean): Promise<Playlist[]> {
    const loaded = await loadLibrary(refresh);
    return [loaded.liked.playlist, ...loaded.playlists.map((entry) => entry.playlist)];
  }

  async function sourceTracks(playlistId: string): Promise<{ playlist: Playlist; tracks: Track[] }> {
    const loaded = await loadLibrary(false);
    if (playlistId === LIKED_ID) {
      const version = `${loaded.liked.playlist.trackCount}:${loaded.liked.latestAddedAt ?? ""}`;
      const tracks = store.cachedPlaylist(LIKED_ID, version) ?? (await client.likedTracks(MAX_SOURCE_TRACKS));
      store.cachePlaylist(LIKED_ID, version, tracks);
      return { playlist: loaded.liked.playlist, tracks };
    }
    const entry = loaded.playlists.find((candidate) => candidate.playlist.id === playlistId) ?? (await loadLibrary(true)).playlists.find((candidate) => candidate.playlist.id === playlistId);
    if (entry === undefined) throw new Error("That playlist is not in your library.");
    if (!entry.playlist.readable) throw new UnreadablePlaylistError(`Spotify only shares the songs of playlists you own or collaborate on, so "${entry.playlist.name}" can be played but not listed.`);
    const version = entry.snapshotId ?? `${entry.playlist.trackCount}`;
    const tracks = store.cachedPlaylist(playlistId, version) ?? (await client.playlistTracks(playlistId, MAX_SOURCE_TRACKS));
    store.cachePlaylist(playlistId, version, tracks);
    return { playlist: entry.playlist, tracks };
  }

  async function tracks(playlistId: string): Promise<{ tracks: Track[]; readable: boolean }> {
    try {
      return { tracks: (await sourceTracks(playlistId)).tracks, readable: true };
    } catch (error) {
      if (error instanceof UnreadablePlaylistError) return { tracks: [], readable: false };
      throw error;
    }
  }

  async function startShuffle(options: ShuffleOptions): Promise<ShuffleSession> {
    const settings = await deps.settings();
    const source = await sourceTracks(options.sourceId);
    const history = store.trackHistory();
    const candidates: Candidate[] = source.tracks.map((track) => ({ track, history: history.get(track.id) ?? null }));
    const random = seededRandom(now());
    let planned = planShuffle(candidates, options, now(), random);
    let vibeError: string | null = null;
    const vibe = options.vibe?.trim() || null;
    if (vibe !== null) {
      const kept = options.noSkips ? candidates.filter((candidate) => !isSkipProne(candidate.history)) : candidates;
      const pool = weightedOrder(kept, (candidate) => (options.fresh ? freshness(candidate.history, now(), options.freshDays) : 1), random).slice(0, VIBE_POOL);
      try {
        const order = await orderByVibe({ vibe, pool: pool.map((candidate) => candidate.track), claudePath: settings.claudePath, model: settings.vibeModel, run: deps.vibeRunner });
        planned = { tracks: applyVibeOrder(pool, order, options), dropped: candidates.length - kept.length };
      } catch (error) {
        vibeError = message(error);
        deps.log(`vibe ordering failed: ${vibeError}`);
      }
    }
    if (planned.tracks.length === 0) throw new Error(`"${source.playlist.name}" has no songs to shuffle.`);
    const device = await targetDevice();
    await client.shuffle(false, device).catch((error: unknown) => deps.log(`shuffle off failed: ${message(error)}`));
    await client.play({ contextUri: null, uris: planned.tracks.map((entry) => entry.track.uri), offsetUri: null }, device);
    store.saveTracks(planned.tracks.map((entry) => entry.track));
    const session: ShuffleSession = {
      id: randomUUID(),
      sourceId: source.playlist.id,
      sourceName: source.playlist.name,
      createdAt: now(),
      options: { ...options, vibe },
      tracks: planned.tracks,
      dropped: planned.dropped,
      candidates: candidates.length,
      vibeError,
    };
    await deps.kv.set(SESSION_KEY, session);
    await deps.kv.set(OPTIONS_KEY, session.options);
    deps.publish(CHANNELS.shuffle, null);
    void wait(700).then(poll);
    return session;
  }

  async function shuffleSession(): Promise<ShuffleSession | null> {
    const parsed = shuffleSessionSchema.safeParse(await deps.kv.get(SESSION_KEY));
    return parsed.success ? parsed.data : null;
  }

  async function shuffleOptions(): Promise<ShuffleOptions | null> {
    const parsed = shuffleOptionsSchema.safeParse(await deps.kv.get(OPTIONS_KEY));
    return parsed.success ? parsed.data : null;
  }

  async function stats(): Promise<Stats> {
    const plays = store.playsSince(now() - 30 * 86_400_000);
    let lists: Playlist[] = [];
    try {
      lists = connected() ? (await loadLibrary(false)).playlists.map((entry) => entry.playlist) : [];
    } catch (error) {
      deps.log(`stats library load failed: ${message(error)}`);
    }
    return computeStats({
      now: now(),
      plays,
      tracks: store.tracksById(new Set(plays.map((play) => play.trackId))),
      firstPlayAt: store.firstPlayAt(),
      playlists: lists,
      contextsLastPlayed: store.contextsLastPlayed(),
    });
  }

  function recentPlays(limit: number): Play[] {
    const rows = store.recentPlays(limit);
    const known = store.tracksById(new Set(rows.map((row) => row.trackId)));
    return rows.flatMap((row) => {
      const track = known.get(row.trackId);
      return track === undefined ? [] : [{ track, startedAt: row.startedAt, endedAt: row.endedAt, listenedMs: row.listenedMs, skipped: row.skipped, contextUri: row.contextUri }];
    });
  }

  async function backfill(): Promise<number> {
    if (!connected() || !(await deps.settings()).historyEnabled) return 0;
    let added = 0;
    for (const recent of await client.recentlyPlayed()) {
      if (store.hasPlayNear(recent.track.id, recent.playedAt, 10 * 60_000)) continue;
      store.recordPlay({
        track: recent.track,
        startedAt: recent.playedAt - recent.track.durationMs,
        endedAt: recent.playedAt,
        listenedMs: recent.track.durationMs,
        skipped: false,
        contextUri: recent.contextUri,
        source: "recent",
      });
      added += 1;
    }
    if (added > 0) deps.publish(CHANNELS.history, null);
    return added;
  }

  async function artData(url: string): Promise<string> {
    const cached = art.get(url);
    if (cached !== undefined) return cached;
    const data = await client.image(url);
    art.set(url, data);
    if (art.size > ART_CACHE) art.delete(art.keys().next().value!);
    return data;
  }

  async function authStatus(): Promise<AuthStatus> {
    const settings = await deps.settings();
    const user = store.tokens.user();
    return { clientIdSet: settings.clientId.trim() !== "", redirectUri: deps.redirectUri(), connected: user !== null, user };
  }

  async function authStart(): Promise<string> {
    const clientId = (await deps.settings()).clientId.trim();
    if (clientId === "") throw new Error("Paste your Spotify app's Client ID in the Spotify plugin settings first.");
    for (const [key, value] of pkce) if (now() - value.createdAt > PKCE_TTL_MS) pkce.delete(key);
    const { verifier, challenge, state: nonce } = createPkce();
    pkce.set(nonce, { verifier, createdAt: now(), clientId });
    return authorizeUrl({ clientId, redirectUri: deps.redirectUri(), challenge, state: nonce });
  }

  async function authCallback(params: { code: string | null; state: string | null; error: string | null }): Promise<{ ok: boolean; message: string }> {
    if (params.error !== null) return { ok: false, message: params.error === "access_denied" ? "You declined access, so Spotify was not connected." : `Spotify returned an error: ${params.error}.` };
    const pending = params.state === null ? undefined : pkce.get(params.state);
    if (pending === undefined || params.code === null || now() - pending.createdAt > PKCE_TTL_MS) {
      return { ok: false, message: "This sign-in link expired or was already used. Start again from the Spotify plugin settings." };
    }
    pkce.delete(params.state!);
    try {
      const tokens = await exchangeCode(deps.fetch, { clientId: pending.clientId, redirectUri: deps.redirectUri(), code: params.code, verifier: pending.verifier, now: now() });
      const user = await fetchProfile(deps.fetch, tokens.accessToken);
      store.tokens.connect(tokens, pending.clientId, user);
      library = null;
      deps.publish(CHANNELS.auth, null);
      wake?.();
      void poll();
      return { ok: true, message: `Connected to Spotify as ${user.name ?? user.id}.` };
    } catch (error) {
      return { ok: false, message: message(error) };
    }
  }

  function disconnect() {
    store.tokens.clear();
    library = null;
    listening = null;
    liked.clear();
    setState(emptyState("disconnected", now(), deps.duckState()));
    deps.publish(CHANNELS.auth, null);
  }

  async function search(query: string, limit = 10): Promise<SearchResult> {
    return client.search(query, me().id, limit);
  }

  async function launcherSearch(query: string): Promise<LauncherItem[]> {
    const needle = query.trim().toLowerCase();
    if (!connected()) {
      const connect: LauncherItem = { id: "cmd:open", title: "Connect Spotify", subtitle: "Open the Spotify page", section: "Spotify", actions: [{ id: "open", title: "Open" }], keywords: ["spotify", "music"] };
      return needle === "" || connect.keywords.some((word) => word.startsWith(needle)) || "connect spotify".includes(needle) ? [connect] : [];
    }
    const current = state.track === null ? null : `${state.track.name} — ${artistNames(state.track)}`;
    const commands: LauncherItem[] = [
      { id: "cmd:toggle", title: state.isPlaying ? "Pause music" : "Play music", subtitle: current, section: "Spotify", actions: [{ id: "run", title: state.isPlaying ? "Pause" : "Play" }], keywords: ["spotify", "pause", "play", "resume", "music"] },
      { id: "cmd:next", title: "Next song", subtitle: null, section: "Spotify", actions: [{ id: "run", title: "Skip" }], keywords: ["spotify", "skip", "next"] },
      { id: "cmd:previous", title: "Previous song", subtitle: null, section: "Spotify", actions: [{ id: "run", title: "Back" }], keywords: ["spotify", "previous", "back"] },
      ...(state.track === null ? [] : [{ id: "cmd:like", title: state.liked ? "Remove song from Liked Songs" : "Save song to Liked Songs", subtitle: current, section: "Spotify", actions: [{ id: "run", title: state.liked ? "Remove" : "Save" }], keywords: ["spotify", "like", "save", "heart"] }]),
      { id: "cmd:open", title: "Open Spotify", subtitle: "Playlists, smart shuffle, and stats", section: "Spotify", actions: [{ id: "open", title: "Open" }], keywords: ["spotify", "music", "player"] },
    ];
    const matches = (item: LauncherItem) => needle === "" || item.title.toLowerCase().includes(needle) || item.keywords.some((word) => word.startsWith(needle));
    const items = commands.filter(matches);
    const lists = library?.playlists ?? (await loadLibrary(false).catch(() => null))?.playlists ?? [];
    items.push(
      ...lists
        .filter((entry) => needle !== "" && entry.playlist.name.toLowerCase().includes(needle))
        .slice(0, 6)
        .map((entry) => ({
          id: `pl:${entry.playlist.uri}`,
          title: entry.playlist.name,
          subtitle: `Playlist · ${entry.playlist.trackCount} songs`,
          section: "Spotify playlists",
          actions: [{ id: "play", title: "Play" }, ...(entry.playlist.readable ? [{ id: "shuffle", title: "Smart shuffle" }] : [])],
          keywords: [],
        })),
    );
    if (needle.length >= 2) {
      const found = await search(query, 5);
      items.push(
        ...found.tracks.map((track) => ({
          id: `tr:${track.uri}`,
          title: track.name,
          subtitle: `${artistNames(track)} · ${track.album.name}`,
          section: "Spotify songs",
          actions: [{ id: "play", title: "Play" }, { id: "queue", title: "Add to queue" }],
          keywords: [],
        })),
        ...found.artists.slice(0, 3).map((artist) => ({ id: `ar:${artist.uri}`, title: artist.name, subtitle: "Artist", section: "Spotify songs", actions: [{ id: "play", title: "Play" }], keywords: [] })),
        ...found.albums.slice(0, 3).map((album) => ({ id: `al:${album.uri}`, title: album.name, subtitle: `Album · ${album.artist}`, section: "Spotify songs", actions: [{ id: "play", title: "Play" }], keywords: [] })),
      );
    }
    return items;
  }

  async function launcherRun(itemId: string, actionId: string): Promise<{ message: string | null; navigate: string | null }> {
    if (itemId === "cmd:open") return { message: null, navigate: PAGE_PATH };
    const [kind, ...rest] = itemId.split(":");
    const uri = rest.join(":");
    const say = (text: string) => ({ message: text, navigate: null });
    switch (kind) {
      case "cmd": {
        const next = await command(
          uri === "toggle" ? { kind: "toggle" } : uri === "next" ? { kind: "next" } : uri === "previous" ? { kind: "previous" } : { kind: "like", liked: !(state.liked ?? false) },
        );
        if (uri === "like") return say(next.liked ? "Saved to Liked Songs" : "Removed from Liked Songs");
        return say(uri === "toggle" ? (next.isPlaying ? "Playing" : "Paused") : uri === "next" ? "Skipped" : "Back one song");
      }
      case "pl": {
        const entry = library?.playlists.find((candidate) => candidate.playlist.uri === uri);
        if (actionId === "shuffle" && entry !== undefined) {
          const saved = await shuffleOptions();
          const session = await startShuffle({ spread: true, fresh: true, freshDays: 30, noSkips: true, vibe: null, ...saved, sourceId: entry.playlist.id });
          return say(`Smart shuffling ${session.tracks.length} songs from ${session.sourceName}`);
        }
        await play({ contextUri: uri, uris: null, offsetUri: null });
        return say(`Playing ${entry?.playlist.name ?? "playlist"}`);
      }
      case "tr":
        if (actionId === "queue") {
          await client.addToQueue(uri);
          return say("Added to the queue");
        }
        await play({ contextUri: null, uris: [uri], offsetUri: null });
        return say("Playing");
      case "ar":
      case "al":
        await play({ contextUri: uri, uris: null, offsetUri: null });
        return say("Playing");
      default:
        throw new Error(`Unknown Spotify item ${itemId}`);
    }
  }

  async function mentionSearch(query: string) {
    const needle = query.trim().toLowerCase();
    const seen = new Set<string>();
    const rows: { id: string; title: string; subtitle: string }[] = [];
    const add = (track: Track, label: string) => {
      if (seen.has(track.id) || (needle !== "" && !`${track.name} ${artistNames(track)}`.toLowerCase().includes(needle))) return;
      seen.add(track.id);
      rows.push({ id: track.id, title: track.name, subtitle: `${label} · ${artistNames(track)}` });
    };
    if (state.track !== null) add(state.track, state.isPlaying ? "Playing now" : "Paused");
    for (const play of recentPlays(30)) add(play.track, "Recently played");
    if (needle.length >= 2 && connected()) {
      const found = await Promise.race([search(query, 5).catch(() => null), wait(1_400).then(() => null)]);
      const fresh = (found?.tracks ?? []).filter((track) => !seen.has(track.id));
      store.saveTracks(fresh);
      rows.push(...fresh.map((track) => ({ id: track.id, title: track.name, subtitle: `Spotify · ${artistNames(track)}` })));
    }
    return rows.slice(0, 12);
  }

  function mentionContext(trackId: string): string {
    const track = store.track(trackId) ?? (state.track?.id === trackId ? state.track : null);
    if (track === null) throw new Error("That Spotify song is no longer known; mention it again.");
    const album = track.album.year === null ? track.album.name : `${track.album.name} (${track.album.year})`;
    const length = `${Math.floor(track.durationMs / 60_000)}:${String(Math.floor((track.durationMs % 60_000) / 1000)).padStart(2, "0")}`;
    return [`Spotify song: "${track.name}" by ${artistNames(track)}, from ${album}, ${length}.`, `Link: ${track.url ?? `https://open.spotify.com/track/${track.id}`}`, `URI: ${track.uri}`].join("\n");
  }

  async function run(signal: AbortSignal, tick: () => Promise<void>) {
    let errors = 0;
    while (!signal.aborted) {
      const current = await poll();
      await tick().catch((error: unknown) => deps.log(`tick failed: ${message(error)}`));
      errors = current.status === "error" ? Math.min(errors + 1, 6) : 0;
      const delay =
        current.status === "disconnected" ? 60_000 : current.status === "error" ? 5_000 * 2 ** errors : current.status === "no-device" ? 15_000 : current.isPlaying ? 4_000 : 10_000;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      wake = null;
    }
    const last = observe(listening, { at: now(), track: null, progressMs: 0, isPlaying: false, contextUri: null }).finished;
    if (last !== null) store.recordPlay(last);
    listening = null;
  }

  return {
    client,
    current: () => state,
    playerState: (fresh: boolean) => (fresh || now() - state.fetchedAt > 1_500 ? poll() : Promise.resolve(state)),
    refreshDuck: () => setState({ ...state, duck: deps.duckState() }),
    command,
    play,
    devices: () => client.devices(),
    launchApp: async () => {
      const launched = await deps.launchApp();
      if (launched) void wait(2_500).then(poll);
      return launched;
    },
    playlists,
    tracks,
    search: (query: string) => search(query),
    queue: () => client.queue(),
    queueAdd: (uri: string) => client.addToQueue(uri),
    startShuffle,
    shuffleSession,
    shuffleOptions,
    stats,
    recentPlays,
    backfill,
    artData,
    authStatus,
    authStart,
    authCallback,
    disconnect,
    launcherSearch,
    launcherRun,
    mentionSearch,
    mentionContext,
    run,
  };
}

export type Service = ReturnType<typeof createService>;
