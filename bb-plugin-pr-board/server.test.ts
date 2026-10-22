import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { Board } from "./contract";
import type { RunOptions } from "./github";
import { FINDINGS_TOOL, REVIEW_SKILL, SUGGESTIONS_TOOL, askMessage, createPlugin, parsePullArgument, reviewMessage, summaryPrompt } from "./server";

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
        updatedAt: "2026-10-02T00:00:00Z",
        baseRefOid: BASE,
        author: { login: "alice", avatarUrl: "https://a" },
        reviewThreads: {
          nodes: [
            {
              id: "PRRT_1",
              isResolved: false,
              isOutdated: false,
              path: "a.go",
              line: 2,
              startLine: null,
              diffSide: "RIGHT",
              comments: {
                nodes: [{ id: "c1", databaseId: 11, body: "Rename b", createdAt: "2026-10-01T00:00:00Z", url: "u", author: { login: "carol" } }],
              },
            },
          ],
        },
        comments: { nodes: [{ id: "IC_1", body: "Add a test", createdAt: "2026-10-02T00:00:00Z", url: "u", author: { login: "dave" } }] },
        reviews: { nodes: [] },
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

function boardNode(number: number, overrides: { author?: string; comments?: string[]; threads?: string[][] } = {}) {
  const user = (login: string) => ({ __typename: "User", login, avatarUrl: null });
  return {
    id: `PR_${number}`,
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    isDraft: false,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    headRefName: `branch-${number}`,
    baseRefName: "main",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    reviewDecision: null,
    author: user(overrides.author ?? "alice"),
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [] },
    reviews: { pageInfo: { hasPreviousPage: false }, nodes: [] },
    comments: {
      pageInfo: { hasPreviousPage: false },
      nodes: (overrides.comments ?? []).map((login, index) => ({ createdAt: `2026-10-0${index + 1}T00:00:00Z`, author: user(login) })),
    },
    reviewThreads: {
      nodes: (overrides.threads ?? []).map((authors) => ({ isResolved: false, comments: { nodes: authors.map((login) => ({ author: user(login) })) } })),
    },
    commits: { nodes: [] } as { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> },
  };
}

interface GraphqlVariables {
  owner?: string;
  name?: string;
  number?: number;
  ids?: string[];
}

function fakeRunner(pullResponse: unknown = PULL_RESPONSE, onGraphql?: (variables: GraphqlVariables) => Promise<void> | void) {
  const board = [boardNode(1), boardNode(2), boardNode(3)];
  const states: Record<number, string> = {};
  const stateQueries: number[][] = [];
  const calls: Array<{ command: string; args: readonly string[]; options: RunOptions }> = [];
  const run = vi.fn(async (command: string, args: readonly string[], options: RunOptions) => {
    calls.push({ command, args, options });
    if (args[0] === "version") {
      if (command === "gh") return "gh version 2";
      throw new Error("not installed");
    }
    if (args[0] === "api" && args[1] === "user") return "me\n";
    if (args[0] === "api" && args[1] === "user/teams") return "";
    if (args[0] === "api" && args[1] === "graphql") {
      const { query, variables } = JSON.parse(options.input ?? "{}") as { query: string; variables: GraphqlVariables };
      await onGraphql?.(variables);
      if (query.includes("OpenPullBranches")) {
        const pr = (number: number, headRefName: string, baseRefName: string) => ({ number, title: `PR ${number}`, url: "u", headRefName, baseRefName, isCrossRepository: false });
        return JSON.stringify({ data: { repository: { pullRequests: { nodes: [pr(7, "thing", "main"), pr(8, "thing-2", "thing")] } } } });
      }
      const asked = [...query.matchAll(/pr(\d+): pullRequest/g)].map((match) => Number(match[1]));
      if (asked.length > 0) {
        stateQueries.push(asked);
        const pulls = Object.fromEntries(asked.map((number) => [`pr${number}`, { state: states[number] ?? "OPEN" }]));
        return JSON.stringify({ data: { repository: pulls } });
      }
      if (variables.ids !== undefined) {
        return JSON.stringify({ data: { nodes: variables.ids.map((id) => board.find((node) => node.id === id) ?? null) } });
      }
      if (variables.owner !== undefined && variables.number === undefined) {
        const listed = `${variables.owner}/${variables.name}` === "acme/app" ? board : [];
        const nodes = listed.map((node) => ({ id: node.id, number: node.number, updatedAt: node.updatedAt, commits: node.commits }));
        return JSON.stringify({ data: { repository: { pullRequests: { nodes } } } });
      }
      return JSON.stringify(query.includes("viewerViewedState") ? VIEWED_RESPONSE : pullResponse);
    }
    if (args.includes("--paginate")) {
      return JSON.stringify([[{ filename: "a.go", status: "modified", additions: 10, deletions: 2, patch: "@@ -1,2 +1,3 @@\n a\n+b\n c" }]]);
    }
    if (args[0] === "api" && String(args[1]).includes("/compare/")) return `${MERGE_BASE}\n`;
    if (args[0] === "api" && args[1] === "--method") return "{}";
    if (args[0] === "api" && args[1] === "repos/acme/API") return "acme/api\n";
    if (args[0] === "api" && String(args[1]).startsWith("repos/")) throw new Error("HTTP 404");
    if (args[0] === "pr" && args[1] === "checkout") return "";
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  });
  const graphqlVariables = () =>
    calls.flatMap((call) => (call.args[1] === "graphql" ? [(JSON.parse(call.options.input ?? "{}") as { variables: GraphqlVariables }).variables] : []));
  return { run, calls, board, states, stateQueries, graphqlVariables };
}

