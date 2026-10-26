import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const SKINS = ["console", "receiver", "liner-notes", "pastel", "voxel", "neon", "sketch", "wabi-sabi"] as const;
export type SkinId = (typeof SKINS)[number];

export const PALETTES = {
  console: ["cape", "phosphor", "glacier", "daylight"],
  receiver: ["silver", "midnight", "brass"],
  "liner-notes": ["vermilion", "cobalt", "night-edition", "riso"],
  pastel: ["sherbet", "matcha", "lavender-dusk", "peach"],
  voxel: ["gameboy", "cga", "vapor"],
  neon: ["shinjuku", "miami", "acid", "sodium"],
  sketch: ["graphite", "blueprint", "highlighter"],
  "wabi-sabi": ["washi", "raku", "moss", "aizome"],
} as const satisfies Record<SkinId, readonly [string, ...string[]]>;

export const SKIN_NAMES: Record<SkinId, string> = {
  console: "Console",
  receiver: "Receiver",
  "liner-notes": "Liner Notes",
  pastel: "Sticker Book",
  voxel: "Voxel",
  neon: "Neon",
  sketch: "Concept Sketch",
  "wabi-sabi": "Wabi-sabi",
};

export const PALETTE_NAMES: Record<string, string> = {
  cape: "Cape",
  phosphor: "Phosphor",
  glacier: "Glacier",
  daylight: "Daylight",
  silver: "Silver",
  midnight: "Midnight",
  brass: "Brass",
  vermilion: "Vermilion",
  cobalt: "Cobalt",
  "night-edition": "Night Edition",
  riso: "Riso",
  sherbet: "Sherbet",
  matcha: "Matcha",
  "lavender-dusk": "Lavender Dusk",
  peach: "Peach",
  gameboy: "Gameboy",
  cga: "CGA",
  vapor: "Vapor",
  shinjuku: "Shinjuku",
  miami: "Miami",
  acid: "Acid",
  sodium: "Sodium",
  graphite: "Graphite",
  blueprint: "Blueprint",
  highlighter: "Highlighter",
  washi: "Washi",
  raku: "Raku",
  moss: "Moss",
  aizome: "Aizome",
};

export const PALETTE_SETTING = {
  console: "consolePalette",
  receiver: "receiverPalette",
  "liner-notes": "linerNotesPalette",
  pastel: "pastelPalette",
  voxel: "voxelPalette",
  neon: "neonPalette",
  sketch: "sketchPalette",
  "wabi-sabi": "wabiSabiPalette",
} as const satisfies Record<SkinId, string>;

export const CHANNELS = { player: "player", library: "library", auth: "auth", shuffle: "shuffle", history: "history" } as const;

export const LIKED_ID = "liked";

const artistRefSchema = z.object({ id: z.string().nullable(), name: z.string(), uri: z.string().nullable() });

export const trackSchema = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  artists: z.array(artistRefSchema),
  album: z.object({ id: z.string().nullable(), uri: z.string().nullable(), name: z.string(), year: z.number().int().nullable(), imageUrl: z.string().nullable() }),
  durationMs: z.number().int().nonnegative(),
  url: z.string().nullable(),
  explicit: z.boolean(),
});
export type Track = z.infer<typeof trackSchema>;

export const playlistSchema = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  owner: z.string(),
  ownedByMe: z.boolean(),
  collaborative: z.boolean(),
  readable: z.boolean(),
  trackCount: z.number().int().nonnegative(),
  imageUrl: z.string().nullable(),
  url: z.string().nullable(),
  kind: z.enum(["liked", "playlist"]),
});
export type Playlist = z.infer<typeof playlistSchema>;

export const deviceSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  isActive: z.boolean(),
  volumePercent: z.number().int().min(0).max(100).nullable(),
  supportsVolume: z.boolean(),
});
export type Device = z.infer<typeof deviceSchema>;

export const repeatSchema = z.enum(["off", "track", "context"]);
export type Repeat = z.infer<typeof repeatSchema>;

export const duckStateSchema = z.object({
  active: z.boolean(),
  mode: z.enum(["off", "lower", "pause"]),
  threads: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type DuckState = z.infer<typeof duckStateSchema>;

export const IDLE_DUCK: DuckState = { active: false, mode: "off", threads: [] };

export const playerStateSchema = z.object({
  status: z.enum(["disconnected", "no-device", "ok", "error"]),
  error: z.string().nullable(),
  fetchedAt: z.number(),
  isPlaying: z.boolean(),
  progressMs: z.number().int().nonnegative(),
  track: trackSchema.nullable(),
  device: deviceSchema.nullable(),
  shuffle: z.boolean(),
  repeat: repeatSchema,
  context: z.object({ uri: z.string(), kind: z.string(), name: z.string().nullable() }).nullable(),
  liked: z.boolean().nullable(),
  duck: duckStateSchema,
});
export type PlayerState = z.infer<typeof playerStateSchema>;

export const authStatusSchema = z.object({
  clientIdSet: z.boolean(),
  redirectUri: z.string(),
  connected: z.boolean(),
  user: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
});
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const shuffleOptionsSchema = z.object({
  sourceId: z.string().min(1).max(200),
  spread: z.boolean(),
  fresh: z.boolean(),
  freshDays: z.number().int().min(1).max(365),
  noSkips: z.boolean(),
  vibe: z.string().trim().max(300).nullable(),
});
export type ShuffleOptions = z.infer<typeof shuffleOptionsSchema>;

export const plannedTrackSchema = z.object({ track: trackSchema, reason: z.string().nullable() });
export type PlannedTrack = z.infer<typeof plannedTrackSchema>;

export const shuffleSessionSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  createdAt: z.number(),
  options: shuffleOptionsSchema,
  tracks: z.array(plannedTrackSchema),
  dropped: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  vibeError: z.string().nullable(),
});
export type ShuffleSession = z.infer<typeof shuffleSessionSchema>;

