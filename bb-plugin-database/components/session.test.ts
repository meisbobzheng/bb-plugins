import { describe, expect, it } from "vitest";
import type { AwsProfile, Connection } from "../contract";
import { groupByAccount } from "./session";

function connection(id: string, name: string, auth: Connection["auth"]): Connection {
  return { id, name, host: "h", port: 5432, database: "hss", user: "hss", userFollowsDatabase: true, auth, ssl: true, via: null, allowWrites: false, hasPassword: false, createdAt: "", updatedAt: "" };
}

const iam = (profile: string): Connection["auth"] => ({ kind: "rds-iam", profile, region: "us-east-1" });

function profile(name: string, accountId: string, accountName: string | null): AwsProfile {
  return { name, ssoSession: "cape-sso", accountId, accountName, roleName: "admin-12h", region: "us-east-1" };
}

describe("groupByAccount", () => {
  it("files connections under their SSO account name, then the account id, then the profile, with password logins last", () => {
    const connections = [
      connection("con_local001", "local", { kind: "password" }),
      connection("con_taiwan01", "moda taiwan", iam("moda-taiwan")),
      connection("con_japan001", "moda japan", iam("moda-japan")),
      connection("con_japanro1", "moda japan reader", iam("moda-japan")),
      connection("con_unnamed1", "unnamed", iam("unnamed")),
      connection("con_missing1", "missing", iam("missing")),
    ];
    const profiles = [profile("moda-japan", "309875546222", "MvnoJapan"), profile("moda-taiwan", "549328952176", "MvnoTaiwan"), profile("unnamed", "111111111111", null)];
    expect(groupByAccount(connections, profiles).map((group) => [group.label, group.connections.map((member) => member.name)])).toEqual([
      ["111111111111", ["unnamed"]],
      ["missing", ["missing"]],
      ["MvnoJapan", ["moda japan", "moda japan reader"]],
      ["MvnoTaiwan", ["moda taiwan"]],
      ["Other", ["local"]],
    ]);
  });
});