function setup({
  now = Date.now,
  onGraphql,
  pullResponse = PULL_RESPONSE,
  repos = "acme/app",
  status = "idle",
}: { now?: () => number; onGraphql?: Parameters<typeof fakeRunner>[1]; pullResponse?: unknown; repos?: string | null; status?: "idle" | "active" } = {}) {
  const runner = fakeRunner(pullResponse, onGraphql);
  const thread = makeThreadResponse({ id: "thr_review", environmentId: "env_1", status, deletedAt: null, archivedAt: null });
  const { bb, harness } = createFakePluginHost({
    pluginId: "pr-board",
    agentSkillIds: ["pr-board"],
    settings: repos === null ? {} : { repos },
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
  createPlugin({ run: runner.run, pollMs: 1, now })(bb);
  return { harness, runner };
}

type Harness = ReturnType<typeof setup>["harness"];
type Runner = ReturnType<typeof setup>["runner"];

describe("board", () => {
  let clock = 0;
  beforeEach(() => {
    clock = Date.parse("2026-10-14T12:00:00Z");
  });
  const board = (harness: Harness, refresh = false, repo: string | null = null) =>
    harness.behavior.callRpc("board", { repo, refresh }) as Promise<Board>;
  const since = (runner: Runner, start: number) => {
    const variables = runner.graphqlVariables().slice(start);
    return {
      lists: variables.flatMap((entry) => (entry.owner !== undefined && entry.number === undefined ? [`${entry.owner}/${entry.name}`] : [])),
      ids: variables.flatMap((entry) => entry.ids ?? []),
    };
  };

  it("starts with no repository and takes the first one as owner/repo", async () => {
    const { harness, runner } = setup({ repos: null });
    expect(await board(harness)).toMatchObject({ repo: null, repos: [], cards: [] });
    expect(since(runner, 0).lists).toEqual([]);
    await expect(harness.behavior.callRpc("addRepo", { repo: "API" })).rejects.toThrow(/owner\/repo/);
    expect(await harness.behavior.callRpc("addRepo", { repo: "acme/API" })).toEqual({ repo: "acme/api", repos: ["acme/api"] });
  });

  it("fetches only the selected repository and falls back to the first configured one", async () => {
    const { harness, runner } = setup({ repos: "acme/app, acme/web" });
    const web = await board(harness, false, "acme/web");
    expect(web).toMatchObject({ repo: "acme/web", repos: ["acme/app", "acme/web"] });
    expect(since(runner, 0).lists).toEqual(["acme/web"]);
    const fallback = await board(harness, false, "acme/gone");
    expect(fallback.repo).toBe("acme/app");
  });

  it("checks the open PRs cheaply, then fetches the details of each one it has not seen", async () => {
    const { harness, runner } = setup({ now: () => clock });
    const result = await board(harness);
    expect(result.cards.map((card) => card.number)).toEqual([1, 2, 3]);
    expect(since(runner, 0)).toEqual({ lists: ["acme/app"], ids: ["PR_1", "PR_2", "PR_3"] });
  });

  it("reuses the last check for 50 seconds, then fetches details only for PRs that changed", async () => {
    const { harness, runner } = setup({ now: () => clock });
    await board(harness);
    clock += 49_000;
    let start = runner.graphqlVariables().length;
    await board(harness);
    expect(since(runner, start)).toEqual({ lists: [], ids: [] });

    clock += 2_000;
    start = runner.graphqlVariables().length;
    await board(harness);
    expect(since(runner, start)).toEqual({ lists: ["acme/app"], ids: [] });

    clock += 60_000;
    runner.board[2]!.updatedAt = "2026-10-14T12:01:00Z";
    start = runner.graphqlVariables().length;
    await board(harness);
    expect(since(runner, start)).toEqual({ lists: ["acme/app"], ids: ["PR_3"] });
  });

  it("updates CI status from the cheap check without fetching details", async () => {
    const { harness, runner } = setup({ now: () => clock });
    await board(harness);
    clock += 61_000;
    runner.board[0]!.commits = { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] };
    const start = runner.graphqlVariables().length;
    const result = await board(harness);
    expect(since(runner, start).ids).toEqual([]);
    expect(result.cards.find((card) => card.number === 1)?.checks).toBe("failure");
  });

  it("fetches every PR again on Refresh and every 15 minutes", async () => {
    const { harness, runner } = setup({ now: () => clock });
    await board(harness);
    let start = runner.graphqlVariables().length;
    await board(harness, true);
    expect(since(runner, start)).toEqual({ lists: ["acme/app"], ids: ["PR_1", "PR_2", "PR_3"] });

    clock += 15 * 60_000;
    start = runner.graphqlVariables().length;
    await board(harness);
    expect(since(runner, start)).toEqual({ lists: ["acme/app"], ids: ["PR_1", "PR_2", "PR_3"] });
  });

  it("keeps the last board and the time GitHub was last read when a check fails", async () => {
    const { harness, runner } = setup({ now: () => clock });
    const first = await board(harness);
    clock += 61_000;
    runner.run.mockImplementation(async () => {
      throw new Error("gh api graphql: error connecting to api.github.com");
    });
    const failed = await board(harness);
    expect(failed.fetchedAt).toBe(first.fetchedAt);
    expect(failed.cards).toHaveLength(3);
    expect(failed.errors).toEqual([{ repo: "acme/app", message: "gh api graphql: error connecting to api.github.com" }]);
  });

  it("checks again right away and refetches a PR after you act on it from PR Board", async () => {
    const { harness, runner } = setup({ now: () => clock });
    await board(harness);
    await harness.behavior.callRpc("reply", { repo: "acme/app", number: 3, commentId: 1, body: "Thanks" });
    const start = runner.graphqlVariables().length;
    await board(harness);
    expect(since(runner, start)).toEqual({ lists: ["acme/app"], ids: ["PR_3"] });
  });

  it("checks GitHub on every minute tick even when a check takes a few seconds", async () => {
    const { harness, runner } = setup({
      now: () => clock,
      onGraphql: (variables) => {
        if (variables.owner !== undefined && variables.number === undefined) clock += 2_000;
      },
    });
    const lists: number[] = [];
    for (let tick = 0; tick < 4; tick++) {
      const start = runner.graphqlVariables().length;
      await board(harness);
      lists.push(since(runner, start).lists.length);
      clock = Date.parse("2026-10-14T12:00:00Z") + (tick + 1) * 60_000;
    }
    expect(lists).toEqual([1, 1, 1, 1]);
  });

  function gatedSetup() {
    let hold: Promise<void> | null = null;
    let reached = () => {};
    let release = () => {};
    const { harness, runner } = setup({
      now: () => clock,
      onGraphql: (variables) => {
        if (hold !== null && variables.ids?.includes("PR_2")) {
          reached();
          return hold;
        }
      },
    });
    const arm = () => {
      const atGate = new Promise<void>((resolve) => {
        reached = resolve;
      });
      hold = new Promise<void>((resolve) => {
        release = () => {
          hold = null;
          resolve();
        };
      });
      return atGate;
    };
    return { harness, runner, arm, release: () => release() };
  }

  it("refetches a PR you acted on even when a check of it was already in flight", async () => {
    const { harness, runner, arm, release } = gatedSetup();
    await board(harness);
    clock += 15 * 60_000;
    const atGate = arm();
    const inFlight = board(harness);
    await atGate;
    await harness.behavior.callRpc("reply", { repo: "acme/app", number: 2, commentId: 1, body: "Thanks" });
    release();
    await inFlight;
    const start = runner.graphqlVariables().length;
    await board(harness);
    expect(since(runner, start)).toEqual({ lists: ["acme/app"], ids: ["PR_2"] });
  });

  it("does not hand a board load after an action the check that started before it", async () => {
    const { harness, runner, arm, release } = gatedSetup();
    await board(harness);
    clock += 15 * 60_000;
    const atGate = arm();
    const inFlight = board(harness);
    await atGate;
    await harness.behavior.callRpc("reply", { repo: "acme/app", number: 2, commentId: 1, body: "Thanks" });
    const start = runner.graphqlVariables().length;
    const after = board(harness);
    await vi.waitFor(() => expect(since(runner, start).lists).toEqual(["acme/app"]));
    release();
    await Promise.all([inFlight, after]);
  });

  it("shares one check between board requests that arrive together", async () => {
    const { harness, runner } = setup({ now: () => clock });
    await Promise.all([board(harness), board(harness), board(harness)]);
    expect(since(runner, 0)).toEqual({ lists: ["acme/app"], ids: ["PR_1", "PR_2", "PR_3"] });
  });

  it("adds a repository by name under the configured owner, with GitHub's spelling", async () => {
    const { harness } = setup();
    expect(await harness.behavior.callRpc("addRepo", { repo: "API" })).toEqual({ repo: "acme/api", repos: ["acme/app", "acme/api"] });
    expect(await harness.behavior.callRpc("addRepo", { repo: "acme/API" })).toEqual({ repo: "acme/api", repos: ["acme/app", "acme/api"] });
    await expect(harness.behavior.callRpc("addRepo", { repo: "missing" })).rejects.toThrow(/no repository acme\/missing/);
    const result = await board(harness, false, "acme/api");
    expect(result.repo).toBe("acme/api");
  });

  it("counts the comments waiting for my reply on each card", async () => {
    const { harness, runner } = setup();
    runner.board.splice(
      0,
      runner.board.length,
      boardNode(1, { author: "me", comments: ["alice"] }),
      boardNode(2, { comments: ["alice"] }),
      boardNode(3, { comments: ["me"] }),
      boardNode(4, { comments: ["me", "alice"] }),
      boardNode(5, { threads: [["me", "bob"], ["bob"]] }),
    );
    const { cards } = await board(harness);
    expect(cards.map((card) => [card.number, card.unansweredComments])).toEqual([
      [1, 1],
      [2, 0],
      [3, 0],
      [4, 1],
      [5, 1],
    ]);
  });
});

describe("pull detail cache", () => {
  let clock = 0;
  beforeEach(() => {
    clock = Date.parse("2026-10-14T12:00:00Z");
  });

  function counting() {
    const response = structuredClone(PULL_RESPONSE);
    const { harness, runner } = setup({ now: () => clock, pullResponse: response });
    const count = () => ({
      full: runner.calls.filter((call) => call.args.includes("--slurp")).length,
      checks: runner.calls.filter((call) => (call.options.input ?? "").includes("query PullVersion")).length,
    });
    const open = () => harness.behavior.callRpc("pull", { repo: "acme/app", number: 7, refresh: false }) as Promise<{ files: Array<{ viewed: boolean }> }>;
    return { harness, runner, response, count, open };
  }

  it("reuses an opened PR for 50 seconds, then checks a tiny version before refetching", async () => {
    const { count, open } = counting();
    await open();
    await open();
    expect(count()).toEqual({ full: 1, checks: 0 });
    clock += 51_000;
    await open();
    expect(count()).toEqual({ full: 1, checks: 1 });
  });

  it("refetches the PR when its update time, head, or resolved threads change", async () => {
    const { response, count, open } = counting();
    await open();
    clock += 51_000;
    response.data.repository.pullRequest.reviewThreads.nodes[0]!.isResolved = true;
    await open();
    expect(count()).toEqual({ full: 2, checks: 1 });
    clock += 51_000;
    response.data.repository.pullRequest.updatedAt = "2026-10-14T12:01:00Z";
    await open();
    expect(count()).toEqual({ full: 3, checks: 2 });
  });

  it("reuses the merge base while the PR's base and head commits stay the same", async () => {
    const { harness, runner, response } = counting();
    const fetch = () => harness.behavior.callRpc("pull", { repo: "acme/app", number: 7, refresh: true }) as Promise<{ mergeBaseSha: string }>;
    const compares = () => runner.calls.filter((call) => String(call.args[1]).includes("/compare/")).length;
    await fetch();
    response.data.repository.pullRequest.updatedAt = "2026-10-14T12:01:00Z";
    expect((await fetch()).mergeBaseSha).toBe(MERGE_BASE);
    expect(compares()).toBe(1);
    response.data.repository.pullRequest.headRefOid = "4".repeat(40);
    await fetch();
    expect(compares()).toBe(2);
  });

  it("trusts the board's check from the last 50 seconds instead of asking GitHub again", async () => {
    const { harness, runner, count, open } = counting();
    runner.board.push({ ...boardNode(7), id: "PR_node" });
    await open();
    clock += 51_000;
    await harness.behavior.callRpc("board", { repo: null, refresh: false });
    await open();
    expect(count()).toEqual({ full: 1, checks: 0 });
  });

  it("keeps the saved PR when you mark a file viewed, and checks again after you act on the PR", async () => {
    const { harness, count, open } = counting();
    await open();
    await harness.behavior.callRpc("setViewed", { repo: "acme/app", number: 7, pullNodeId: "PR_node", path: "a.go", viewed: false });
    expect((await open()).files[0]?.viewed).toBe(false);
    expect(count()).toEqual({ full: 1, checks: 0 });
    await harness.behavior.callRpc("reply", { repo: "acme/app", number: 7, commentId: 1, body: "Thanks" });
    await open();
    expect(count()).toEqual({ full: 1, checks: 1 });
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
      updatedAt: "2026-10-02T00:00:00Z",
      mergeBaseSha: MERGE_BASE,
      additions: 1,
      deletions: 0,
      viewer: "me",
      files: [{ path: "a.go", previousPath: null, status: "modified", additions: 1, deletions: 0, patch: null, viewed: false }],
      threads: [],
      conversation: [],
      awaitingReply: [],
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

  it("announces its PR when a review thread starts, stops, or is archived, and ignores other threads", async () => {
    const { harness } = setup();
    await harness.behavior.callRpc("openReview", { repo: "acme/app", number: 7 });
    await vi.waitFor(() => expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1));
    const before = harness.inspection.realtimeSignals.length;
    const review = makeThreadResponse({ id: "thr_review" });
    await harness.behavior.emitThreadEvent("thread.idle", { thread: review, lastAssistantText: null });
    await harness.behavior.emitThreadEvent("thread.archived", { thread: review });
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "thr_other" }) });
    expect(harness.inspection.realtimeSignals.slice(before)).toEqual([
      { channel: "pr-board-updates", payload: { repo: "acme/app", number: 7 } },
      { channel: "pr-board-updates", payload: { repo: "acme/app", number: 7 } },
    ]);
  });
});

