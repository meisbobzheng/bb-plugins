import { describe, expect, it } from "vitest";
import { makeProject, makeThread } from "./fixtures";
import {
  PINNED_KEY,
  buildSidebar,
  buildTrees,
  groupView,
  parseKeys,
  projectKey,
  relativeTime,
  rowMeta,
  sharesEnvironment,
  threadStatus,
  toggleKey,
} from "./sidebar/model";

const NOW = 1_000_000_000_000;
const MINUTE = 60_000;
const PROJECTS = [makeProject("proj_a", "hss"), makeProject("proj_b", "go-diameter")];
const ids = (trees: readonly { thread: { id: string } }[]) => trees.map((tree) => tree.thread.id);

describe("threadStatus", () => {
  it("puts a pending question above everything the thread is doing", () => {
    expect(threadStatus(makeThread({ id: "a", hasPendingInteraction: true, status: "active" }))).toBe("input");
    expect(threadStatus(makeThread({ id: "b", indicator: "waiting-for-input" }))).toBe("input");
  });

  it("maps failures, plans, work, and unread completions", () => {
    expect(threadStatus(makeThread({ id: "a", indicator: "unread-error" }))).toBe("failed");
    expect(threadStatus(makeThread({ id: "b", indicator: "queued-failed", status: "active" }))).toBe("failed");
    expect(threadStatus(makeThread({ id: "c", indicator: "plan-mode", status: "active" }))).toBe("plan");
    expect(threadStatus(makeThread({ id: "d", indicator: "plan-mode" }))).toBe("plan-ready");
    expect(threadStatus(makeThread({ id: "e", status: "starting" }))).toBe("working");
    expect(threadStatus(makeThread({ id: "f", indicator: "background-agent" }))).toBe("working");
    expect(threadStatus(makeThread({ id: "g", indicator: "unread-success", isUnread: true }))).toBe("unread");
    expect(threadStatus(makeThread({ id: "h" }))).toBe("idle");
  });
});

describe("buildTrees", () => {
  it("nests descendants one level under their top visible ancestor", () => {
    const trees = buildTrees([
      makeThread({ id: "root" }),
      makeThread({ id: "child", parentThreadId: "root", updatedAt: 1 }),
      makeThread({ id: "grandchild", parentThreadId: "child", updatedAt: 2 }),
      makeThread({ id: "orphan", parentThreadId: "gone" }),
    ]);
    expect(ids(trees)).toEqual(["root", "orphan"]);
    expect(trees[0]!.children.map((thread) => thread.id)).toEqual(["grandchild", "child"]);
  });

  it("survives a parent cycle", () => {
    const trees = buildTrees([makeThread({ id: "a", parentThreadId: "b" }), makeThread({ id: "b", parentThreadId: "a" })]);
    expect(ids(trees).sort()).toEqual(["a", "b"]);
  });

  it("ranks a tree by its most urgent and most recent thread", () => {
    const [tree] = buildTrees([
      makeThread({ id: "root", updatedAt: 1 }),
      makeThread({ id: "child", parentThreadId: "root", indicator: "waiting-for-input", updatedAt: 5 }),
    ]);
    expect(tree).toMatchObject({ tier: 0, updatedAt: 5 });
  });
});

describe("buildSidebar", () => {
  it("lists threads needing input first, then running ones, then the rest by recency", () => {
    const { projects } = buildSidebar(
      [
        makeThread({ id: "old", updatedAt: 1 }),
        makeThread({ id: "new", updatedAt: 9 }),
        makeThread({ id: "running", status: "active", updatedAt: 2 }),
        makeThread({ id: "waiting", indicator: "waiting-for-input", updatedAt: 0 }),
      ],
      PROJECTS,
    );
    expect(ids(projects[0]!.trees)).toEqual(["waiting", "running", "new", "old"]);
    expect(projects[0]!.needsInput).toBe(1);
  });

  it("keeps project order, moves pins to Pinned, and drops archived and hidden threads", () => {
    const groups = buildSidebar(
      [
        makeThread({ id: "b1", projectId: "proj_b" }),
        makeThread({ id: "unkeyed", isPinned: true, pinnedAt: 1 }),
        makeThread({ id: "keyed", isPinned: true, pinnedAt: 5, pinSortKey: "a" }),
        makeThread({ id: "archived", isArchived: true }),
        makeThread({ id: "hidden", isHidden: true }),
        makeThread({ id: "elsewhere", projectId: "proj_gone" }),
      ],
      PROJECTS,
    );
    expect(groups.pinned.key).toBe(PINNED_KEY);
    expect(ids(groups.pinned.trees)).toEqual(["keyed", "unkeyed"]);
    expect(groups.projects.map((group) => [group.key, ids(group.trees)])).toEqual([
      [projectKey("proj_a"), []],
      [projectKey("proj_b"), ["b1"]],
    ]);
    expect(groups.isEmpty).toBe(false);
    expect(buildSidebar([makeThread({ id: "x", isArchived: true })], PROJECTS).isEmpty).toBe(true);
  });
});

