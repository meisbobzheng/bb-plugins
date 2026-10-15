import { describe, expect, it } from "vitest";
import { detailVersion, parseBoardPulls, parseFilePages, parseListedPulls, reviewCommentFields } from "./github";

describe("parseBoardPulls", () => {
  it("maps the GraphQL board query into snapshots", () => {
    const raw = JSON.stringify({
      data: {
        nodes: [
          {
            id: "PR_7",
            number: 7,
            title: "Add thing",
            url: "https://github.com/acme/app/pull/7",
            isDraft: false,
            createdAt: "2026-10-01T00:00:00Z",
            updatedAt: "2026-10-02T00:00:00Z",
            headRefName: "thing",
            baseRefName: "main",
            additions: 10,
            deletions: 2,
            changedFiles: 3,
            reviewDecision: null,
            author: { __typename: "User", login: "alice", avatarUrl: "https://a" },
            reviewRequests: {
              nodes: [
                { requestedReviewer: { __typename: "User", login: "bob", avatarUrl: "https://b" } },
                { requestedReviewer: { __typename: "Team" } },
              ],
            },
            latestReviews: { nodes: [{ state: "COMMENTED", author: { __typename: "Bot", login: "copilot-pull-request-reviewer", avatarUrl: "https://c" } }] },
            reviews: { nodes: [{ state: "COMMENTED", author: null }] },
            comments: { nodes: [{ author: { __typename: "User", login: "carol" } }] },
            reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] },
            commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
          },
          null,
        ],
      },
    });
    const pulls = parseBoardPulls("acme/app", raw);
    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toMatchObject({
      id: "PR_7",
      repo: "acme/app",
      number: 7,
      checks: "failure",
      requestedReviewers: [{ login: "bob", avatarUrl: "https://b" }],
      latestReviews: [{ author: { login: "copilot-pull-request-reviewer", isBot: true }, state: "COMMENTED" }],
      reviews: [],
      commentAuthors: [{ login: "carol", isBot: false }],
      unresolvedThreads: 1,
    });
  });
});

describe("parseListedPulls", () => {
  it("keeps only each PR's id, last update, and CI state", () => {
    const raw = JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            nodes: [
              { id: "PR_1", updatedAt: "2026-10-02T00:00:00Z", commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] } },
              { id: "PR_2", updatedAt: "2026-10-01T00:00:00Z", commits: { nodes: [] } },
            ],
          },
        },
      },
    });
    expect(parseListedPulls(raw)).toEqual([
      { id: "PR_1", updatedAt: "2026-10-02T00:00:00Z", checks: "pending" },
      { id: "PR_2", updatedAt: "2026-10-01T00:00:00Z", checks: "none" },
    ]);
  });
});

describe("detailVersion", () => {
  it("changes with the update time, the head commit, or a thread's resolved state", () => {
    const thread = { isResolved: false } as Parameters<typeof detailVersion>[0]["threads"][number];
    const base = { updatedAt: "2026-10-02T00:00:00Z", headSha: "1".repeat(40), threads: [thread] };
    const versions = new Set([
      detailVersion(base),
      detailVersion({ ...base, updatedAt: "2026-10-03T00:00:00Z" }),
      detailVersion({ ...base, headSha: "2".repeat(40) }),
      detailVersion({ ...base, threads: [{ ...thread, isResolved: true }] }),
    ]);
    expect(versions.size).toBe(4);
    expect(detailVersion({ ...base })).toBe(detailVersion(base));
  });
});

describe("parseFilePages", () => {
  it("flattens slurped REST pages", () => {
    const raw = JSON.stringify([
      [{ filename: "a.go", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@" }],
      [{ filename: "b.go", previous_filename: "old.go", status: "renamed", additions: 0, deletions: 0 }],
    ]);
    expect(parseFilePages(raw)).toEqual([
      { path: "a.go", previousPath: null, status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@" },
      { path: "b.go", previousPath: "old.go", status: "renamed", additions: 0, deletions: 0, patch: null },
    ]);
  });
});

describe("reviewCommentFields", () => {
  it("maps sides and only sends a start line for ranges", () => {
    expect(reviewCommentFields({ path: "a.go", side: "additions", startLine: 4, endLine: 4 })).toEqual({ path: "a.go", line: 4, side: "RIGHT" });
    expect(reviewCommentFields({ path: "a.go", side: "deletions", startLine: 2, endLine: 5 })).toEqual({
      path: "a.go",
      line: 5,
      side: "LEFT",
      start_line: 2,
      start_side: "LEFT",
    });
  });
});
