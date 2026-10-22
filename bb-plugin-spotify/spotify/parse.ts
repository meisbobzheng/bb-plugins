import { z } from "zod";
import { LIKED_ID, type Device, type Playlist, type Repeat, type SearchResult, type Track } from "../contract";

const image = z.object({ url: z.string(), width: z.number().nullable().optional() });
const externalUrls = z.object({ spotify: z.string().optional() }).optional();

const rawArtist = z.object({ id: z.string().nullable().optional(), name: z.string(), uri: z.string().nullable().optional(), images: z.array(image).optional() });

const rawAlbum = z.object({
  id: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
  name: z.string(),
  release_date: z.string().nullable().optional(),
  images: z.array(image).optional(),
  artists: z.array(rawArtist).optional(),
});

const rawTrack = z.object({
  id: z.string().nullable(),
  uri: z.string(),
  name: z.string(),
  type: z.string().optional(),
  artists: z.array(rawArtist).default([]),
  album: rawAlbum.optional(),
  duration_ms: z.number(),
  explicit: z.boolean().optional(),
  is_local: z.boolean().optional(),
  external_urls: externalUrls,
});

const rawPlaylist = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  collaborative: z.boolean().optional(),
  owner: z.object({ id: z.string(), display_name: z.string().nullable().optional() }),
  images: z.array(image).nullable().optional(),
  items: z.object({ total: z.number() }).optional(),
  tracks: z.object({ total: z.number() }).optional(),
  snapshot_id: z.string().optional(),
  external_urls: externalUrls,
});

const rawDevice = z.object({
  id: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  is_active: z.boolean(),
  volume_percent: z.number().nullable().optional(),
  supports_volume: z.boolean().optional(),
});

export const rawPlayerSchema = z.object({
  device: rawDevice.optional(),
  shuffle_state: z.boolean().optional(),
  repeat_state: z.string().optional(),
  progress_ms: z.number().nullable().optional(),
  is_playing: z.boolean(),
  item: z.unknown().nullable().optional(),
  context: z.object({ uri: z.string(), type: z.string() }).nullable().optional(),
});

export const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), next: z.string().nullable().optional(), total: z.number().optional() });

export const rawPlaylistEntry = z.object({ added_at: z.string().nullable().optional(), is_local: z.boolean().optional(), item: z.unknown().optional(), track: z.unknown().optional() });
export const rawSavedTrack = z.object({ added_at: z.string().optional(), track: z.unknown() });
export const rawPlayHistory = z.object({ played_at: z.string(), track: z.unknown(), context: z.object({ uri: z.string() }).nullable().optional() });
export const rawDevices = z.object({ devices: z.array(rawDevice) });
export const rawQueue = z.object({ queue: z.array(z.unknown()) });
export const rawPlaylistPage = page(z.unknown());
export const rawSearch = z.object({
  tracks: page(z.unknown().nullable()).optional(),
  playlists: page(z.unknown().nullable()).optional(),
  artists: page(z.unknown().nullable()).optional(),
  albums: page(z.unknown().nullable()).optional(),
});

function smallestImageAbove(images: readonly z.infer<typeof image>[] | null | undefined, min: number): string | null {
  if (!images || images.length === 0) return null;
  const sized = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sized.find((entry) => (entry.width ?? 0) >= min) ?? sized[sized.length - 1]!).url;
}

