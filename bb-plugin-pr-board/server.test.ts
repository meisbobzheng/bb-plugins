import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { RunOptions } from "./github";
import { FINDINGS_TOOL, REVIEW_SKILL, askMessage, createPlugin, parsePullArgument, reviewMessage, summaryPrompt } from "./server";

const HEAD = "1".repeat(40);
const BASE = "2".repeat(40);
const MERGE_BASE = "3".repeat(40);

const PULL_RESPONSE = {
  data: {
    viewer: { login: "me" },
    repository: {
      pullRequest: {
        id: "PR_node",
        number: 7,
        title: "Add thing",
        body: "Adds the thing.",
        url: "https://github.com/acme/app/pull/7",
        state: "OPEN",
        isDraft: false,
        isCrossRepository: false,
        additions: 10,
        deletions: 2,
        headRefName: "thing",
        baseRefName: "main",
        headRefOid: HEAD,
        baseRefOid: BASE,
        author: { login: "alice", avatarUrl: "https://a" },
        reviewThreads: { nodes: [] },
      },
    },
  },
};

const VIEWED_RESPONSE = {
  data: {
    repository: {
      pullRequest: {
        files: { nodes: [{ path: "a.go", viewerViewedState: "VIEWED" }], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    },
  },
};

interface FakeGitHub {
  open: number[];
  states: Record<number, string>;
  stateQueries: number[][];
}

function openPull(number: number) {
  return {
    number,
    title: "Add thing",
    url: `https://github.com/acme/app/pull/${number}`,
    isDraft: false,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    headRefName: "thing",
    baseRefName: "main",
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    reviewDecision: null,
    author: { __typename: "User", login: "alice", avatarUrl: "https://a" },
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [] },
    reviews: { nodes: [] },
    comments: { nodes: [] },
    reviewThreads: { nodes: [] },
    commits: { nodes: [] },
  };
}

function fakeRunner(github: FakeGitHub = { open: [7], states: {}, stateQueries: [] }) {
  const calls: Array<{ command: string; args: readonly string[]; options: RunOptions }> = [];
  const run = vi.fn(async (command: string, args: readonly string[], options: RunOptions) => {
    calls.push({ command, args, options });
    if (args[0] === "version") {
      if (command === "gh") return "gh version 2";
      throw new Error("not installed");
    }
    if (args[0] === "api" && args[1] === "graphql") {
      const { query } = JSON.parse(options.input ?? "{}") as { query: string };
      if (query.includes("pullRequests(states: OPEN")) {
        return JSON.stringify({ data: { repository: { pullRequests: { nodes: github.open.map(openPull) } } } });
      }
      const asked = [...query.matchAll(/pr(\d+): pullRequest/g)].map((match) => Number(match[1]));
      if (asked.length > 0) {
        github.stateQueries.push(asked);
        const pulls = Object.fromEntries(asked.map((number) => [`pr${number}`, { state: github.states[number] ?? "OPEN" }]));
        return JSON.stringify({ data: { repository: pulls } });
      }
      return JSON.stringify(query.includes("viewerViewedState") ? VIEWED_RESPONSE : PULL_RESPONSE);
    }
    if (args.includes("--paginate")) {
      return JSON.stringify([[{ filename: "a.go", status: "modified", additions: 10, deletions: 2, patch: "@@ -1,2 +1,3 @@\n a\n+b\n c" }]]);
    }
    if (args[0] === "api" && String(args[1]).includes("/compare/")) return `${MERGE_BASE}\n`;
    if (args[0] === "pr" && args[1] === "checkout") return "";
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  });
  return { run, calls };
}

function setup(github?: FakeGitHub, status: "idle" | "active" = "idle") {
  const runner = fakeRunner(github);
  const thread = makeThreadResponse({ id: "thr_review", environmentId: "env_1", status, deletedAt: null, archivedAt: null });
  let now = Date.now();
  const { bb, harness } = createFakePluginHost({
    pluginId: "pr-board",
    agentSkillIds: ["pr-board"],
    settings: { repos: "acme/app" },
    sdk: {
      projects: { list: async () => [{ id: "proj_app", gitRemoteUrl: "git@github.com:acme/app.git" }] as never },
      system: { config: async () => ({ primaryHostId: "host_1" }) as never },
      threads: {
        spawn: async () => thread as never,
        get: async () => thread as never,
        send: async () => ({ delivery: "queued" }) as never,
        archive: async () => ({ ok: true, archivedThreadIds: ["thr_review"] }) as never,
      },
      environments: { get: async () => ({ id: "env_1", status: "ready", path: "/tmp/worktree", hostId: "host_1" }) as never },
    },
  });
  createPlugin({ run: runner.run, pollMs: 1, now: () => now })(bb);
  return { harness, runner, advance: (ms: number) => (now += ms) };
}

function boardHost(repos: string) {
  let now = 1_000_000;
  const queried: string[] = [];
  const run = vi.fn(async (command: string, args: readonly string[], options: RunOptions) => {
    if (args[0] === "version") return "ok";
    if (args[1] === "user") return "me\n";
    if (args[1] === "user/teams") return "";
    if (args[1] === "graphql") {
      const { variables } = JSON.parse(options.input ?? "{}") as { variables: { owner: string; name: string } };
      queried.push(`${variables.owner}/${variables.name}`);
      return JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } });
    }
    if (args[1] === "repos/acme/API") return "acme/api\n";
    if (String(args[1]).startsWith("repos/")) throw new Error("HTTP 404");
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "pr-board", agentSkillIds: ["pr-board"], settings: { repos } });
  createPlugin({ run, pollMs: 1, now: () => now })(bb);
  return { harness, queried, advance: (ms: number) => (now += ms) };
}

