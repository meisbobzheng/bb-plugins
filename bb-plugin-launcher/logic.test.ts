import { describe, expect, it } from "vitest";
import { makeProject, makeThread } from "./fixtures";
import { matchRanges, matchScore } from "./launcher/match";
import { projectKey, rank, rootGroups, threadKey } from "./launcher/rank";
import { actionLabelKey } from "./launcher/threadMenu";
import { parseVisits, previousThread, recordVisit } from "./launcher/visits";
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

describe("matchRanges", () => {
  it("merges overlapping substring matches and skips scattered ones", () => {
    expect(matchRanges(["roll", "rollout", "plan"], "Pinned rollout plan")).toEqual([[7, 14], [15, 19]]);
    expect(matchRanges(["rp"], "rollout plan")).toEqual([]);
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
    const threads = [
      makeThread({ id: "t1", updatedAt: 10 }),
      makeThread({ id: "t2", updatedAt: 1 }),
      makeThread({ id: "t3", updatedAt: 5 }),
    ];
    const usage = { [threadKey("t2")]: { count: 3, lastUsedAt: NOW } };
    const groups = rootGroups(threads, projects, ["proj_b"], usage, NOW);
    expect(groups.recent.map((thread) => thread.id)).toEqual(["t2", "t1", "t3"]);
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

describe("thread visits", () => {
  it("keeps the newest visit first without repeats, capped at 20", () => {
    expect(recordVisit(["b", "a"], "a")).toEqual(["a", "b"]);
    const many = Array.from({ length: 25 }, (_, index) => `t${index}`);
    expect(recordVisit(many, "new")).toHaveLength(20);
  });

  it("picks the latest visited thread other than the current one that still exists", () => {
    const threads = [makeThread({ id: "a" }), makeThread({ id: "b", isArchived: true }), makeThread({ id: "c" })];
    expect(previousThread(["a", "gone", "b", "c"], threads, "a")?.id).toBe("c");
    expect(previousThread(["a"], threads, "a")).toBeUndefined();
  });

  it("reads only a saved list of ids", () => {
    expect(parseVisits('["a", 2, "b"]')).toEqual(["a", "b"]);
    expect(parseVisits("{}")).toEqual([]);
    expect(parseVisits("nope")).toEqual([]);
  });
});

describe("actionLabelKey", () => {
  it("matches the launcher's labels with bb's shorter ones", () => {
    expect(actionLabelKey("Pin thread")).toBe(actionLabelKey("Pin"));
    expect(actionLabelKey("Mark as read")).toBe(actionLabelKey("Mark read"));
    expect(actionLabelKey("Copy link")).toBe(actionLabelKey("Copy thread link"));
    expect(actionLabelKey("Rename…")).toBe(actionLabelKey("Rename"));
    expect(actionLabelKey("Fork")).not.toBe(actionLabelKey("Pin"));
  });
});
