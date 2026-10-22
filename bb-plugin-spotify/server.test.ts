import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { empty, fakeFetch, json, on, rawTrack, type Recorded } from "./test/fake-spotify";

const CLIENT_ID = "0123456789abcdef0123456789abcdef";

function fakeSpotify() {
  const player = { volume: 70, isPlaying: true, trackId: "now" };
  const pending: unknown[] = [];
  const tracks = ["a", "b", "c", "d", "e", "f"].map((id, index) => rawTrack(id, { artist: index % 2 === 0 ? "Even" : `Odd ${id}` }));
  const fake = fakeFetch([
    on("POST", "/api/token", () => json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "s" })),
    on("GET", "/v1/me", () => json({ id: "bob", display_name: "Bob" })),
    on("GET", "/v1/me/player", () =>
      json({
        is_playing: player.isPlaying,
        progress_ms: 12_000,
        shuffle_state: false,
        repeat_state: "off",
        device: { id: "mac", name: "MacBook Pro", type: "Computer", is_active: true, volume_percent: player.volume, supports_volume: true },
        context: { uri: "spotify:playlist:p1", type: "playlist" },
        item: rawTrack(player.trackId, { name: "Let It Happen", artist: "Tame Impala" }),
      }),
    ),
    on("GET", "/v1/me/library/contains", () => json([true])),
    on("PUT", "/v1/me/player/volume", (request) => {
      player.volume = Number(request.url.searchParams.get("volume_percent"));
      return empty();
    }),
    on("PUT", "/v1/me/player/pause", () => {
      player.isPlaying = false;
      return empty();
    }),
    on("PUT", "/v1/me/player/shuffle", () => empty()),
    on("PUT", "/v1/me/player/play", () => {
      player.isPlaying = true;
      return empty();
    }),
    on("GET", "/v1/me/playlists", () =>
      json({
        items: [
          { id: "p1", uri: "spotify:playlist:p1", name: "Deep Work", owner: { id: "bob" }, items: { total: 6 }, snapshot_id: "snap-1", images: [] },
          { id: "p2", uri: "spotify:playlist:p2", name: "Lo-fi Beats", owner: { id: "spotify" }, items: { total: 300 }, images: [] },
        ],
        next: null,
      }),
    ),
    on("GET", "/v1/me/tracks", () => json({ items: [{ added_at: "2026-10-01T00:00:00Z", track: rawTrack("liked") }], next: null, total: 1284 })),
    on("GET", "/v1/playlists/p1/items", () => json({ items: tracks.map((item) => ({ item })), next: null, total: tracks.length })),
    on("GET", "/v1/search", () => json({ tracks: { items: [rawTrack("found", { name: "Deep Blue", artist: "Arcade Fire" })] }, artists: { items: [] }, albums: { items: [] }, playlists: { items: [null] } })),
    on("GET", "/v1/me/player/devices", () => json({ devices: [{ id: "mac", name: "MacBook Pro", type: "Computer", is_active: true, volume_percent: 70 }] })),
  ]);
  return { ...fake, player, pending };
}

let spotify: ReturnType<typeof fakeSpotify>;

