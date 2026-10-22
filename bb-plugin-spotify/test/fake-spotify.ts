import type { Track } from "../contract";

export interface Recorded {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string | null;
}

export type Route = (request: Recorded) => Response | Promise<Response> | null;

export const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

export const empty = (status = 204) => new Response(null, { status });

export function fakeFetch(routes: Route[]) {
  const calls: Recorded[] = [];
  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    const recorded: Recorded = { method: init?.method ?? "GET", url, headers, body: typeof init?.body === "string" ? init.body : null };
    calls.push(recorded);
    for (const route of routes) {
      const response = await route(recorded);
      if (response !== null) return response;
    }
    return json({ error: { status: 404, message: `no fake for ${recorded.method} ${url.pathname}` } }, 404);
  };
  return { fetch: handler as typeof fetch, calls };
}

export const on =
  (method: string, path: string | RegExp, respond: (request: Recorded) => Response | Promise<Response>): Route =>
  (request) =>
    request.method === method && (typeof path === "string" ? request.url.pathname === path : path.test(request.url.pathname)) ? respond(request) : null;

export function rawTrack(id: string, overrides: { artist?: string; album?: string; albumId?: string; durationMs?: number; name?: string } = {}) {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: overrides.name ?? `Song ${id}`,
    type: "track",
    duration_ms: overrides.durationMs ?? 200_000,
    explicit: false,
    artists: [{ id: `ar-${overrides.artist ?? id}`, name: overrides.artist ?? `Artist ${id}`, uri: `spotify:artist:${overrides.artist ?? id}` }],
    album: {
      id: overrides.albumId ?? `al-${id}`,
      uri: `spotify:album:${overrides.albumId ?? id}`,
      name: overrides.album ?? `Album ${id}`,
      release_date: "2015-07-17",
      images: [
        { url: `https://i.scdn.co/image/${id}-640`, width: 640, height: 640 },
        { url: `https://i.scdn.co/image/${id}-300`, width: 300, height: 300 },
      ],
    },
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  };
}

export function track(id: string, overrides: Parameters<typeof rawTrack>[1] = {}): Track {
  const raw = rawTrack(id, overrides);
  return {
    id,
    uri: raw.uri,
    name: raw.name,
    artists: raw.artists.map((artist) => ({ id: artist.id, name: artist.name, uri: artist.uri })),
    album: { id: raw.album.id, uri: raw.album.uri, name: raw.album.name, year: 2015, imageUrl: `https://i.scdn.co/image/${id}-300` },
    durationMs: raw.duration_ms,
    url: `https://open.spotify.com/track/${id}`,
    explicit: false,
  };
}
