import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  CHANNELS,
  IDLE_DUCK,
  playerStateSchema,
  type AuthStatus,
  type Device,
  type Play,
  type PlayerCommand,
  type PlayerState,
  type Playlist,
  type RpcContract,
  type ShuffleOptions,
  type ShuffleSession,
  type Stats,
  type Track,
} from "../contract";
import { useDemo } from "./demo";
import { DEFAULT_SHUFFLE, type Selection, type SpotifyActions, type SpotifyData } from "./model";
import { copyLink, copyUri, mention, shareCard } from "./share";

export const PANEL_PATH = "spotify";

const INITIAL: PlayerState = {
  status: "no-device",
  error: null,
  fetchedAt: 0,
  isPlaying: false,
  progressMs: 0,
  track: null,
  device: null,
  shuffle: false,
  repeat: "off",
  context: null,
  liked: null,
  duck: IDLE_DUCK,
};

export const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const report = (cause: unknown) => toast.error(errorMessage(cause));

export function useAuth(): { auth: AuthStatus | null; reload(): void } {
  const rpc = useRpc<RpcContract>();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const reload = useCallback(() => void rpc.call("auth_status", null).then(setAuth, report), [rpc]);
  useEffect(reload, [reload]);
  useRealtime(CHANNELS.auth, reload);
  return { auth, reload };
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[], channel: string | null, enabled = true): [T | null, () => void] {
  const [value, setValue] = useState<T | null>(null);
  const latest = useRef(load);
  latest.current = load;
  const reload = useCallback(() => {
    if (enabled) void latest.current().then(setValue, (cause: unknown) => console.warn("[spotify]", errorMessage(cause)));
  }, [enabled]);
  useEffect(reload, [reload, ...deps]);
  useRealtime(channel ?? "none", () => channel !== null && reload());
  return [value, reload];
}