describe("board", () => {
  it("fetches only the selected repository and falls back to the first configured one", async () => {
    const { harness, queried } = boardHost("acme/app, acme/web");
    const web = (await harness.behavior.callRpc("board", { repo: "acme/web", refresh: false })) as { repo: string; repos: string[] };
    expect(web).toMatchObject({ repo: "acme/web", repos: ["acme/app", "acme/web"] });
    expect(queried).toEqual(["acme/web"]);
    const fallback = (await harness.behavior.callRpc("board", { repo: "acme/gone", refresh: false })) as { repo: string };
    expect(fallback.repo).toBe("acme/app");
  });

  it("serves GitHub data from cache for 15 minutes unless refreshed", async () => {
    const { harness, queried, advance } = boardHost("acme/app");
    await harness.behavior.callRpc("board", { repo: null, refresh: false });
    advance(14 * 60_000);
    await harness.behavior.callRpc("board", { repo: null, refresh: false });
    expect(queried).toHaveLength(1);
    await harness.behavior.callRpc("board", { repo: null, refresh: true });
    expect(queried).toHaveLength(2);
    advance(15 * 60_000);
    await harness.behavior.callRpc("board", { repo: null, refresh: false });
    expect(queried).toHaveLength(3);
  });

  it("adds a repository by name under the configured owner, with GitHub's spelling", async () => {
    const { harness } = boardHost("acme/app");
    expect(await harness.behavior.callRpc("addRepo", { repo: "API" })).toEqual({ repo: "acme/api", repos: ["acme/app", "acme/api"] });
    expect(await harness.behavior.callRpc("addRepo", { repo: "acme/API" })).toEqual({ repo: "acme/api", repos: ["acme/app", "acme/api"] });
    await expect(harness.behavior.callRpc("addRepo", { repo: "missing" })).rejects.toThrow(/no repository acme\/missing/);
    const board = (await harness.behavior.callRpc("board", { repo: "acme/api", refresh: false })) as { repo: string };
    expect(board.repo).toBe("acme/api");
  });
});

describe("prompts", () => {
  it("asks for a simple summary first and names the diff command", () => {
    const prompt = summaryPrompt({
      repo: "acme/app",
      number: 7,
      nodeId: "n",
      title: "Add thing",
      body: "",
      url: "https://github.com/acme/app/pull/7",
      state: "OPEN",
      isDraft: false,
      isCrossRepository: false,
      author: { login: "alice", avatarUrl: null },
      headRefName: "thing",
      baseRefName: "main",
      headSha: HEAD,
      mergeBaseSha: MERGE_BASE,
      additions: 1,
      deletions: 0,
      viewer: "me",
      files: [{ path: "a.go", previousPath: null, status: "modified", additions: 1, deletions: 0, patch: null, viewed: false }],
      threads: [],
    });
    expect(prompt).toContain("Summarize this PR very simply");
    expect(prompt).toContain("gh pr diff 7 -R acme/app");
    expect(prompt).toContain("(no description)");
    expect(prompt).toContain("- a.go (+1/-0)");
  });

  it("starts the review message with the skill command and asks for recorded findings", () => {
    const message = reviewMessage({ repo: "acme/app", number: 7, baseRefName: "main" });
    expect(message.startsWith(`${REVIEW_SKILL} review pr 7`)).toBe(true);
    expect(message).toContain(FINDINGS_TOOL);
  });
});

