import { fromSSO } from "@aws-sdk/credential-providers";
import { Signer } from "@aws-sdk/rds-signer";
import { loadSharedConfigFiles } from "@smithy/shared-ini-file-loader";
import type { AwsProfile, QueryError } from "./contract.js";

export async function listAwsProfiles(): Promise<AwsProfile[]> {
  const { configFile } = await loadSharedConfigFiles({ ignoreCache: true }).catch(() => ({ configFile: {} }));
  return Object.entries(configFile)
    .filter(([name]) => !name.startsWith("sso-session.") && !name.startsWith("services."))
    .map(([name, section]) => ({
      name,
      ssoSession: section.sso_session ?? null,
      accountId: section.sso_account_id ?? null,
      roleName: section.sso_role_name ?? null,
      region: section.region ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
