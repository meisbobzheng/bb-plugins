import { describe, expect, it } from "vitest";
import { ACCOUNT_NAMES_REUSE_MS, TOKEN_REUSE_MS, createAccountNameLookup, createTokenCache, type SsoSession, type TokenRequest } from "./auth";

const request: TokenRequest = { host: "db.local", port: 5432, region: "us-east-1", user: "hss", profile: "nucleus-dev" };

function setup() {
  const clock = { now: 0 };
  const minted: TokenRequest[] = [];
  const failing = { value: false };
  const token = createTokenCache(
    async (next) => {
      minted.push(next);
      if (failing.value) throw new Error("The SSO session associated with this profile has expired.");
      return `token-${minted.length}`;
    },
    () => clock.now,
  );
  return { token, minted, clock, failing };
}

describe("RDS token cache", () => {
  it("reuses a token for the same login until it is ten minutes old", async () => {
    const { token, minted, clock } = setup();
    expect(await token(request)).toBe("token-1");
    clock.now = TOKEN_REUSE_MS - 1;
    expect(await token(request)).toBe("token-1");
    clock.now = TOKEN_REUSE_MS;
    expect(await token(request)).toBe("token-2");
    expect(minted).toHaveLength(2);
  });

  it("mints separately per role and shares one mint between concurrent connections", async () => {
    const { token, minted } = setup();
    const [a, b] = await Promise.all([token(request), token(request)]);
    expect(a).toBe(b);
    expect(await token({ ...request, user: "auc" })).toBe("token-2");
    expect(minted.map((next) => next.user)).toEqual(["hss", "auc"]);
  });

  it("forgets a failed mint so the next connection tries again", async () => {
    const { token, minted, failing } = setup();
    failing.value = true;
    await expect(token(request)).rejects.toThrow(/expired/);
    failing.value = false;
    expect(await token(request)).toBe("token-2");
    expect(minted).toHaveLength(2);
  });
});

describe("SSO account names", () => {
  const cape: SsoSession = { name: "cape-sso", region: "us-east-1", profile: "nucleus-dev" };
  const other: SsoSession = { name: "other-sso", region: "eu-west-1", profile: "other" };

  function lookup() {
    const clock = { now: 0 };
    const failing = { value: false };
    const listed: string[] = [];
    const names = createAccountNameLookup(
      async (session) => {
        listed.push(session.name);
        if (failing.value) throw new Error("The SSO session has expired.");
        return new Map([[`${session.name}-id`, `${session.name} account`]]);
      },
      () => clock.now,
    );
    return { names, clock, failing, listed };
  }

  it("merges every session's accounts and lists each session once per fifteen minutes", async () => {
    const { names, clock, listed } = lookup();
    expect(await names([cape, other])).toEqual(new Map([["cape-sso-id", "cape-sso account"], ["other-sso-id", "other-sso account"]]));
    clock.now = ACCOUNT_NAMES_REUSE_MS - 1;
    await names([cape]);
    clock.now = ACCOUNT_NAMES_REUSE_MS;
    await names([cape]);
    expect(listed).toEqual(["cape-sso", "other-sso", "cape-sso"]);
  });

  it("returns no names while the session is expired and asks again next time", async () => {
    const { names, failing, listed } = lookup();
    failing.value = true;
    expect(await names([cape])).toEqual(new Map());
    failing.value = false;
    expect(await names([cape])).toEqual(new Map([["cape-sso-id", "cape-sso account"]]));
    expect(listed).toEqual(["cape-sso", "cape-sso"]);
  });
});