const rankedSchema = z.object({ name: z.string(), plays: z.number().int(), listenedMs: z.number().int() });

export const statsSchema = z.object({
  since: z.number().nullable(),
  listenedMs7: z.number().int(),
  listenedMs30: z.number().int(),
  plays30: z.number().int(),
  skipRate30: z.number().nullable(),
  topArtists: z.array(rankedSchema),
  topTracks: z.array(rankedSchema.extend({ track: trackSchema })),
  byHour: z.array(z.number().int()).length(24),
  byWeekday: z.array(z.number().int()).length(7),
  forgotten: z.array(z.object({ playlistId: z.string(), name: z.string(), lastPlayedAt: z.number().nullable() })),
});
export type Stats = z.infer<typeof statsSchema>;

export const playSchema = z.object({
  track: trackSchema,
  startedAt: z.number(),
  endedAt: z.number(),
  listenedMs: z.number().int(),
  skipped: z.boolean(),
  contextUri: z.string().nullable(),
});
export type Play = z.infer<typeof playSchema>;

export const searchResultSchema = z.object({
  tracks: z.array(trackSchema),
  playlists: z.array(playlistSchema),
  artists: z.array(z.object({ id: z.string(), uri: z.string(), name: z.string(), imageUrl: z.string().nullable() })),
  albums: z.array(z.object({ id: z.string(), uri: z.string(), name: z.string(), artist: z.string(), year: z.number().int().nullable(), imageUrl: z.string().nullable() })),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("toggle") }),
  z.object({ kind: z.literal("play") }),
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("next") }),
  z.object({ kind: z.literal("previous") }),
  z.object({ kind: z.literal("seek"), positionMs: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("volume"), percent: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal("shuffle"), state: z.boolean() }),
  z.object({ kind: z.literal("repeat"), state: repeatSchema }),
  z.object({ kind: z.literal("transfer"), deviceId: z.string().min(1), play: z.boolean() }),
  z.object({ kind: z.literal("like"), liked: z.boolean() }),
]);
export type PlayerCommand = z.infer<typeof commandSchema>;

const spotifyUri = z.string().regex(/^spotify:[a-z]+:[A-Za-z0-9:]+$/, "Expected a spotify: URI");

export const playRequestSchema = z.object({
  contextUri: spotifyUri.nullable(),
  uris: z.array(spotifyUri).max(100).nullable(),
  offsetUri: spotifyUri.nullable(),
});
export type PlayRequest = z.infer<typeof playRequestSchema>;

export const appearanceSchema = z.object({ skin: z.enum(SKINS), palette: z.string().min(1).max(40) });

export const rpcContract = defineRpcContract({
  auth_status: { input: z.null(), output: authStatusSchema },
  auth_start: { input: z.null(), output: z.object({ url: z.string() }) },
  auth_disconnect: { input: z.null(), output: authStatusSchema },
  player_get: { input: z.object({ fresh: z.boolean() }), output: playerStateSchema },
  player_command: { input: commandSchema, output: playerStateSchema },
  player_play: { input: playRequestSchema, output: playerStateSchema },
  devices_list: { input: z.null(), output: z.object({ devices: z.array(deviceSchema) }) },
  app_launch: { input: z.null(), output: z.object({ launched: z.boolean() }) },
  library_playlists: { input: z.object({ refresh: z.boolean() }), output: z.object({ playlists: z.array(playlistSchema) }) },
  library_tracks: { input: z.object({ playlistId: z.string().min(1).max(200) }), output: z.object({ tracks: z.array(trackSchema), readable: z.boolean() }) },
  search: { input: z.object({ query: z.string().trim().min(1).max(200) }), output: searchResultSchema },
  queue_get: { input: z.null(), output: z.object({ tracks: z.array(trackSchema) }) },
  queue_add: { input: z.object({ uri: spotifyUri }), output: z.object({ ok: z.boolean() }) },
  shuffle_options_get: { input: z.null(), output: shuffleOptionsSchema.nullable() },
  shuffle_start: { input: shuffleOptionsSchema, output: shuffleSessionSchema },
  shuffle_session_get: { input: z.null(), output: shuffleSessionSchema.nullable() },
  stats_get: { input: z.null(), output: statsSchema },
  history_recent: { input: z.object({ limit: z.number().int().min(1).max(200) }), output: z.object({ plays: z.array(playSchema) }) },
  art_get: { input: z.object({ url: z.string().url().max(500) }), output: z.object({ dataUrl: z.string() }) },
  appearance_set: { input: appearanceSchema, output: appearanceSchema },
});
export type RpcContract = typeof rpcContract;

export const launcherItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  section: z.string(),
  actions: z.array(z.object({ id: z.string(), title: z.string() })).min(1),
  keywords: z.array(z.string()),
});
export type LauncherItem = z.infer<typeof launcherItemSchema>;

export const launcherContract = defineRpcContract({
  "launcher.search": { input: z.object({ query: z.string().max(200) }), output: z.object({ items: z.array(launcherItemSchema) }) },
  "launcher.run": {
    input: z.object({ itemId: z.string().min(1).max(300), actionId: z.string().min(1).max(40) }),
    output: z.object({ message: z.string().nullable(), navigate: z.string().nullable() }),
  },
});