function year(date: string | null | undefined): number | null {
  const match = date?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function parseTrack(value: unknown): Track | null {
  const parsed = rawTrack.safeParse(value);
  if (!parsed.success) return null;
  const raw = parsed.data;
  if (raw.id === null || raw.is_local === true || (raw.type !== undefined && raw.type !== "track")) return null;
  return {
    id: raw.id,
    uri: raw.uri,
    name: raw.name,
    artists: raw.artists.map((artist) => ({ id: artist.id ?? null, name: artist.name, uri: artist.uri ?? null })),
    album: {
      id: raw.album?.id ?? null,
      uri: raw.album?.uri ?? null,
      name: raw.album?.name ?? "",
      year: year(raw.album?.release_date),
      imageUrl: smallestImageAbove(raw.album?.images, 280),
    },
    durationMs: Math.max(0, Math.round(raw.duration_ms)),
    url: raw.external_urls?.spotify ?? `https://open.spotify.com/track/${raw.id}`,
    explicit: raw.explicit ?? false,
  };
}

export function parsePlaylist(value: unknown, myId: string): Playlist | null {
  const parsed = rawPlaylist.safeParse(value);
  if (!parsed.success) return null;
  const raw = parsed.data;
  const ownedByMe = raw.owner.id === myId;
  const collaborative = raw.collaborative ?? false;
  return {
    id: raw.id,
    uri: raw.uri,
    name: raw.name,
    owner: raw.owner.display_name ?? raw.owner.id,
    ownedByMe,
    collaborative,
    readable: ownedByMe || collaborative,
    trackCount: raw.items?.total ?? raw.tracks?.total ?? 0,
    imageUrl: smallestImageAbove(raw.images, 120),
    url: raw.external_urls?.spotify ?? null,
    kind: "playlist",
  };
}

export function playlistSnapshot(value: unknown): string | null {
  const parsed = rawPlaylist.safeParse(value);
  return parsed.success ? (parsed.data.snapshot_id ?? null) : null;
}

export function likedPlaylist(myId: string, total: number): Playlist {
  return {
    id: LIKED_ID,
    uri: `spotify:user:${myId}:collection`,
    name: "Liked Songs",
    owner: "you",
    ownedByMe: true,
    collaborative: false,
    readable: true,
    trackCount: total,
    imageUrl: null,
    url: "https://open.spotify.com/collection/tracks",
    kind: "liked",
  };
}

export function parseDevice(value: z.infer<typeof rawDevice>): Device {
  const volume = value.volume_percent;
  return {
    id: value.id,
    name: value.name,
    type: value.type,
    isActive: value.is_active,
    volumePercent: typeof volume === "number" ? Math.max(0, Math.min(100, Math.round(volume))) : null,
    supportsVolume: value.supports_volume ?? typeof volume === "number",
  };
}

export function parseRepeat(value: string | undefined): Repeat {
  return value === "track" || value === "context" ? value : "off";
}

export function playlistEntryTrack(entry: z.infer<typeof rawPlaylistEntry>): Track | null {
  return parseTrack(entry.item ?? entry.track);
}

export function parseSearch(raw: z.infer<typeof rawSearch>, myId: string): SearchResult {
  const present = <T>(values: readonly (T | null)[]): T[] => values.filter((value): value is T => value !== null);
  const artists = present(
    (raw.artists?.items ?? []).map((value) => {
      const parsed = rawArtist.safeParse(value);
      if (!parsed.success || !parsed.data.id || !parsed.data.uri) return null;
      return { id: parsed.data.id, uri: parsed.data.uri, name: parsed.data.name, imageUrl: smallestImageAbove(parsed.data.images, 120) };
    }),
  );
  const albums = present(
    (raw.albums?.items ?? []).map((value) => {
      const parsed = rawAlbum.safeParse(value);
      if (!parsed.success || !parsed.data.id || !parsed.data.uri) return null;
      const album = parsed.data;
      return {
        id: album.id!,
        uri: album.uri!,
        name: album.name,
        artist: (album.artists ?? []).map((artist) => artist.name).join(", "),
        year: year(album.release_date),
        imageUrl: smallestImageAbove(album.images, 120),
      };
    }),
  );
  return {
    tracks: present((raw.tracks?.items ?? []).map(parseTrack)),
    playlists: present((raw.playlists?.items ?? []).map((value) => parsePlaylist(value, myId))),
    artists,
    albums,
  };
}

export function artistNames(track: Track): string {
  return track.artists.map((artist) => artist.name).join(", ");
}