describe("askMessage", () => {
  it("quotes the selected lines and names the version they come from", () => {
    const message = askMessage(
      { repo: "acme/app", number: 7, headSha: HEAD, mergeBaseSha: MERGE_BASE },
      { path: "a.go", side: "deletions", startLine: 3, endLine: 4 },
      "x := 1\ny := 2",
      "Why was this removed?",
    );
    expect(message).toBe(
      `Question from the PR Board diff about a.go lines 3-4 at the merge base ${MERGE_BASE.slice(0, 12)}:\n\n\`\`\`\nx := 1\ny := 2\n\`\`\`\n\nWhy was this removed?`,
    );
  });
});

describe("parsePullArgument", () => {
  it.each([
    ["https://github.com/acme/app/pull/12/files", { repo: "acme/app", number: 12 }],
    ["acme/app#12", { repo: "acme/app", number: 12 }],
    ["12", { repo: "acme/default", number: 12 }],
    ["twelve", null],
  ])("parses %s", (value, expected) => {
    expect(parsePullArgument(value, "acme/default")).toEqual(expected);
  });
});

describe("review threads", () => {
  it("spawns one worktree thread per PR, checks the PR out, then queues the review", async () => {
    const { harness, runner } = setup();
    const first = await harness.behavior.callRpc("openReview", { repo: "acme/app", number: 7 });
    expect(first).toEqual({ threadId: "thr_review", created: true });

    const [spawn] = harness.inspection.sdk.callsTo("threads.spawn");
    expect(spawn?.[0]).toMatchObject({
      projectId: "proj_app",
      environment: {
        type: "provider",
        environmentProviderId: "git-worktree",
        machine: { type: "existing", hostId: "host_1" },
        inputs: { branch: { kind: "named", name: "origin/thing" } },
      },
      title: "Review app#7: Add thing",
      pluginMetadata: { repo: "acme/app", number: 7 },
      providerId: "claude-code",
      model: "claude-opus-5-5",
      reasoningLevel: "high",
      permissionMode: "auto",
      executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
    });

    await vi.waitFor(() => expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1));
    const checkout = runner.calls.find((call) => call.args[0] === "pr" && call.args[1] === "checkout");
    expect(checkout?.options.cwd).toBe("/tmp/worktree");
    const [send] = harness.inspection.sdk.callsTo("threads.send");
    expect(JSON.stringify(send?.[0])).toContain(`${REVIEW_SKILL} review pr 7`);

    const second = await harness.behavior.callRpc("openReview", { repo: "acme/app", number: 7 });
    expect(second).toEqual({ threadId: "thr_review", created: false });
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  });
});

