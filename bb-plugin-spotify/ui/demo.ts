import { useCallback, useEffect, useMemo, useState } from "react";
import { IDLE_DUCK, LIKED_ID, type Device, type Play, type PlayerState, type Playlist, type ShuffleOptions, type ShuffleSession, type Stats, type Track } from "../contract";
import { hash } from "./spectrum";
import { DEFAULT_SHUFFLE, type SpotifyActions, type SpotifyData } from "./model";

const SONGS: [string, string, string, number, number][] = [
  ["Silhouettes (I, II & III)", "Floating Points", "Elaenia", 2015, 656],
  ["Kerala", "Bonobo", "Migration", 2017, 250],
  ["Gosh", "Jamie xx", "In Colour", 2015, 294],
  ["Baby", "Four Tet", "Sixteen Oceans", 2020, 270],
  ["Weird Fishes/Arpeggi", "Radiohead", "In Rainbows", 2007, 318],
  ["Digital Love", "Daft Punk", "Discovery", 2001, 298],
  ["Let It Happen", "Tame Impala", "Currents", 2015, 467],
  ["Time (You and I)", "Khruangbin", "Mordechai", 2020, 264],
  ["Can't Do Without You", "Caribou", "Our Love", 2014, 236],
  ["Delilah (pull me out of this)", "Fred again..", "Actual Life 3", 2022, 252],
  ["Midnight City", "M83", "Hurry Up, We're Dreaming", 2011, 243],
  ["Nightcall", "Kavinsky", "OutRun", 2013, 258],
];

const COLORS = ["#ff6b4a", "#ffc72c", "#7fa7d6", "#3fb950", "#c4a2ff", "#ff9ec7", "#4fb8c9", "#f2a65a"];

function cover(seed: string): string {
  const value = hash(seed);
  const a = COLORS[value % COLORS.length]!;
  const b = COLORS[(value >> 3) % COLORS.length]!;
  const c = COLORS[(value >> 6) % COLORS.length]!;
  const cx = 30 + (value % 40);
  const cy = 25 + ((value >> 4) % 40);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#111318"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="${cx}" cy="${cy}" r="22" fill="${b}"/><path d="M0 ${70 + (value % 12)} Q50 ${50 + (value % 20)} 100 ${72 + ((value >> 2) % 10)} V100 H0Z" fill="${c}" opacity=".85"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export const DEMO_TRACKS: Track[] = SONGS.map(([name, artist, album, year, seconds], index) => {
  const id = `demo${index}`;
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: [{ id: null, name: artist, uri: null }],
    album: { id: `album${index}`, uri: null, name: album, year, imageUrl: cover(album) },
    durationMs: seconds * 1000,
    url: null,
    explicit: false,
  };
});

const playlist = (id: string, name: string, count: number, readable = true): Playlist => ({
  id,
  uri: `spotify:playlist:${id}`,
  name,
  owner: readable ? "you" : "Spotify",
  ownedByMe: readable,
  collaborative: false,
  readable,
  trackCount: count,
  imageUrl: cover(name),
  url: null,
  kind: id === LIKED_ID ? "liked" : "playlist",
});

export const DEMO_PLAYLISTS: Playlist[] = [
  { ...playlist(LIKED_ID, "Liked Songs", 1284), uri: "spotify:user:you:collection" },
  playlist("deep-work", "Deep Work", 42),
  playlist("late-night", "Late Night Drive", 67),
  playlist("sunday", "Sunday Coffee", 31),
  playlist("heavy", "Heavy Rotation", 25),
  playlist("rnb", "90s R&B", 88),
  playlist("road", "Road Trip '24", 112),
  playlist("lofi", "Lo-fi Beats", 300, false),
];

const DEVICES: Device[] = [
  { id: "mac", name: "MacBook Pro", type: "Computer", isActive: true, volumePercent: 42, supportsVolume: true },
  { id: "phone", name: "iPhone", type: "Smartphone", isActive: false, volumePercent: 80, supportsVolume: true },
];

const DAY = 86_400_000;

function demoStats(now: number): Stats {
  const top = DEMO_TRACKS.slice(0, 6);
  return {
    since: now - 64 * DAY,
    listenedMs7: 14 * 3_600_000,
    listenedMs30: 61 * 3_600_000,
    plays30: 812,
    skipRate30: 0.18,
    topArtists: top.map((track, index) => ({ name: track.artists[0]!.name, plays: 90 - index * 11, listenedMs: (20 - index * 2.5) * 3_600_000 })),
    topTracks: top.map((track, index) => ({ name: track.name, track, plays: 38 - index * 4, listenedMs: (6 - index * 0.7) * 3_600_000 })),
    byHour: Array.from({ length: 24 }, (_, hour) => Math.round(Math.max(0, Math.sin(((hour - 7) / 24) * Math.PI * 2)) * 3_600_000 * (hour > 8 && hour < 18 ? 3 : 1))),
    byWeekday: [4, 9, 11, 10, 12, 8, 5].map((value) => value * 3_600_000),
    forgotten: [
      { playlistId: "sunday", name: "Sunday Coffee", lastPlayedAt: now - 52 * DAY },
      { playlistId: "rnb", name: "90s R&B", lastPlayedAt: null },
    ],
  };
}

