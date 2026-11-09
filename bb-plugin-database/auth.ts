import { SSOClient, paginateListAccounts } from "@aws-sdk/client-sso";
import { fromSSO } from "@aws-sdk/credential-providers";
import { Signer } from "@aws-sdk/rds-signer";
import { fromSso } from "@aws-sdk/token-providers";
import { loadSharedConfigFiles, type SharedConfigFiles } from "@smithy/shared-ini-file-loader";
import type { AwsProfile, QueryError } from "./contract.js";

export interface SsoSession {
  name: string;
  region: string;
  profile: string;
}

export type AccountNameLookup = (sessions: readonly SsoSession[]) => Promise<ReadonlyMap<string, string>>;

export async function listAwsProfiles(accountNames: AccountNameLookup): Promise<AwsProfile[]> {
  const { configFile } = await loadSharedConfigFiles({ ignoreCache: true }).catch((): Pick<SharedConfigFiles, "configFile"> => ({ configFile: {} }));
  const profiles = Object.entries(configFile)
    .filter(([name]) => !name.startsWith("sso-session.") && !name.startsWith("services."))
    .map(([name, section]) => ({
      name,
      ssoSession: section.sso_session ?? null,
      accountId: section.sso_account_id ?? null,
      roleName: section.sso_role_name ?? null,
      region: section.region ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sessions = new Map<string, SsoSession>();
  for (const { name, ssoSession } of profiles) {
    const region = ssoSession === null ? undefined : configFile[`sso-session.${ssoSession}`]?.sso_region;
    if (ssoSession !== null && region !== undefined && !sessions.has(ssoSession)) sessions.set(ssoSession, { name: ssoSession, region, profile: name });
  }
  const names = await accountNames([...sessions.values()]);
  return profiles.map((profile) => ({ ...profile, accountName: profile.accountId === null ? null : (names.get(profile.accountId) ?? null) }));
}

export async function listSsoAccounts({ region, profile }: SsoSession): Promise<ReadonlyMap<string, string>> {
  const { token } = await fromSso({ profile })();
  const client = new SSOClient({ region, requestHandler: { connectionTimeout: 3_000, requestTimeout: 5_000 } });
  const names = new Map<string, string>();
  for await (const page of paginateListAccounts({ client }, { accessToken: token })) {
    for (const { accountId, accountName } of page.accountList ?? []) if (accountId && accountName) names.set(accountId, accountName);
  }
  return names;
}

export const ACCOUNT_NAMES_REUSE_MS = 15 * 60_000;

export function createAccountNameLookup(list: (session: SsoSession) => Promise<ReadonlyMap<string, string>> = listSsoAccounts, now: () => number = Date.now): AccountNameLookup {
  const lists = new Map<string, { listedAt: number; names: Promise<ReadonlyMap<string, string>> }>();
  const namesOf = (session: SsoSession): Promise<ReadonlyMap<string, string>> => {
    const cached = lists.get(session.name);
    if (cached !== undefined && now() - cached.listedAt < ACCOUNT_NAMES_REUSE_MS) return cached.names;
    const entry = {
      listedAt: now(),
      names: list(session).catch(() => {
        if (lists.get(session.name) === entry) lists.delete(session.name);
        return new Map<string, string>();
      }),
    };
    lists.set(session.name, entry);
    return entry.names;
  };
  return async (sessions) => new Map((await Promise.all(sessions.map(namesOf))).flatMap((names) => [...names]));
}

export function ssoLoginCommand(profile: string, profiles: readonly AwsProfile[]): string {
  const match = profiles.find((candidate) => candidate.name === profile);
  return match?.ssoSession ? `aws sso login --sso-session ${match.ssoSession}` : `aws sso login --profile ${profile}`;
}

export interface TokenRequest {
  host: string;
  port: number;
  region: string;
  user: string;
  profile: string;
}

export async function mintRdsToken({ host, port, region, user, profile }: TokenRequest): Promise<string> {
  const signer = new Signer({ hostname: host, port, region, username: user, credentials: fromSSO({ profile }) });
  return signer.getAuthToken();
}

export const TOKEN_REUSE_MS = 10 * 60_000;

export function createTokenCache(mint: (request: TokenRequest) => Promise<string> = mintRdsToken, now: () => number = Date.now) {
  const tokens = new Map<string, { mintedAt: number; token: Promise<string> }>();
  return (request: TokenRequest): Promise<string> => {
    const key = JSON.stringify([request.host, request.port, request.region, request.user, request.profile]);
    const cached = tokens.get(key);
    if (cached !== undefined && now() - cached.mintedAt < TOKEN_REUSE_MS) return cached.token;
    const entry = { mintedAt: now(), token: mint(request) };
    tokens.set(key, entry);
    entry.token.catch(() => {
      if (tokens.get(key) === entry) tokens.delete(key);
    });
    return entry.token;
  };
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function isCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "CredentialsProviderError" || error.name === "ProviderError" || /sso|token|credential/i.test(error.message);
}

export function authError(error: unknown, profile: string, profiles: readonly AwsProfile[]): QueryError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "auth",
    message: `AWS credentials for profile "${profile}" are missing or expired: ${message}`,
    code: null,
    position: null,
    detail: null,
    hint: `Run \`${ssoLoginCommand(profile, profiles)}\` and try again.`,
  };
}