describe("archiving finished reviews", () => {
  async function reviewed(github: FakeGitHub, status: "idle" | "active" = "idle") {
    const host = setup(github, status);
    await host.harness.behavior.callRpc("openReview", { repo: "acme/app", number: 7 });
    await host.harness.behavior.callAgentTool(
      FINDINGS_TOOL,
      { findings: [{ path: "a.go", severity: "nit", title: "x", body: "" }] },
      { threadId: "thr_review" },
    );
    return host;
  }

  it("archives the review thread once its PR leaves the open list as merged, then forgets it", async () => {
    const github: FakeGitHub = { open: [7], states: { 7: "MERGED" }, stateQueries: [] };
    const { harness, advance } = await reviewed(github);
    await harness.behavior.runSchedule("archive-finished-reviews");
    expect(github.stateQueries).toEqual([]);

    github.open = [];
    advance(15 * 60_000);
    await harness.behavior.runSchedule("archive-finished-reviews");
    expect(github.stateQueries).toEqual([[7]]);
    expect(harness.inspection.sdk.callsTo("threads.archive")).toEqual([[{ threadId: "thr_review" }]]);
    expect(await harness.behavior.callRpc("pullForThread", { threadId: "thr_review" })).toBeNull();
    const state = (await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as { findings: unknown[] };
    expect(state.findings).toEqual([]);

    advance(15 * 60_000);
    await harness.behavior.runSchedule("archive-finished-reviews");
    expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(1);
    expect(github.stateQueries).toHaveLength(1);
  });

  it("keeps the review thread of a PR that is still open or whose agent is still running", async () => {
    const open: FakeGitHub = { open: [], states: { 7: "OPEN" }, stateQueries: [] };
    const running: FakeGitHub = { open: [], states: { 7: "CLOSED" }, stateQueries: [] };
    for (const [github, status] of [[open, "idle"], [running, "active"]] as const) {
      const { harness } = await reviewed(github, status);
      await harness.behavior.runSchedule("archive-finished-reviews");
      expect(github.stateQueries).toEqual([[7]]);
      expect(harness.inspection.sdk.callsTo("threads.archive")).toEqual([]);
      expect(await harness.behavior.callRpc("pullForThread", { threadId: "thr_review" })).toEqual({ repo: "acme/app", number: 7 });
    }
  });
});

describe("review execution settings", () => {
  it("spawns with the configured model, effort, and mode, and the project's model when the model is empty", async () => {
    const runner = fakeRunner();
    const thread = makeThreadResponse({ id: "thr_review", environmentId: "env_1", status: "idle", deletedAt: null, archivedAt: null });
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-board",
      agentSkillIds: ["pr-board"],
      settings: { repos: "acme/app", reviewModel: " ", reviewReasoning: "xhigh", reviewPermissionMode: "accept-edits" },
      sdk: {
        projects: { list: async () => [{ id: "proj_app", gitRemoteUrl: "git@github.com:acme/app.git" }] as never },
        system: { config: async () => ({ primaryHostId: "host_1" }) as never },
        threads: { spawn: async () => thread as never, get: async () => null as never, send: async () => ({ delivery: "queued" }) as never },
        environments: { get: async () => ({ id: "env_1", status: "ready", path: "/tmp/worktree", hostId: "host_1" }) as never },
      },
    });
    createPlugin({ run: runner.run, pollMs: 1, now: Date.now })(bb);
    await harness.behavior.callRpc("openReview", { repo: "acme/app", number: 7 });
    const [spawn] = harness.inspection.sdk.callsTo("threads.spawn");
    const args = spawn?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({ providerId: "claude-code", reasoningLevel: "xhigh", permissionMode: "accept-edits" });
    expect(args).not.toHaveProperty("model");
    expect(args.executionInputSources).toEqual({ providerId: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" });
  });
});

describe("findings tool", () => {
  it("is offered only to threads that carry review metadata", async () => {
    const { harness } = setup();
    const review = await harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({ pluginMetadata: { repo: "acme/app", number: 7 } }),
    );
    const other = await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext());
    expect(review.tools.map((tool) => tool.name)).toEqual([FINDINGS_TOOL]);
    expect(other.tools).toEqual([]);
    expect(other.skills).toEqual(["pr-board"]);
  });

  it("records findings for the thread's PR and replaces earlier ones", async () => {
    const { harness } = setup();
    await harness.behavior.callRpc("openReview", { repo: "acme/app", number: 7 });
    const finding = { path: "./a.go", startLine: 9, endLine: 3, severity: "major", title: "Split this", body: "Too big" };
    await harness.behavior.callAgentTool(FINDINGS_TOOL, { findings: [finding, { ...finding, title: "Second" }] }, { threadId: "thr_review" });
    const result = await harness.behavior.callAgentTool(FINDINGS_TOOL, { findings: [finding] }, { threadId: "thr_review" });
    expect(result).toContain("Recorded 1 finding for acme/app#7");

    const state = (await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as {
      findings: Array<Record<string, unknown>>;
      agent: { findings: number };
    };
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0]).toMatchObject({ path: "a.go", side: "additions", startLine: 3, endLine: 9, headSha: HEAD });
    expect(state.agent.findings).toBe(1);
  });

  it("refuses threads that PR Board did not start", async () => {
    const { harness } = setup();
    const result = await harness.behavior.callAgentTool(
      FINDINGS_TOOL,
      { findings: [{ path: "a.go", severity: "nit", title: "x", body: "" }] },
      { threadId: "thr_other" },
    );
    expect(result).toMatchObject({ isError: true });
  });
});

describe("drafts", () => {
  it("keeps drafts per PR and will not move one to another PR", async () => {
    const { harness } = setup();
    const target = { path: "a.go", side: "additions", startLine: 2, endLine: 2, body: "Why?" };
    const draft = (await harness.behavior.callRpc("saveDraft", { repo: "acme/app", number: 7, id: null, ...target })) as { id: string };
    await expect(
      harness.behavior.callRpc("saveDraft", { repo: "acme/app", number: 8, id: draft.id, ...target }),
    ).rejects.toThrow();
    const state = (await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as { drafts: unknown[] };
    expect(state.drafts).toHaveLength(1);
  });
});
