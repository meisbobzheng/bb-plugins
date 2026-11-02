import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import { makeProject, makeThread } from "./fixtures";
import { matchRanges, matchScore } from "./launcher/match";
import { TOP_HIT, projectKey, rank, rankScored, remoteScore, rootGroups, threadKey, withTopHit } from "./launcher/rank";
import { actionLabelKey } from "./launcher/threadMenu";
import { parseVisits, previousThread, recordVisit } from "./launcher/visits";
import { MAX_USAGE_ENTRIES, frecency, recordUsage } from "./model";
import { parseTelecomHits, telecomSearcher } from "./telecom";

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

  it("keeps the first six home slots for attention, running, and pinned, so recent threads still make the first nine", () => {
    const many = (prefix: string, overrides: object) => Array.from({ length: 5 }, (_, index) => makeThread({ id: `${prefix}${index}`, ...overrides }));
    const threads = [
      ...many("wait", { indicator: "waiting-for-input" }),
      ...many("busy", { status: "active" }),
      ...many("pin", { isPinned: true }),
      ...many("old", {}),
    ];
    const groups = rootGroups(threads, projects, ["proj_a", "proj_b"], {}, NOW);
    expect(groups.attention).toHaveLength(3);
    expect(groups.running).toHaveLength(3);
    expect([...groups.pinnedProjects, ...groups.pinnedThreads]).toHaveLength(0);
    expect(groups.recent).toHaveLength(8);
    expect(groups.projects.map((project) => project.id)).toEqual(["proj_a", "proj_b"]);

    const calm = rootGroups(threads.filter((thread) => !thread.id.startsWith("busy")), projects, ["proj_b"], {}, NOW);
    expect(calm.pinnedProjects.map((project) => project.id)).toEqual(["proj_b"]);
    expect(calm.pinnedThreads).toHaveLength(2);
    expect(calm.projects.map((project) => project.id)).toEqual(["proj_a"]);
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

  const terms = (item: { terms: string[] }) => item.terms;
  const id = (item: { id: string }) => item.id;

  it("puts a title or keyword equal to the query above any prefix match, however often used", () => {
    const items = [
      { id: "prefix", terms: ["Settings sync"] },
      { id: "keyword", terms: ["Change theme…", "dark"] },
      { id: "title", terms: ["Settings…", "preferences"] },
      { id: "darkroom", terms: ["Darkroom"] },
    ];
    const usage = { prefix: { count: 50, lastUsedAt: NOW }, darkroom: { count: 50, lastUsedAt: NOW } };
    expect(rank(items, "settings", terms, id, usage, NOW).map(id)).toEqual(["title", "prefix"]);
    expect(rank(items, "DARK", terms, id, usage, NOW).map(id)).toEqual(["keyword", "darkroom"]);
    const titles = ["new thread in hss", "new thread"];
    expect(rank(titles, "new  thread", (title) => [title], (title) => title, {}, NOW)).toEqual(["new thread", "new thread in hss"]);
  });

  it("checks exactness only against the fields it is given", () => {
    const threads = [makeThread({ id: "in-hss", displayTitle: "Fix CER" }), makeThread({ id: "named", displayTitle: "hss" })];
    const fields = (thread: PluginSidebarThread) => [thread.displayTitle, "hss"];
    const ranked = rankScored(threads, "hss", fields, (thread) => thread.id, {}, NOW, 10, (thread) => [thread.displayTitle]);
    expect(ranked.map(({ candidate }) => candidate.id)).toEqual(["named", "in-hss"]);
    expect(ranked[0]!.score - ranked[1]!.score).toBeGreaterThan(100);
  });

  it("scores results from elsewhere on the same scale", () => {
    const local = rankScored([{ id: "thread", terms: ["SAR retry handling"] }], "sar", terms, id, {}, NOW)[0]!.score;
    expect(remoteScore("sar", ["SAR / SAA", "SAR"], true)).toBeGreaterThan(local);
    expect(remoteScore("sar", ["SAR-Flags"], false)).toBeLessThanOrEqual(local);
    expect(remoteScore("dark", ["Change theme…", "dark"])).toBe(remoteScore("dark", ["Change theme…", "dark"], true));
  });
});

describe("withTopHit", () => {
  const entry = (candidate: string, score: number) => ({ candidate, score });

  it("lifts the best match across sections into Top hit and lists it once", () => {
    const sections = withTopHit([
      { title: "Threads", items: [entry("thread", 100), entry("other", 50)] },
      { title: "Telecom", items: [entry("SAR", 300)] },
      { title: "Ask an agent", items: [entry("ask", 0)], fallback: true },
    ]);
    expect(sections).toEqual([
      { title: TOP_HIT, items: ["SAR"] },
      { title: "Threads", items: ["thread", "other"] },
      { title: "Telecom", items: [] },
      { title: "Ask an agent", items: ["ask"] },
    ]);
  });

  it("keeps the first of equal matches and uses fallback sections only when nothing else matches", () => {
    expect(withTopHit([{ title: "A", items: [entry("a", 5)] }, { title: "B", items: [entry("b", 5)] }])[0]!.items).toEqual(["a"]);
    const fallback = withTopHit([{ title: "Threads", items: [] }, { title: "Ask an agent", items: [entry("ask", 0)], fallback: true }]);
    expect(fallback[0]!.items).toEqual(["ask"]);
    expect(withTopHit([{ title: "Threads", items: [] }])[0]!.items).toEqual([]);
  });
});

