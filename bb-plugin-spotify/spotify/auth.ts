import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const ACCOUNTS_URL = "https://accounts.spotify.com";

export const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
] as const;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export type Fetch = typeof fetch;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});

const errorResponse = z.object({ error: z.string(), error_description: z.string().optional() });

const base64url = (bytes: Buffer) => bytes.toString("base64url");

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64url(randomBytes(64));
  return { verifier, challenge: challengeFor(verifier), state: base64url(randomBytes(18)) };
}

export function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function authorizeUrl(options: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    response_type: "code",
    redirect_uri: options.redirectUri,
    code_challenge_method: "S256",
    code_challenge: options.challenge,
    state: options.state,
    scope: SCOPES.join(" "),
  });
  return `${ACCOUNTS_URL}/authorize?${params}`;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly revoked: boolean,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function tokenRequest(fetchImpl: Fetch, body: Record<string, string>, now: number, previousRefresh: string | null): Promise<Tokens> {
  const response = await fetchImpl(`${ACCOUNTS_URL}/api/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = errorResponse.safeParse(json);
    const code = failure.success ? failure.data.error : `HTTP ${response.status}`;
    const detail = failure.success && failure.data.error_description ? `: ${failure.data.error_description}` : "";
    throw new AuthError(`Spotify refused the sign-in (${code}${detail}).`, code === "invalid_grant");
  }
  const parsed = tokenResponse.parse(json);
  const refreshToken = parsed.refresh_token ?? previousRefresh;
  if (refreshToken === null) throw new AuthError("Spotify did not return a refresh token.", false);
  return { accessToken: parsed.access_token, refreshToken, expiresAt: now + parsed.expires_in * 1000, scope: parsed.scope ?? "" };
}

export function exchangeCode(fetchImpl: Fetch, options: { clientId: string; redirectUri: string; code: string; verifier: string; now: number }): Promise<Tokens> {
  return tokenRequest(
    fetchImpl,
    { grant_type: "authorization_code", code: options.code, redirect_uri: options.redirectUri, client_id: options.clientId, code_verifier: options.verifier },
    options.now,
    null,
  );
}

export function refreshTokens(fetchImpl: Fetch, options: { clientId: string; refreshToken: string; now: number }): Promise<Tokens> {
  return tokenRequest(fetchImpl, { grant_type: "refresh_token", refresh_token: options.refreshToken, client_id: options.clientId }, options.now, options.refreshToken);
}

const profileResponse = z.object({ id: z.string().min(1), display_name: z.string().nullable().optional() });

export async function fetchProfile(fetchImpl: Fetch, accessToken: string): Promise<{ id: string; name: string | null }> {
  const response = await fetchImpl("https://api.spotify.com/v1/me", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const hint = response.status === 403 ? " Add your Spotify account under User Management in your Spotify app's dashboard." : "";
    throw new AuthError(`Spotify would not share your profile (HTTP ${response.status}).${hint}`, false);
  }
  const profile = profileResponse.parse(await response.json());
  return { id: profile.id, name: profile.display_name ?? null };
}