export function useLive(mode: "page" | "mini", enabled: boolean): { data: SpotifyData; actions: SpotifyActions } {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const connection = useRealtimeConnectionState();
  const [player, setPlayer] = useState<PlayerState>(INITIAL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ playlist: null, tracks: null, readable: true, loading: false });
  const [options, setOptions] = useState<ShuffleOptions | null>(null);
  const [shuffling, setShuffling] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const page = mode === "page" && enabled;

  const refresh = useCallback((fresh: boolean) => {
    if (enabled) void rpc.call("player_get", { fresh }).then(setPlayer, report);
  }, [rpc, enabled]);
  useEffect(() => refresh(true), [refresh]);
  useEffect(() => {
    if (connection === "connected") refresh(true);
  }, [connection, refresh]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(false), 15_000);
    return () => clearInterval(timer);
  }, [enabled, refresh]);
  useRealtime(CHANNELS.player, (payload) => {
    const parsed = playerStateSchema.safeParse(payload);
    if (parsed.success) setPlayer(parsed.data);
  });

  const connected = player.status !== "disconnected";
  const [playlists] = useLoad<Playlist[]>(async () => (await rpc.call("library_playlists", { refresh: false })).playlists, [connected], CHANNELS.library, page && connected);
  const [session] = useLoad<ShuffleSession | null>(() => rpc.call("shuffle_session_get", null), [], CHANNELS.shuffle, enabled);
  const [savedOptions] = useLoad<ShuffleOptions | null>(() => rpc.call("shuffle_options_get", null), [], null, enabled);
  const [stats] = useLoad<Stats>(() => rpc.call("stats_get", null), [connected], CHANNELS.history, page);
  const [recent] = useLoad<Play[]>(async () => (await rpc.call("history_recent", { limit: 30 })).plays, [], CHANNELS.history, page);
  const [queue] = useLoad<Track[]>(async () => (await rpc.call("queue_get", null)).tracks, [player.track?.id, connected], null, page && connected && player.status === "ok");

  const effectiveId = selectedId ?? playlists?.find((entry) => entry.uri === player.context?.uri)?.id ?? playlists?.[0]?.id ?? null;
  useEffect(() => {
    if (!page || effectiveId === null) return;
    const playlist = playlists?.find((entry) => entry.id === effectiveId) ?? null;
    let live = true;
    setSelection({ playlist, tracks: null, readable: playlist?.readable ?? true, loading: true });
    rpc.call("library_tracks", { playlistId: effectiveId }).then(
      (result) => live && setSelection({ playlist, tracks: result.tracks, readable: result.readable, loading: false }),
      (cause: unknown) => {
        if (!live) return;
        setSelection({ playlist, tracks: [], readable: true, loading: false });
        report(cause);
      },
    );
    return () => {
      live = false;
    };
  }, [page, effectiveId, playlists, rpc]);

  const command = useCallback(
    (input: PlayerCommand) => void rpc.call("player_command", input).then(setPlayer, report),
    [rpc],
  );
  const play = useCallback(
    (contextUri: string | null, uris: string[] | null, offsetUri: string | null) => void rpc.call("player_play", { contextUri, uris, offsetUri }).then(setPlayer, report),
    [rpc],
  );
  const shuffleOptions = options ?? savedOptions ?? { ...DEFAULT_SHUFFLE, sourceId: effectiveId ?? DEFAULT_SHUFFLE.sourceId };
  const playerRef = useRef(player);
  playerRef.current = player;

  const actions = useMemo<SpotifyActions>(
    () => ({
      toggle: () => command({ kind: "toggle" }),
      next: () => command({ kind: "next" }),
      previous: () => command({ kind: "previous" }),
      seek: (positionMs) => command({ kind: "seek", positionMs: Math.max(0, Math.round(positionMs)) }),
      setVolume: (percent) => command({ kind: "volume", percent: Math.max(0, Math.min(100, Math.round(percent))) }),
      setShuffle: (state) => command({ kind: "shuffle", state }),
      cycleRepeat: () => command({ kind: "repeat", state: playerRef.current.repeat === "off" ? "context" : playerRef.current.repeat === "context" ? "track" : "off" }),
      like: () => command({ kind: "like", liked: !(playerRef.current.liked ?? false) }),
      select: (playlistId) => setSelectedId(playlistId),
      playPlaylist: (playlist, startAt) => play(playlist.uri, null, startAt?.uri ?? null),
      playTrack: (track) => play(null, [track.uri], null),
      queue: (track) =>
        void rpc.call("queue_add", { uri: track.uri }).then(() => toast.success(`Queued ${track.name}`), report),
      setShuffleOptions: (patch) => setOptions((current) => ({ ...(current ?? shuffleOptions), ...patch })),
      smartShuffle: (patch) => {
        const next = { ...shuffleOptions, ...patch };
        setOptions(next);
        setShuffling(true);
        rpc
          .call("shuffle_start", next)
          .then((started) => {
            const vibe = started.vibeError === null ? "" : ` Vibe ordering failed (${started.vibeError}), so this is a regular smart shuffle.`;
            toast.success(`Smart shuffling ${started.tracks.length} songs from ${started.sourceName}`, { description: `${started.dropped} skip-prone songs left out.${vibe}` });
          }, report)
          .finally(() => setShuffling(false));
      },
      copyLink: (track) => void copyLink(track),
      copyUri: (track) => void copyUri(track),
      mention: (track) => void mention(track),
      shareCard: (track, root) => {
        const art = track.album.imageUrl;
        void (art === null ? Promise.resolve(null) : rpc.call("art_get", { url: art }).then((result) => result.dataUrl, () => null)).then((data) => shareCard(track, data, root));
      },
      transfer: (deviceId) => command({ kind: "transfer", deviceId, play: playerRef.current.isPlaying }),
      refreshDevices: () => void rpc.call("devices_list", null).then((result) => setDevices(result.devices), report),
      launchApp: () =>
        void rpc.call("app_launch", null).then(({ launched }) => (launched ? toast.success("Opening Spotify…") : toast.error("Could not open the Spotify app on this machine.")), report),
      search: (query) => rpc.call("search", { query }),
      openPage: () => navigate.toPluginPanel(PANEL_PATH),
    }),
    [command, play, rpc, navigate, shuffleOptions],
  );

  return {
    data: {
      player,
      playlists,
      selection,
      queue: queue ?? [],
      session,
      shuffleOptions,
      shuffling,
      stats,
      recent: recent ?? [],
      devices,
      demo: false,
    },
    actions,
  };
}

export function useSpotify(mode: "page" | "mini", preview: boolean): { data: SpotifyData; actions: SpotifyActions } {
  const live = useLive(mode, !preview);
  const demo = useDemo(preview);
  return useMemo(() => {
    if (!preview) return live;
    const noop = () => toast.info("This is a preview with sample songs. Connect Spotify to play your own.");
    const actions = Object.fromEntries(Object.keys(live.actions).map((key) => [key, noop])) as unknown as SpotifyActions;
    return { data: demo.data, actions: { ...actions, copyLink: live.actions.copyLink, copyUri: live.actions.copyUri, openPage: live.actions.openPage, shareCard: (track, root) => void shareCard(track, track.album.imageUrl, root), ...demo.actions } };
  }, [preview, live, demo]);
}
