import type { Device, Play, PlayerState, Playlist, SearchResult, ShuffleOptions, ShuffleSession, SkinId, Stats, Track } from "../contract";

export type { Device, Play, PlayerState, Playlist, SearchResult, ShuffleOptions, ShuffleSession, SkinId, Stats, Track };

export interface Selection {
  playlist: Playlist | null;
  tracks: Track[] | null;
  readable: boolean;
  loading: boolean;
}

export interface SpotifyData {
  player: PlayerState;
  playlists: Playlist[] | null;
  selection: Selection;
  queue: Track[];
  session: ShuffleSession | null;
  shuffleOptions: ShuffleOptions;
  shuffling: boolean;
  stats: Stats | null;
  recent: Play[];
  devices: Device[];
  demo: boolean;
}

export interface SpotifyActions {
  toggle(): void;
  next(): void;
  previous(): void;
  seek(positionMs: number): void;
  setVolume(percent: number): void;
  setShuffle(on: boolean): void;
  cycleRepeat(): void;
  like(): void;
  select(playlistId: string): void;
  playPlaylist(playlist: Playlist, startAt?: Track): void;
  playTrack(track: Track): void;
  queue(track: Track): void;
  setShuffleOptions(patch: Partial<ShuffleOptions>): void;
  smartShuffle(patch?: Partial<ShuffleOptions>): void;
  copyLink(track: Track): void;
  copyUri(track: Track): void;
  mention(track: Track): void;
  shareCard(track: Track, root: HTMLElement | null): void;
  transfer(deviceId: string): void;
  refreshDevices(): void;
  launchApp(): void;
  search(query: string): Promise<SearchResult>;
  openPage(): void;
}

export interface SkinProps {
  data: SpotifyData;
  actions: SpotifyActions;
  palette: string;
}

export interface MiniProps extends SkinProps {
  close(): void;
}

export interface Skin {
  id: SkinId;
  Page: (props: SkinProps) => React.ReactNode;
  Mini: (props: MiniProps) => React.ReactNode;
}

export const DEFAULT_SHUFFLE: ShuffleOptions = { sourceId: "liked", spread: true, fresh: true, freshDays: 30, noSkips: true, vibe: null };

export function progressAt(player: PlayerState, now: number): number {
  const duration = player.track?.durationMs ?? 0;
  const elapsed = player.isPlaying ? Math.max(0, now - player.fetchedAt) : 0;
  return Math.min(duration, player.progressMs + elapsed);
}

export function upNext(data: SpotifyData): { track: Track; reason: string | null }[] {
  const current = data.player.track?.id;
  const session = data.session;
  if (session !== null && current !== undefined) {
    const index = session.tracks.findIndex((entry) => entry.track.id === current);
    if (index !== -1) return session.tracks.slice(index + 1);
  }
  return data.queue.map((track) => ({ track, reason: null }));
}