const TELECOM_CLI_OUTPUT = JSON.stringify([
  {
    id: "diam.cmd/301",
    score: 1011,
    match: "exact",
    entity: {
      id: "diam.cmd/301",
      kind: "cmd",
      code: 301,
      name: "Server-Assignment",
      request: { name: "Server-Assignment-Request", abbrev: "SAR" },
      answer: { name: "Server-Assignment-Answer", abbrev: "SAA" },
      description:
        "The S-CSCF sends a SAR to the HSS to store or clear itself as the serving S-CSCF of a user. Server-Assignment-Type tells the HSS whether this is a registration.",
      flow: { request: { from: ["nf/S-CSCF"], to: ["nf/HSS"] } },
      apps: ["diam.app/16777216"],
      formats: [{ app: "diam.app/16777216", direction: "request", name: "Server-Assignment-Request", proxiable: true, avps: [] }],
      spec: [{ doc: "TS 29.229", version: "18.1.0", clause: "6.1.3" }],
      interfaces: ["if/Cx"],
    },
  },
  {
    id: "diam.avp/10415/655",
    score: 641.5,
    match: "prefix",
    entity: {
      id: "diam.avp/10415/655",
      kind: "avp",
      code: 655,
      vendor: 10415,
      name: "SAR-Flags",
      type: "Unsigned32",
      description: "A bit mask that the S-CSCF sends in a SAR. Bit 0 asks the HSS to run P-CSCF restoration.",
      spec: [{ doc: "TS 29.229", version: "18.1.0", clause: "6.3.63" }],
    },
  },
  {
    id: "diam.app/16777251",
    score: 657,
    match: "prefix",
    entity: {
      id: "diam.app/16777251",
      kind: "app",
      appId: 16777251,
      name: "3GPP S6a",
      short: "S6a/S6d",
      vendor: 10415,
      description: "The application between the MME (S6a) or SGSN (S6d) and the HSS.",
      spec: [
        { doc: "TS 29.272", version: "18.7.0", clause: "5" },
        { doc: "TS 29.272", version: "18.7.0", clause: "7" },
      ],
    },
  },
  {
    id: "nf/HSS",
    score: 1005,
    match: "exact",
    entity: { id: "nf/HSS", kind: "nf", name: "HSS", fullName: "Home Subscriber Server", description: "", spec: [{ doc: "TS 23.002" }] },
  },
  { id: "broken", score: 1, match: "exact", entity: { kind: "cmd" } },
]);

describe("telecom search", () => {
  it("maps the telecom-ref CLI's JSON to compact hits and skips entries it cannot read", () => {
    expect(parseTelecomHits(TELECOM_CLI_OUTPUT)).toEqual([
      {
        id: "diam.cmd/301",
        kind: "cmd",
        title: "SAR / SAA",
        name: "Server-Assignment",
        code: "301",
        summary: "The S-CSCF sends a SAR to the HSS to store or clear itself as the serving S-CSCF of a user.",
        spec: "TS 29.229 §6.1.3",
        flow: "S-CSCF → HSS",
        match: "exact",
        score: 1011,
      },
      {
        id: "diam.avp/10415/655",
        kind: "avp",
        title: "SAR-Flags",
        name: "SAR-Flags",
        code: "655",
        summary: "A bit mask that the S-CSCF sends in a SAR.",
        spec: "TS 29.229 §6.3.63",
        flow: null,
        match: "prefix",
        score: 641.5,
      },
      {
        id: "diam.app/16777251",
        kind: "app",
        title: "S6a/S6d",
        name: "3GPP S6a",
        code: "16777251",
        summary: "The application between the MME (S6a) or SGSN (S6d) and the HSS.",
        spec: "TS 29.272 §5; TS 29.272 §7",
        flow: null,
        match: "prefix",
        score: 657,
      },
      {
        id: "nf/HSS",
        kind: "nf",
        title: "HSS",
        name: "Home Subscriber Server",
        code: null,
        summary: "",
        spec: "TS 23.002",
        flow: null,
        match: "exact",
        score: 1005,
      },
    ]);
    expect(parseTelecomHits("{}")).toEqual([]);
  });

  it("runs the CLI once per query, passes the query after --, and forgets failures", async () => {
    const runs: string[][] = [];
    let fail = true;
    const search = telecomSearcher(async (args) => {
      runs.push([...args]);
      if (fail) throw new Error("timed out");
      return TELECOM_CLI_OUTPUT;
    }, 2);
    expect(await search("-SAR", 6)).toEqual([]);
    fail = false;
    expect(await search("-SAR", 6)).toHaveLength(4);
    await search("-SAR", 6);
    expect(runs).toHaveLength(2);
    expect(runs[1]).toEqual(["telecom-ref", "search", "--json", "--limit", "6", "--", "-SAR"]);
    await search("ULR", 6);
    await search("S6a", 6);
    await search("-SAR", 6);
    expect(runs).toHaveLength(5);
  });
});

describe("thread visits", () => {
  it("keeps the newest visit first without repeats, capped at 20", () => {
    expect(recordVisit(["b", "a"], "a")).toEqual(["a", "b"]);
    const many = Array.from({ length: 25 }, (_, index) => `t${index}`);
    expect(recordVisit(many, "new")).toHaveLength(20);
  });

  it("picks the latest visited thread other than the current one that still exists", () => {
    const threads = new Map([makeThread({ id: "a" }), makeThread({ id: "b", isArchived: true }), makeThread({ id: "c" })].map((thread) => [thread.id, thread]));
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