export function useDemo(enabled: boolean): { data: SpotifyData; actions: Partial<SpotifyActions> } {
  const [index, setIndex] = useState(6);
  const [playing, setPlaying] = useState(true);
  const [anchor, setAnchor] = useState(() => ({ at: Date.now(), progressMs: 192_000 }));
  const [liked, setLiked] = useState(true);
  const [selected, setSelected] = useState("deep-work");
  const [options, setOptions] = useState<ShuffleOptions>({ ...DEFAULT_SHUFFLE, sourceId: "deep-work", vibe: "start mellow, end euphoric" });
  const [session, setSession] = useState<ShuffleSession | null>(null);
  const [volume, setVolume] = useState(42);
  const track = DEMO_TRACKS[index]!;

  useEffect(() => {
    if (!enabled || !playing) return;
    const timer = setInterval(() => {
      if (Date.now() - anchor.at + anchor.progressMs >= track.durationMs) {
        setIndex((value) => (value + 1) % DEMO_TRACKS.length);
        setAnchor({ at: Date.now(), progressMs: 0 });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [enabled, playing, anchor, track.durationMs]);

  const jump = useCallback((next: number) => {
    setIndex((next + DEMO_TRACKS.length) % DEMO_TRACKS.length);
    setAnchor({ at: Date.now(), progressMs: 0 });
    setPlaying(true);
  }, []);

  const player: PlayerState = {
    status: "ok",
    error: null,
    fetchedAt: anchor.at,
    isPlaying: playing,
    progressMs: anchor.progressMs,
    track,
    device: { ...DEVICES[0]!, volumePercent: volume },
    shuffle: false,
    repeat: "off",
    context: { uri: "spotify:playlist:deep-work", kind: "playlist", name: "Deep Work" },
    liked,
    duck: IDLE_DUCK,
  };

  const now = Date.now();
  const recent: Play[] = DEMO_TRACKS.slice(0, 8).map((entry, offset) => ({
    track: entry,
    startedAt: now - (offset + 1) * 300_000,
    endedAt: now - offset * 300_000,
    listenedMs: offset === 2 ? 9_000 : entry.durationMs,
    skipped: offset === 2,
    contextUri: null,
  }));

  const data: SpotifyData = {
    player,
    playlists: DEMO_PLAYLISTS,
    selection: {
      playlist: DEMO_PLAYLISTS.find((entry) => entry.id === selected) ?? null,
      tracks: selected === "lofi" ? [] : DEMO_TRACKS,
      readable: selected !== "lofi",
      loading: false,
    },
    queue: DEMO_TRACKS.slice(index + 1, index + 6),
    session,
    shuffleOptions: options,
    shuffling: false,
    stats: useMemo(() => demoStats(Date.now()), []),
    recent,
    devices: DEVICES,
    demo: true,
  };

  const actions: Partial<SpotifyActions> = {
    toggle: () => {
      const progressMs = Math.min(track.durationMs, anchor.progressMs + (playing ? Date.now() - anchor.at : 0));
      setAnchor({ at: Date.now(), progressMs });
      setPlaying((value) => !value);
    },
    next: () => jump(index + 1),
    previous: () => jump(index - 1),
    seek: (positionMs) => setAnchor({ at: Date.now(), progressMs: positionMs }),
    setVolume,
    like: () => setLiked((value) => !value),
    select: setSelected,
    playPlaylist: (_playlist, startAt) => jump(startAt === undefined ? 0 : DEMO_TRACKS.findIndex((entry) => entry.id === startAt.id)),
    playTrack: (entry) => jump(DEMO_TRACKS.findIndex((candidate) => candidate.id === entry.id)),
    setShuffleOptions: (patch) => setOptions((value) => ({ ...value, ...patch })),
    smartShuffle: (patch) => {
      const merged = { ...options, ...patch };
      setOptions(merged);
      const order = [...DEMO_TRACKS].sort((a, b) => (hash(a.id + now) % 97) - (hash(b.id + now) % 97));
      const notes = ["mellow opener", "unheard for 41 days", "a gentle step up", "new artist, new album", "builds", "rising", "the peak", "euphoric close"];
      setSession({
        id: `demo-${now}`,
        sourceId: merged.sourceId,
        sourceName: DEMO_PLAYLISTS.find((entry) => entry.id === merged.sourceId)?.name ?? "Deep Work",
        createdAt: now,
        options: merged,
        tracks: order.map((entry, position) => ({ track: entry, reason: notes[position % notes.length]! })),
        dropped: merged.noSkips ? 1 : 0,
        candidates: 42,
        vibeError: null,
      });
      jump(DEMO_TRACKS.findIndex((entry) => entry.id === order[0]!.id));
    },
    search: async (query) => {
      const needle = query.toLowerCase();
      return {
        tracks: DEMO_TRACKS.filter((entry) => `${entry.name} ${entry.artists[0]!.name}`.toLowerCase().includes(needle)).slice(0, 10),
        playlists: DEMO_PLAYLISTS.filter((entry) => entry.name.toLowerCase().includes(needle)),
        artists: [],
        albums: [],
      };
    },
  };

  return { data, actions };
}
