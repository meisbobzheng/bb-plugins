import { describe, expect, it } from "vitest";
import { TOKEN_REUSE_MS, createTokenCache, type TokenRequest } from "./auth";

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