beforeEach(() => {
  spotify = fakeSpotify();
  vi.stubGlobal("fetch", spotify.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function start(settings: Record<string, string | number | boolean> = { clientId: CLIENT_ID }) {
  const interactions: unknown[] = [];
  const host = createFakePluginHost({
    pluginId: "spotify",
    loopbackBaseUrl: "http://127.0.0.1:38886",
    settings,
    sdk: { threads: { interactions: { list: async () => interactions as never } } },
  });
  await plugin(host.bb);
  return { ...host, interactions };
}

async function connect(harness: Awaited<ReturnType<typeof start>>["harness"]) {
  const { url } = (await harness.behavior.callRpc("auth_start", null)) as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  return harness.behavior.fetchHttp("GET", `/callback?code=code-1&state=${encodeURIComponent(state)}`);
}

const calls = (method: string, path: string) => spotify.calls.filter((call: Recorded) => call.method === method && call.url.pathname === path);

describe("connecting", () => {
  it("signs in with PKCE through the callback route and refuses a replayed state", async () => {
    const { harness } = await start();
    expect(await harness.behavior.callRpc("auth_status", null)).toEqual({
      clientIdSet: true,
      redirectUri: "http://127.0.0.1:38886/api/v1/plugins/spotify/http/callback",
      connected: false,
      user: null,
    });
    const { url } = (await harness.behavior.callRpc("auth_start", null)) as { url: string };
    const params = new URL(url).searchParams;
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("redirect_uri")).toBe("http://127.0.0.1:38886/api/v1/plugins/spotify/http/callback");

    const response = await harness.behavior.fetchHttp("GET", `/callback?code=code-1&state=${params.get("state")}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Connected to Spotify as Bob.");
    const token = Object.fromEntries(new URLSearchParams(calls("POST", "/api/token")[0]!.body!));
    expect(token).toMatchObject({ grant_type: "authorization_code", code: "code-1", client_id: CLIENT_ID });
    expect(token.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(await harness.behavior.callRpc("auth_status", null)).toMatchObject({ connected: true, user: { id: "bob", name: "Bob" } });

    const replay = await harness.behavior.fetchHttp("GET", `/callback?code=code-1&state=${params.get("state")}`);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("expired or was already used");
  });

  it("asks for a Client ID before signing in", async () => {
    const { harness } = await start({});
    await expect(harness.behavior.callRpc("auth_start", null)).rejects.toThrow("Client ID");
  });

  it("escapes Spotify's error text on the callback page", async () => {
    const { harness } = await start();
    const response = await harness.behavior.fetchHttp("GET", "/callback?error=%3Cscript%3E");
    expect(await response.text()).not.toContain("<script>");
  });
});

describe("playing", () => {
  it("reports the current song, device, and liked state", async () => {
    const { harness } = await start();
    await connect(harness);
    const state = await harness.behavior.callRpc("player_get", { fresh: true });
    expect(state).toMatchObject({
      status: "ok",
      isPlaying: true,
      progressMs: 12_000,
      track: { id: "now", name: "Let It Happen", artists: [{ name: "Tame Impala" }] },
      device: { name: "MacBook Pro", volumePercent: 70 },
      context: { uri: "spotify:playlist:p1", name: null },
      liked: true,
    });
  });

  it("smart shuffles a playlist into an ordered play request with Spotify's shuffle off", async () => {
    const { harness } = await start();
    await connect(harness);
    await harness.behavior.callRpc("player_get", { fresh: true });
    const session = (await harness.behavior.callRpc("shuffle_start", { sourceId: "p1", spread: true, fresh: true, freshDays: 30, noSkips: true, vibe: null })) as {
      tracks: { track: { uri: string; artists: { name: string }[] }; reason: string | null }[];
      sourceName: string;
    };
    expect(session.sourceName).toBe("Deep Work");
    expect(session.tracks).toHaveLength(6);
    expect(session.tracks.every((entry) => entry.reason === "new to your history")).toBe(true);
    const artists = session.tracks.map((entry) => entry.track.artists[0]!.name);
    expect(artists.some((name, index) => index > 0 && name === "Even" && artists[index - 1] === "Even")).toBe(false);
    const order = spotify.calls.map((call) => `${call.method} ${call.url.pathname}`);
    expect(order.indexOf("PUT /v1/me/player/shuffle")).toBeLessThan(order.indexOf("PUT /v1/me/player/play"));
    expect(calls("PUT", "/v1/me/player/shuffle")[0]!.url.searchParams.get("state")).toBe("false");
    expect(JSON.parse(calls("PUT", "/v1/me/player/play")[0]!.body!).uris).toEqual(session.tracks.map((entry) => entry.track.uri));
    expect(await harness.behavior.callRpc("shuffle_session_get", null)).toMatchObject({ sourceId: "p1" });
  });

  it("explains why a followed playlist cannot be shuffled", async () => {
    const { harness } = await start();
    await connect(harness);
    await expect(harness.behavior.callRpc("shuffle_start", { sourceId: "p2", spread: true, fresh: false, freshDays: 30, noSkips: false, vibe: null })).rejects.toThrow(
      "playlists you own or collaborate on",
    );
    expect(await harness.behavior.callRpc("library_tracks", { playlistId: "p2" })).toEqual({ tracks: [], readable: false });
  });

  it("lists Liked Songs first", async () => {
    const { harness } = await start();
    await connect(harness);
    const { playlists } = (await harness.behavior.callRpc("library_playlists", { refresh: true })) as { playlists: { name: string; trackCount: number }[] };
    expect(playlists.map((playlist) => [playlist.name, playlist.trackCount])).toEqual([
      ["Liked Songs", 1284],
      ["Deep Work", 6],
      ["Lo-fi Beats", 300],
    ]);
  });
});

describe("agent-aware music", () => {
  it("lowers the volume while a thread waits for approval and restores it after", async () => {
    const { harness, interactions } = await start();
    await connect(harness);
    interactions.push({ id: "int_1" });
    const thread = makeThreadResponse({ id: "thr_1", title: "Deploy to prod" });
    await harness.behavior.emitThreadEvent("interaction.pending", { thread, interaction: {} as never });
    await vi.waitFor(() => expect(spotify.player.volume).toBe(20));
    await vi.waitFor(async () => expect(await harness.behavior.callRpc("player_get", { fresh: false })).toMatchObject({ duck: { active: true, threads: [{ id: "thr_1", title: "Deploy to prod" }] } }));
    interactions.length = 0;
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    await vi.waitFor(() => expect(spotify.player.volume).toBe(70));
  });
});

describe("launcher and mentions", () => {
  it("offers to connect before Spotify is linked", async () => {
    const { harness } = await start();
    const result = (await harness.behavior.callRpc("launcher.search", { query: "spot" })) as { items: { id: string }[] };
    expect(result.items.map((item) => item.id)).toEqual(["cmd:open"]);
    expect(await harness.behavior.callRpc("launcher.search", { query: "deploy" })).toEqual({ items: [] });
    expect(await harness.behavior.callRpc("launcher.run", { itemId: "cmd:open", actionId: "open" })).toEqual({ message: null, navigate: "/plugins/spotify/spotify" });
  });

  it("finds playlists and songs and plays a pick", async () => {
    const { harness } = await start();
    await connect(harness);
    await harness.behavior.callRpc("player_get", { fresh: true });
    const { items } = (await harness.behavior.callRpc("launcher.search", { query: "deep" })) as { items: { id: string; section: string }[] };
    expect(items.map((item) => item.id)).toEqual(["pl:spotify:playlist:p1", "tr:spotify:track:found"]);
    expect(await harness.behavior.callRpc("launcher.run", { itemId: "tr:spotify:track:found", actionId: "play" })).toMatchObject({ message: "Playing" });
    expect(JSON.parse(calls("PUT", "/v1/me/player/play").at(-1)!.body!)).toEqual({ uris: ["spotify:track:found"] });
  });

  it("mentions the current song with its link", async () => {
    const { harness } = await start();
    await connect(harness);
    await harness.behavior.callRpc("player_get", { fresh: true });
    const provider = harness.registrations.mentionProviders[0]!;
    const [first] = await provider.search({ query: "" } as never);
    expect(first).toMatchObject({ id: "now", title: "Let It Happen", subtitle: "Playing now · Tame Impala" });
    const { context } = await provider.resolve("now");
    expect(context).toContain('Spotify song: "Let It Happen" by Tame Impala');
    expect(context).toContain("https://open.spotify.com/track/now");
  });
});

describe("appearance", () => {
  it("rejects a palette from another look", async () => {
    const { harness } = await start();
    await expect(harness.behavior.callRpc("appearance_set", { skin: "console", palette: "brass" })).rejects.toThrow("Console has no palette named brass");
    expect(await harness.behavior.callRpc("appearance_set", { skin: "receiver", palette: "brass" })).toEqual({ skin: "receiver", palette: "brass" });
  });
});
