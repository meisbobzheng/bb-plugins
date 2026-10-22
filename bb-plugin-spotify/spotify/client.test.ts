import { describe, expect, it } from "vitest";
import { authorizeUrl, challengeFor, exchangeCode, SCOPES, type Tokens } from "./auth";
import { createClient, SpotifyError, type TokenStore } from "./client";
import { empty, fakeFetch, json, on, rawTrack } from "../test/fake-spotify";

function memoryTokens(initial: Tokens & { clientId: string }): TokenStore & { current: (Tokens & { clientId: string }) | null } {
  const store = {
    current: initial as (Tokens & { clientId: string }) | null,
    get: () => store.current,
    save: (tokens: Tokens) => {
      store.current = { ...tokens, clientId: store.current!.clientId };
    },
    clear: () => {
      store.current = null;
    },
  };
  return store;
}

const NOW = 1_800_000_000_000;
const fresh = { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: NOW + 3_600_000, scope: "", clientId: "c".repeat(32) };

describe("PKCE", () => {
  it("derives the RFC 7636 challenge", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("asks for every scope with S256", () => {
    const url = new URL(authorizeUrl({ clientId: "id", redirectUri: "http://127.0.0.1:38886/cb", challenge: "ch", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "id",
      response_type: "code",
      redirect_uri: "http://127.0.0.1:38886/cb",
      code_challenge_method: "S256",
      code_challenge: "ch",
      state: "st",
      scope: SCOPES.join(" "),
    });
  });

  it("exchanges a code with the verifier and no secret", async () => {
    const fake = fakeFetch([on("POST", "/api/token", () => json({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "x" }))]);
    const tokens = await exchangeCode(fake.fetch, { clientId: "id", redirectUri: "http://127.0.0.1/cb", code: "code-1", verifier: "ver", now: NOW });
    expect(tokens).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: NOW + 3_600_000, scope: "x" });
    expect(Object.fromEntries(new URLSearchParams(fake.calls[0]!.body!))).toEqual({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: "http://127.0.0.1/cb",
      client_id: "id",
      code_verifier: "ver",
    });
  });
});