describe("groupView", () => {
  const threads = [
    makeThread({ id: "waiting", indicator: "waiting-for-input" }),
    ...Array.from({ length: 5 }, (_, index) => makeThread({ id: `t${index}`, updatedAt: 10 - index })),
  ];
  const [group] = buildSidebar(threads, PROJECTS).projects;
  const options = { collapsed: false, showAll: false, activeThreadId: null, limit: 2 };

  it("previews the attention threads plus the first few others", () => {
    const view = groupView(group!, options);
    expect(ids(view.trees)).toEqual(["waiting", "t0", "t1"]);
    expect(view.overflow).toBe(3);
    expect(ids(groupView(group!, { ...options, showAll: true }).trees)).toHaveLength(6);
  });

  it("keeps the open thread visible past the preview", () => {
    expect(ids(groupView(group!, { ...options, activeThreadId: "t4" }).trees)).toEqual(["waiting", "t0", "t1", "t4"]);
  });

  it("shows only attention threads and the open thread when collapsed", () => {
    const view = groupView(group!, { ...options, collapsed: true, activeThreadId: "t3" });
    expect(ids(view.trees)).toEqual(["waiting", "t3"]);
    expect(view.overflow).toBe(0);
  });
});

describe("rowMeta", () => {
  it("shows the branch and machine it is asked for", () => {
    const thread = makeThread({
      id: "a",
      environment: { id: "env", name: null, branchName: "bob/fix", path: null, isWorktree: true, providerId: null, workspaceDisplayKind: null },
      host: { id: "h", name: "devbox" },
    });
    expect(rowMeta(thread, { branch: true, host: false })).toEqual({ branch: "bob/fix", host: null });
    expect(rowMeta(thread, { branch: true, host: true })).toEqual({ branch: "bob/fix", host: "devbox" });
    expect(rowMeta(thread, { branch: false, host: false })).toBeNull();
    expect(rowMeta(makeThread({ id: "b" }), { branch: true, host: true })).toBeNull();
  });

  it("treats threads as sharing an environment only when both have the same one", () => {
    const environment = (id: string) => ({ id, name: null, branchName: null, path: null, isWorktree: true, providerId: null, workspaceDisplayKind: null });
    expect(sharesEnvironment(makeThread({ id: "a", environment: environment("e") }), makeThread({ id: "b", environment: environment("e") }))).toBe(true);
    expect(sharesEnvironment(makeThread({ id: "a", environment: environment("e") }), makeThread({ id: "b", environment: environment("f") }))).toBe(false);
    expect(sharesEnvironment(makeThread({ id: "a" }), makeThread({ id: "b" }))).toBe(false);
  });
});

describe("relativeTime", () => {
  it("abbreviates minutes, hours, days, and weeks", () => {
    expect(relativeTime(NOW, NOW)).toBe("now");
    expect(relativeTime(NOW - 4 * MINUTE, NOW)).toBe("4m");
    expect(relativeTime(NOW - 120 * MINUTE, NOW)).toBe("2h");
    expect(relativeTime(NOW - 3 * 24 * 60 * MINUTE, NOW)).toBe("3d");
    expect(relativeTime(NOW - 14 * 24 * 60 * MINUTE, NOW)).toBe("2w");
  });
});

describe("collapsed keys", () => {
  it("toggles keys and ignores malformed storage", () => {
    expect([...toggleKey(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggleKey(new Set(["a"]), "a")]).toEqual([]);
    expect(parseKeys('["a", 1, "b"]')).toEqual(["a", "b"]);
    expect(parseKeys("{")).toEqual([]);
    expect(parseKeys(null)).toEqual([]);
  });
});
