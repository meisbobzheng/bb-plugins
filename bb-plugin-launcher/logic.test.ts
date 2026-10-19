import { describe, expect, it } from "vitest";
import { makeProject, makeThread } from "./fixtures";
import { matchScore } from "./launcher/match";
import { projectKey, rank, rootGroups, threadKey } from "./launcher/rank";
import { MAX_USAGE_ENTRIES, frecency, recordUsage } from "./model";

const NOW = 1_000_000_000_000;
const HOUR = 3_600_000;

describe("matchScore", () => {
  it("ranks prefixes above word starts above substrings above subsequences", () => {
    const prefix = matchScore("hss", ["hss rollout"])!;
    const word = matchScore("hss", ["fix hss rollout"])!;
    const inner = matchScore("hss", ["phssx"])!;
    const scattered = matchScore("hss", ["h-s-s"])!;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThan(scattered);
  });

  it("requires every term to match some field", () => {
    expect(matchScore("diameter fix", ["Fix CER handling", "go-diameter"])).not.toBeNull();
    expect(matchScore("diameter nope", ["Fix CER handling", "go-diameter"])).toBeNull();
  });

  it("matches everything for an empty query", () => {
    expect(matchScore("  ", ["anything"])).toBe(0);
  });
});

describe("frecency", () => {
  it("weights recent use above old use", () => {
    const recent = frecency({ count: 1, lastUsedAt: NOW - HOUR }, NOW);
    const old = frecency({ count: 1, lastUsedAt: NOW - 1000 * HOUR }, NOW);
    expect(recent).toBeGreaterThan(old);
    expect(frecency(undefined, NOW)).toBe(0);
  });

  it("counts uses and keeps only the strongest entries", () => {
    let usage = recordUsage({}, "a", NOW);
    usage = recordUsage(usage, "a", NOW);
    expect(usage.a).toEqual({ count: 2, lastUsedAt: NOW });
    for (let index = 0; index <= MAX_USAGE_ENTRIES; index++) usage = recordUsage(usage, `k${index}`, NOW - index * HOUR);
    expect(Object.keys(usage)).toHaveLength(MAX_USAGE_ENTRIES);
    expect(usage.a).toBeDefined();
  });
});

describe("rootGroups", () => {
  const projects = [makeProject("proj_a", "hss"), makeProject("proj_b", "go-diameter")];

  it("lists each thread once, attention first, and hides archived threads", () => {
    const threads = [
      makeThread({ id: "waiting", indicator: "waiting-for-input", isPinned: true, latestAttentionAt: 5 }),
      makeThread({ id: "busy", status: "active", updatedAt: 4 }),
      makeThread({ id: "pinned", isPinned: true, pinSortKey: "a" }),
      makeThread({ id: "old", updatedAt: 1 }),
      makeThread({ id: "gone", isArchived: true, updatedAt: 9 }),
    ];
    const groups = rootGroups(threads, projects, [], {}, NOW);
    expect(groups.attention.map((thread) => thread.id)).toEqual(["waiting"]);
    expect(groups.running.map((thread) => thread.id)).toEqual(["busy"]);
    expect(groups.pinnedThreads.map((thread) => thread.id)).toEqual(["pinned"]);
    expect(groups.recent.map((thread) => thread.id)).toEqual(["old"]);
  });

  it("orders recent threads by frecency and splits pinned projects out", () => {
    const threads = [makeThread({ id: "t1", updatedAt: 10 }), makeThread({ id: "t2", updatedAt: 1 })];
    const usage = { [threadKey("t2")]: { count: 3, lastUsedAt: NOW } };
    const groups = rootGroups(threads, projects, ["proj_b"], usage, NOW);
    expect(groups.recent.map((thread) => thread.id)).toEqual(["t2", "t1"]);
    expect(groups.pinnedProjects.map((project) => project.id)).toEqual(["proj_b"]);
    expect(groups.projects.map((project) => project.id)).toEqual(["proj_a"]);
  });
});

describe("rank", () => {
  it("breaks equal matches with frecency", () => {
    const projects = [makeProject("proj_a", "api"), makeProject("proj_b", "api")];
    const usage = { [projectKey("proj_b")]: { count: 5, lastUsedAt: NOW } };
    const ranked = rank(projects, "api", (project) => [project.name], (project) => projectKey(project.id), usage, NOW);
    expect(ranked.map((project) => project.id)).toEqual(["proj_b", "proj_a"]);
  });
});
