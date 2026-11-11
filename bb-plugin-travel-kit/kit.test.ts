import { describe, expect, it } from "vitest";
import { parseEnv, parseScan, profileTsv } from "./kit";

describe("scan output", () => {
  it("parses TSV rows into keyed items and drops blank or nameless rows", () => {
    const items = parseScan("formula\tjq\t1.7.1\t\napp\tSlack\t4.5\tiru\n\nrepo\t\t\t\n");
    expect(items).toEqual([
      { key: "formula:jq", kind: "formula", name: "jq", version: "1.7.1", extra: "" },
      { key: "app:Slack", kind: "app", name: "Slack", version: "4.5", extra: "iru" },
    ]);
  });

  it("keeps colons in names, so script paths survive the key round trip", () => {
    const [item] = parseScan("script\t/opt/homebrew/bin/druid-forward\tabc\t\n");
    expect(item?.key).toBe("script:/opt/homebrew/bin/druid-forward");
    expect(profileTsv({ excluded: [item!.key], classes: {} })).toBe("exclude\tscript\t/opt/homebrew/bin/druid-forward\t\n");
  });
});

describe("profile", () => {
  it("writes exclusions and app classes for the runner", () => {
    expect(profileTsv({ excluded: ["repo:srsRAN_4G"], classes: { "app:Slack": "manual" } })).toBe(
      "exclude\trepo\tsrsRAN_4G\t\nclass\tapp\tSlack\tmanual\n",
    );
    expect(profileTsv({ excluded: [], classes: {} })).toBe("");
  });
});

describe("env files", () => {
  it("reads KEY=value lines and ignores everything else", () => {
    expect(parseEnv("HANDBACK_REPO=me/travel-kit-tk\n# comment\nHANDBACK_SEQ=3\nbad line\n")).toEqual({
      HANDBACK_REPO: "me/travel-kit-tk",
      HANDBACK_SEQ: "3",
    });
  });
});