describe("client", () => {
  it("refreshes an expired token before calling and keeps the old refresh token", async () => {
    const tokens = memoryTokens({ ...fresh, expiresAt: NOW - 1 });
    const fake = fakeFetch([
      on("POST", "/api/token", () => json({ access_token: "access-2", expires_in: 3600 })),
      on("GET", "/v1/me/player/devices", () => json({ devices: [] })),
    ]);
    const client = createClient({ fetch: fake.fetch, tokens, now: () => NOW });
    await client.devices();
    expect(fake.calls.at(-1)!.headers.authorization).toBe("Bearer access-2");
    expect(tokens.current).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-1" });
  });

  it("retries once after a 401 with a refreshed token", async () => {
    const tokens = memoryTokens(fresh);
    let seen = 0;
    const fake = fakeFetch([
      on("POST", "/api/token", () => json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 })),
      on("GET", "/v1/me/player/devices", () => (seen++ === 0 ? json({ error: { status: 401, message: "expired" } }, 401) : json({ devices: [] }))),
    ]);
    const client = createClient({ fetch: fake.fetch, tokens, now: () => NOW });
    await client.devices();
    expect(fake.calls.at(-1)!.headers.authorization).toBe("Bearer access-2");
    expect(tokens.current?.refreshToken).toBe("refresh-2");
  });

  it("signs out when Spotify revokes the refresh token", async () => {
    const tokens = memoryTokens({ ...fresh, expiresAt: 0 });
    const reasons: string[] = [];
    const fake = fakeFetch([on("POST", "/api/token", () => json({ error: "invalid_grant", error_description: "Refresh token revoked" }, 400))]);
    const client = createClient({ fetch: fake.fetch, tokens, now: () => NOW, onDisconnected: (reason) => reasons.push(reason) });
    await expect(client.devices()).rejects.toMatchObject({ reason: "NOT_CONNECTED" });
    expect(tokens.current).toBeNull();
    expect(reasons[0]).toContain("invalid_grant");
  });

  it("waits out a short 429 and retries", async () => {
    const waits: number[] = [];
    let seen = 0;
    const fake = fakeFetch([on("GET", "/v1/me/player/devices", () => (seen++ === 0 ? json({}, 429, { "retry-after": "2" }) : json({ devices: [] })))]);
    const client = createClient({ fetch: fake.fetch, tokens: memoryTokens(fresh), now: () => NOW, sleep: async (ms) => void waits.push(ms) });
    expect(await client.devices()).toEqual([]);
    expect(waits).toEqual([2000]);
  });

  it("explains a missing device", async () => {
    const fake = fakeFetch([on("PUT", "/v1/me/player/pause", () => json({ error: { status: 404, message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" } }, 404))]);
    const client = createClient({ fetch: fake.fetch, tokens: memoryTokens(fresh), now: () => NOW });
    const failure = await client.pause(null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpotifyError);
    expect((failure as Error).message).toContain("Open Spotify");
  });

  it("returns null when nothing is playing", async () => {
    const fake = fakeFetch([on("GET", "/v1/me/player", () => empty())]);
    const client = createClient({ fetch: fake.fetch, tokens: memoryTokens(fresh), now: () => NOW });
    expect(await client.player()).toBeNull();
  });

  it("follows pages of playlist items and reads both item and track entries", async () => {
    const fake = fakeFetch([
      on("GET", "/v1/playlists/p1/items", (request) =>
        request.url.searchParams.get("offset") === "2"
          ? json({ items: [{ item: rawTrack("c") }, { item: { ...rawTrack("local"), is_local: true } }], next: null, total: 4 })
          : json({ items: [{ item: rawTrack("a") }, { track: rawTrack("b") }], next: "https://api.spotify.com/v1/playlists/p1/items?offset=2&limit=2", total: 4 }),
      ),
    ]);
    const client = createClient({ fetch: fake.fetch, tokens: memoryTokens(fresh), now: () => NOW });
    expect((await client.playlistTracks("p1", 100)).map((track) => track.id)).toEqual(["a", "b", "c"]);
  });

  it("marks playlists you neither own nor collaborate on as unreadable", async () => {
    const fake = fakeFetch([
      on("GET", "/v1/me/playlists", () =>
        json({
          items: [
            { id: "mine", uri: "spotify:playlist:mine", name: "Deep Work", owner: { id: "me" }, items: { total: 42 }, snapshot_id: "s1", images: [] },
            { id: "theirs", uri: "spotify:playlist:theirs", name: "Lo-fi", owner: { id: "spotify", display_name: "Spotify" }, tracks: { total: 300 }, images: null },
          ],
          next: null,
        }),
      ),
    ]);
    const client = createClient({ fetch: fake.fetch, tokens: memoryTokens(fresh), now: () => NOW });
    const listing = await client.playlists("me");
    expect(listing.map(({ playlist, snapshotId }) => [playlist.name, playlist.readable, playlist.trackCount, snapshotId])).toEqual([
      ["Deep Work", true, 42, "s1"],
      ["Lo-fi", false, 300, null],
    ]);
  });

  it("saves to the generic library endpoint with comma-separated URIs", async () => {
    const fake = fakeFetch([on("PUT", "/v1/me/library", () => empty(200))]);
    const client = createClient({ fetch: fake.fetch, tokens: memoryTokens(fresh), now: () => NOW });
    await client.librarySave(["spotify:track:a", "spotify:track:b"]);
    expect(fake.calls[0]!.url.searchParams.get("uris")).toBe("spotify:track:a,spotify:track:b");
  });

  it("only fetches cover art from Spotify's CDN", async () => {
    const fake = fakeFetch([on("GET", /\/image\//, () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }))]);
    const client = createClient({ fetch: fake.fetch, tokens: memoryTokens(fresh), now: () => NOW });
    expect(await client.image("https://i.scdn.co/image/abc")).toBe("data:image/jpeg;base64,AQID");
    await expect(client.image("http://169.254.169.254/latest")).rejects.toThrow("image CDN");
    expect(fake.calls).toHaveLength(1);
  });
});