describe("archiving finished reviews", () => {
  async function reviewed(status: "idle" | "active" = "idle") {
    let clock = Date.parse("2026-10-14T12:00:00Z");
    const host = setup({ now: () => clock, status });
    host.runner.board.push(boardNode(7));
    await host.harness.behavior.callRpc("openReview", { repo: "acme/app", number: 7 });
    await host.harness.behavior.callAgentTool(
      FINDINGS_TOOL,
      { findings: [{ path: "a.go", severity: "nit", title: "x", body: "" }] },
      { threadId: "thr_review" },
    );
    return { ...host, advance: (ms: number) => (clock += ms) };
  }

  it("archives the review thread once its PR leaves the open list as merged, then forgets it", async () => {
    const { harness, runner, advance } = await reviewed();
    runner.states[7] = "MERGED";
    await harness.behavior.runSchedule("archive-finished-reviews");
    expect(runner.stateQueries).toEqual([]);

    runner.board.pop();
    advance(15 * 60_000);
    await harness.behavior.runSchedule("archive-finished-reviews");
    expect(runner.stateQueries).toEqual([[7]]);
    expect(harness.inspection.sdk.callsTo("threads.archive")).toEqual([[{ threadId: "thr_review" }]]);
    expect(await harness.behavior.callRpc("pullForThread", { threadId: "thr_review" })).toBeNull();
    const state = (await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as { findings: unknown[] };
    expect(state.findings).toEqual([]);

    advance(15 * 60_000);
    await harness.behavior.runSchedule("archive-finished-reviews");
    expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(1);
    expect(runner.stateQueries).toHaveLength(1);
  });

  it("keeps the review thread of a PR that is still open or whose agent is still running", async () => {
    for (const [state, status] of [["OPEN", "idle"], ["CLOSED", "active"]] as const) {
      const { harness, runner } = await reviewed(status);
      runner.board.pop();
      runner.states[7] = state;
      await harness.behavior.runSchedule("archive-finished-reviews");
      expect(runner.stateQueries).toEqual([[7]]);
      expect(harness.inspection.sdk.callsTo("threads.archive")).toEqual([]);
      expect(await harness.behavior.callRpc("pullForThread", { threadId: "thr_review" })).toEqual({ repo: "acme/app", number: 7 });
    }
  });

  it("logs a failed check once until a check succeeds, as a note when GitHub is unreachable", async () => {
    const { harness, runner, advance } = await reviewed();
    const failWith = (message: string) =>
      runner.run.mockImplementation(async () => {
        throw new Error(message);
      });
    const check = async () => {
      advance(15 * 60_000);
      await harness.behavior.runSchedule("archive-finished-reviews");
    };
    const logged = () => harness.inspection.logEntries.filter((entry) => entry.message.startsWith("could not check acme/app")).map((entry) => entry.level);
    failWith("gh api graphql: error connecting to api.github.com");
    await check();
    await check();
    expect(logged()).toEqual(["info"]);
    failWith("gh api graphql: HTTP 401: Bad credentials");
    await check();
    await check();
    expect(logged()).toEqual(["info", "warn"]);
    runner.run.mockReset();
    await check();
    failWith("gh api graphql: HTTP 401: Bad credentials");
    await check();
    expect(logged()).toEqual(["info", "warn", "warn"]);
  });

  it("skips a repository whose open list could not be read", async () => {
    const { harness, runner, advance } = await reviewed();
    runner.run.mockImplementation(async () => {
      throw new Error("HTTP 502");
    });
    advance(60_000);
    await harness.behavior.runSchedule("archive-finished-reviews");
    expect(harness.inspection.sdk.callsTo("threads.archive")).toEqual([]);
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

describe("address comments", () => {
  let worktree: string;
  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "pr-board-address-"));
    await writeFile(join(worktree, "a.go"), "package a\n\nfunc b() {}\n");
  });
  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
  });

  function addressSetup({ gitStatus = "", heads = [HEAD], pullError, pull }: { gitStatus?: string; heads?: string[]; pullError?: string; pull?: unknown } = {}) {
    const runner = fakeRunner(pull);
    const git: string[][] = [];
    const remaining = [...heads];
    const run = vi.fn(async (command: string, args: readonly string[], options: RunOptions) => {
      if (command !== "git") return runner.run(command, args, options);
      git.push([...args]);
      if (args[0] === "status") return gitStatus;
      if (args[0] === "rev-parse") return `${remaining.length > 1 ? remaining.shift() : remaining[0]}\n`;
      if (args[0] === "pull") {
        if (pullError !== undefined) throw new Error(pullError);
        return "";
      }
      return runner.run(command, args, options);
    });
    const thread = makeThreadResponse({ id: "thr_address", environmentId: "env_1", status: "idle", deletedAt: null, archivedAt: null });
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
        },
        environments: { get: async () => ({ id: "env_1", status: "ready", path: worktree, hostId: "host_1" }) as never },
      },
    });
    createPlugin({ run, pollMs: 1, now: Date.now })(bb);
    return { harness, runner, git };
  }

  const record = (harness: ReturnType<typeof addressSetup>["harness"], suggestions: unknown[]) =>
    harness.behavior.callAgentTool(SUGGESTIONS_TOOL, { suggestions }, { threadId: "thr_address" });

  it("starts an address thread that gets only the suggestions tool, then re-sends the comments to it", async () => {
    const { harness, runner } = addressSetup();
    const first = await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    expect(first).toEqual({ threadId: "thr_address", created: true, delivery: "queued" });
    const [spawn] = harness.inspection.sdk.callsTo("threads.spawn");
    expect(spawn?.[0]).toMatchObject({ pluginMetadata: { repo: "acme/app", number: 7, kind: "address" } });
    expect(JSON.stringify(spawn?.[0])).toContain("[PRRT_1] a.go line 2");
    expect(JSON.stringify(spawn?.[0])).toContain("#8 thing-2 into thing");
    await vi.waitFor(() => expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1));
    expect(runner.calls.find((call) => call.args[0] === "pr" && call.args[1] === "checkout")?.options.cwd).toBe(worktree);
    expect(JSON.stringify(harness.inspection.sdk.callsTo("threads.send")[0]?.[0])).toContain(SUGGESTIONS_TOOL);

    const again = await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    expect(again).toEqual({ threadId: "thr_address", created: false, delivery: "queued" });
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(JSON.stringify(harness.inspection.sdk.callsTo("threads.send")[1]?.[0])).toContain("[IC_1]");

    const address = await harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({ pluginMetadata: { repo: "acme/app", number: 7, kind: "address" } }),
    );
    expect(address.tools.map((tool) => tool.name)).toEqual([SUGGESTIONS_TOOL]);
  });

  it("starts no thread when every comment's last reply is mine", async () => {
    const pullRequest = PULL_RESPONSE.data.repository.pullRequest;
    const [thread] = pullRequest.reviewThreads.nodes;
    const answered = {
      data: {
        ...PULL_RESPONSE.data,
        repository: {
          pullRequest: {
            ...pullRequest,
            reviewThreads: {
              nodes: [
                {
                  ...thread!,
                  comments: {
                    nodes: [
                      ...thread!.comments.nodes,
                      { id: "c2", databaseId: 12, body: "Done", createdAt: "2026-10-03T00:00:00Z", url: "u", author: { login: "me" } },
                    ],
                  },
                },
              ],
            },
            comments: {
              nodes: [
                ...pullRequest.comments.nodes,
                { id: "IC_2", body: "Added", createdAt: "2026-10-03T00:00:00Z", url: "u", author: { login: "me" } },
              ],
            },
          },
        },
      },
    };
    const { harness } = addressSetup({ pull: answered });
    await expect(harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 })).rejects.toThrow(
      "No comments are waiting for your reply",
    );
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("moves the address worktree to the PR's new commits before sending the comments again", async () => {
    const { harness, git } = addressSetup({ heads: ["4".repeat(40), HEAD] });
    await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    await vi.waitFor(() => expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1));
    await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    expect(git).toEqual([["rev-parse", "HEAD"], ["pull", "--ff-only"], ["rev-parse", "HEAD"]]);
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(2);
  });

  it("does not send the comments again when the address worktree cannot reach the PR's new commits", async () => {
    const { harness } = addressSetup({ heads: ["4".repeat(40)], pullError: "Your local changes to a.go would be overwritten by merge" });
    await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    await vi.waitFor(() => expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1));
    await expect(harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 })).rejects.toThrow(
      "Could not update the address thread's worktree to the PR's latest commit 111111111111: Your local changes to a.go would be overwritten by merge",
    );
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1);
  });

  it("rejects suggestions with unknown comments or edits that do not match, and records nothing", async () => {
    const { harness } = addressSetup();
    await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    const result = await record(harness, [
      { commentId: "PRRT_1", summary: "Rename", changes: [{ path: "a.go", find: "func c() {}", replace: "func d() {}" }] },
      { commentId: "nope", summary: "Reply", reply: "Thanks" },
      { commentId: "IC_1", summary: "Empty" },
    ]);
    expect(result).toMatchObject({ isError: true });
    const text = JSON.stringify(result);
    expect(text).toContain("not found in a.go");
    expect(text).toContain("no unresolved code comment");
    expect(text).toContain("give a reply, changes, or both");
    const state = (await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as { suggestions: unknown[] };
    expect(state.suggestions).toEqual([]);
  });

  it("records, previews, applies, and dismisses suggestions in the address thread's worktree", async () => {
    const { harness } = addressSetup();
    await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    const result = await record(harness, [
      { commentId: "PRRT_1", summary: "Rename b to c", reply: "Renamed.", changes: [{ path: `${worktree}/a.go`, find: "func b() {}", replace: "func c() {}" }] },
      { commentId: "IC_1", summary: "Add a test", changes: [{ path: "a_test.go", find: "", replace: "package a\n" }] },
    ]);
    expect(result).toContain("Recorded 2 suggestions for acme/app#7");
    const state = (await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as {
      addressAgent: { threadId: string | null };
      suggestions: Array<{ id: string; commentId: string; edits: Array<{ path: string }>; replyState: string; changeState: string }>;
    };
    expect(state.addressAgent.threadId).toBe("thr_address");
    const [rename, test] = state.suggestions;
    expect(rename).toMatchObject({ commentId: "PRRT_1", edits: [{ path: "a.go" }], replyState: "open", changeState: "open" });

    const preview = await harness.behavior.callRpc("suggestionFiles", { id: rename!.id });
    expect(preview).toEqual({ files: [{ path: "a.go", before: "package a\n\nfunc b() {}\n", after: "package a\n\nfunc c() {}\n" }], error: null });

    await harness.behavior.callRpc("applySuggestion", { id: rename!.id });
    expect(await readFile(join(worktree, "a.go"), "utf8")).toBe("package a\n\nfunc c() {}\n");
    await expect(harness.behavior.callRpc("applySuggestion", { id: rename!.id })).rejects.toThrow("already applied");
    await expect(harness.behavior.callRpc("setSuggestionState", { id: rename!.id, part: "change", state: "dismissed" })).rejects.toThrow(
      "already applied",
    );
    expect(await harness.behavior.callRpc("suggestionFiles", { id: rename!.id })).toMatchObject({ files: [], error: expect.stringContaining("no longer applies") });

    await harness.behavior.callRpc("setSuggestionState", { id: rename!.id, part: "reply", state: "used" });
    await harness.behavior.callRpc("setSuggestionState", { id: test!.id, part: "change", state: "dismissed" });
    await expect(harness.behavior.callRpc("applySuggestion", { id: test!.id })).rejects.toThrow("already applied or dismissed");
    const after = (await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as typeof state;
    expect(after.suggestions.map((suggestion) => [suggestion.replyState, suggestion.changeState])).toEqual([
      ["used", "applied"],
      ["open", "dismissed"],
    ]);

    await record(harness, [{ commentId: "IC_1", summary: "Reply instead", reply: "Added one." }]);
    const rerun = (await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as typeof state;
    expect(rerun.suggestions.map((suggestion) => suggestion.id === rename!.id || suggestion.commentId)).toEqual([true, "IC_1"]);
  });

  it("retires the untouched half of a kept suggestion when a re-run replaces it", async () => {
    const { harness } = addressSetup();
    await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    const both = { commentId: "PRRT_1", summary: "Rename", reply: "Renamed.", changes: [{ path: "a.go", find: "func b() {}", replace: "func c() {}" }] };
    await record(harness, [both]);
    const read = async () =>
      ((await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as {
        suggestions: Array<{ id: string; replyState: string; changeState: string }>;
      }).suggestions;
    const [first] = await read();
    await harness.behavior.callRpc("setSuggestionState", { id: first!.id, part: "reply", state: "used" });
    await record(harness, [both]);
    expect((await read()).map((suggestion) => [suggestion.id === first!.id, suggestion.replyState, suggestion.changeState])).toEqual([
      [true, "used", "dismissed"],
      [false, "open", "open"],
    ]);
  });

  it("submits accepted changes through the address thread only when there is one with changes", async () => {
    const empty = addressSetup();
    await expect(empty.harness.behavior.callRpc("submitAddress", { repo: "acme/app", number: 7 })).rejects.toThrow("Click Address comments first");
    await empty.harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    await expect(empty.harness.behavior.callRpc("submitAddress", { repo: "acme/app", number: 7 })).rejects.toThrow("no accepted changes");

    const { harness } = addressSetup({ gitStatus: " M a.go\n?? a_test.go\n" });
    await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    await vi.waitFor(() => expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1));
    const result = await harness.behavior.callRpc("submitAddress", { repo: "acme/app", number: 7 });
    expect(result).toEqual({ threadId: "thr_address", delivery: "queued" });
    const message = JSON.stringify(harness.inspection.sdk.callsTo("threads.send")[1]?.[0]);
    expect(message).toContain("Changed files: a.go, a_test.go");
    expect(message).toContain(".github/workflows/");
    expect(message).toContain("HEAD:thing");
    expect(message.toLowerCase()).toContain("never force-push");
    expect(message).toContain("edits that keep the code's behavior the same");
    expect(message).toContain("Do not change logic, tests, or test expectations");
    expect(message).toContain("commit them separately");
    expect(message).toContain("`git commit -S` and `git merge -S`");
    expect(message).toContain("never pass `--no-gpg-sign`");
    expect(message).toContain("%G?");
  });

  it("looks up the review and address threads of a PR at the same time", async () => {
    const { harness } = addressSetup();
    await harness.behavior.callRpc("addressComments", { repo: "acme/app", number: 7 });
    await harness.behavior.callRpc("openReview", { repo: "acme/app", number: 7 });
    let inFlight = 0;
    let most = 0;
    harness.inspection.sdk.stub("threads.get", async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return makeThreadResponse({ id: "thr_address", status: "idle", deletedAt: null, archivedAt: null });
    });
    const state = (await harness.behavior.callRpc("reviewState", { repo: "acme/app", number: 7 })) as {
      agent: { threadId: string | null };
      addressAgent: { threadId: string | null };
    };
    expect(state.agent.threadId).toBe("thr_address");
    expect(state.addressAgent.threadId).toBe("thr_address");
    expect(most).toBe(2);
  });

  it("posts a conversation comment through gh", async () => {
    const { harness, runner } = addressSetup();
    await harness.behavior.callRpc("postConversationComment", { repo: "acme/app", number: 7, body: "Thanks!" });
    const post = runner.calls.find((call) => String(call.args[3]).endsWith("/issues/7/comments"));
    expect(post?.options.input).toBe(JSON.stringify({ body: "Thanks!" }));
  });
});
