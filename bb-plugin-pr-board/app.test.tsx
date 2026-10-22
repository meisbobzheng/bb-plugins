// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Toaster } from "sonner";
import type { Board, BoardCard, PullDetail, ReviewState } from "./contract";
import { commentCount } from "./components/Comments";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const stored = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
  },
});

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});
const HEAD = "1".repeat(40);
const MERGE_BASE = "3".repeat(40);

function card(overrides: Partial<BoardCard>): BoardCard {
  return {
    repo: "acme/app",
    number: 1,
    title: "Change",
    url: "https://github.com/acme/app/pull/1",
    column: "open",
    author: { login: "alice", avatarUrl: null },
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    headRefName: "feature",
    baseRefName: "main",
    additions: 3,
    deletions: 1,
    changedFiles: 1,
    checks: "success",
    reviewers: [],
    humanComments: 0,
    unresolvedThreads: 0,
    unansweredComments: 0,
    isAuthor: false,
    isRequested: false,
    agent: { threadId: null, running: false, findings: 0 },
    ...overrides,
  };
}

const BOARD: Board = {
  viewer: "me",
  repo: "acme/app",
  repos: ["acme/app", "acme/api"],
  fetchedAt: "2026-10-02T00:00:00Z",
  errors: [],
  cards: [
    card({ number: 1, title: "Draft work", column: "draft" }),
    card({ number: 2, title: "Needs eyes", column: "open", isRequested: true }),
    card({ number: 3, title: "Under review", column: "reviewing", humanComments: 2, unansweredComments: 1, agent: { threadId: "thr_3", running: false, findings: 4 } }),
    card({ number: 4, title: "Approved one", column: "ready", isAuthor: true }),
  ],
};

const PATCH = "@@ -1,3 +1,4 @@\n package main\n \n-func a() {}\n+func a() int { return b() }\n+func b() int { return 1 }";

const DETAIL: PullDetail = {
  repo: "acme/app",
  number: 7,
  nodeId: "PR_node",
  title: "Add thing",
  body: "Adds **the** thing.",
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
  additions: 2,
  deletions: 1,
  viewer: "me",
  files: [
    { path: "cmd/main.go", previousPath: null, status: "modified", additions: 2, deletions: 1, patch: PATCH, viewed: false },
    { path: "docs/readme.md", previousPath: null, status: "added", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+hi", viewed: true },
  ],
  threads: [],
  conversation: [],
  awaitingReply: [],
};

const STATE: ReviewState = {
  agent: { threadId: "thr_7", running: true, findings: 1 },
  findings: [
    {
      id: "f1",
      path: "cmd/main.go",
      side: "additions",
      startLine: 3,
      endLine: 4,
      severity: "major",
      title: "Inline b into a",
      body: "b is a pass-through.",
      headSha: HEAD,
      dismissed: false,
    },
  ],
  drafts: [{ id: "d1", path: "cmd/main.go", side: "additions", startLine: 4, endLine: 4, body: "Pending note" }],
  addressAgent: { threadId: null, running: false },
  suggestions: [],
};

const NEW_FILE = "package main\n\nfunc a() int { return b() }\nfunc b() int { return 1 }\n";
const OLD_FILE = "package main\n\nfunc a() {}\n";

function workspaceRpc(state: ReviewState, extra: Record<string, (input: unknown) => unknown> = {}) {
  return {
    pull: () => DETAIL,
    reviewState: () => state,
    openReview: () => ({ threadId: "thr_7", created: false }),
    fileAt: (input: unknown) => ({ content: (input as { sha: string }).sha === HEAD ? NEW_FILE : OLD_FILE, unavailable: null }),
    ...extra,
  };
}

function boardPanel() {
  const panel = app.navPanels.find((registration) => registration.id === "board");
  if (panel === undefined) throw new Error("no board panel");
  return panel;
}

describe("board", () => {
  it("shows the four columns and opens a PR's review page on click", async () => {
    const slot = renderSlot(boardPanel(), { subPath: "" }, { rpc: { board: () => BOARD } });
    for (const title of ["Draft", "Open", "Reviewing", "Ready"]) expect(await slot.findByRole("region", { name: title })).toBeTruthy();
    expect(slot.getByText("4 findings")).toBeTruthy();
    expect(slot.getByTitle("Comments waiting for your reply").textContent).toBe("1");

    fireEvent.click(slot.getByRole("button", { name: "Requested" }));
    expect(slot.queryByText("Draft work")).toBeNull();
    expect(slot.getByText("Needs eyes")).toBeTruthy();

    fireEvent.click(slot.getByText("Needs eyes"));
    expect(slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({ method: "toPluginPanel", path: "board", options: { subPath: "pr/acme/app/2" } }),
    );
  });

  it("switches repositories and adds one by name", async () => {
    const boardFor = (input: unknown) => {
      const repo = (input as { repo: string | null }).repo ?? "acme/app";
      return { ...BOARD, repo, repos: ["acme/app", "acme/api", "acme/web"].slice(0, repo === "acme/web" ? 3 : 2), cards: repo === "acme/app" ? BOARD.cards : [] };
    };
    const slot = renderSlot(
      boardPanel(),
      { subPath: "" },
      { rpc: { board: boardFor, addRepo: () => ({ repo: "acme/web", repos: ["acme/app", "acme/api", "acme/web"] }) } },
    );
    await slot.findByText("Needs eyes");
    const picker = slot.getByRole("combobox", { name: "Repository" }) as HTMLSelectElement;
    expect([...picker.options].map((option) => option.textContent)).toEqual(["app", "api", "Add repository…"]);

    fireEvent.change(picker, { target: { value: "acme/api" } });
    await waitFor(() => expect(slot.queryByText("Needs eyes")).toBeNull());
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "board").at(-1)?.input).toEqual({ repo: "acme/api", refresh: false });

    fireEvent.change(slot.getByRole("combobox", { name: "Repository" }), { target: { value: "__add__" } });
    expect(slot.getByText("acme/")).toBeTruthy();
    fireEvent.change(slot.getByRole("textbox", { name: "Repository to add" }), { target: { value: "web" } });
    fireEvent.click(slot.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "addRepo")).toBe(true));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.filter((call) => call.method === "board").at(-1)?.input).toEqual({ repo: "acme/web", refresh: false }),
    );
  });

  it("asks for a repository when none is configured", async () => {
    const slot = renderSlot(boardPanel(), { subPath: "" }, { rpc: { board: () => ({ ...BOARD, repo: null, repos: [], cards: [] }) } });
    expect(await slot.findByText(/No repository yet/)).toBeTruthy();
    expect(slot.queryByRole("region", { name: "Draft" })).toBeNull();
    const picker = slot.getByRole("combobox", { name: "Repository" }) as HTMLSelectElement;
    expect([...picker.options].map((option) => option.textContent)).toEqual(["Choose a repository", "Add repository…"]);
    fireEvent.change(picker, { target: { value: "__add__" } });
    expect(slot.getByRole("textbox", { name: "Repository to add" }).getAttribute("placeholder")).toBe("owner/repo");
  });

  it("refreshes every minute only while visible, and once when it becomes visible again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      const slot = renderSlot(boardPanel(), { subPath: "" }, { rpc: { board: () => BOARD } });
      expect(await slot.findByText("Needs eyes")).toBeTruthy();
      const boardCalls = () => slot.inspection.rpcCalls.filter((call) => call.method === "board").length;
      const initial = boardCalls();
      vi.advanceTimersByTime(60_000);
      expect(boardCalls()).toBe(initial);
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(boardCalls()).toBe(initial + 1));
      vi.advanceTimersByTime(60_000);
      await waitFor(() => expect(boardCalls()).toBe(initial + 2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the last board at once on return and updates it in the background", async () => {
    const first = renderSlot(boardPanel(), { subPath: "" }, { rpc: { board: () => BOARD } });
    await first.findByText("Needs eyes");
    first.lifecycle.unmount();

    const slot = renderSlot(boardPanel(), { subPath: "" }, { rpc: { board: () => new Promise(() => {}) } });
    expect(slot.getByText("Needs eyes")).toBeTruthy();
    expect(slot.queryByText("Loading open pull requests…")).toBeNull();
    expect(slot.getByRole("status").textContent).toContain("Updating");
  });

  it("shows GitHub errors with a retry that checks GitHub again", async () => {
    const errors = [
      { repo: "acme/app", message: "gh api graphql: error connecting to api.github.com\ncheck your internet connection" },
      { repo: "acme/app", message: "HTTP 502" },
    ];
    const slot = renderSlot(boardPanel(), { subPath: "" }, { rpc: { board: () => ({ ...BOARD, errors }) } });
    const alert = await slot.findByRole("alert");
    expect(within(alert).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "acme/app: gh api graphql: error connecting to api.github.com\ncheck your internet connection",
      "acme/app: HTTP 502",
    ]);
    expect(slot.getByText("Needs eyes")).toBeTruthy();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.filter((call) => call.method === "board").at(-1)?.input).toEqual({ repo: "acme/app", refresh: true }),
    );
  });

  it("clears the filter with Escape or its clear button", async () => {
    const slot = renderSlot(boardPanel(), { subPath: "" }, { rpc: { board: () => BOARD } });
    await slot.findByText("Needs eyes");
    const filter = slot.getByRole("textbox", { name: "Filter pull requests" }) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "approved" } });
    expect(slot.queryByText("Needs eyes")).toBeNull();
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(filter.value).toBe("");
    expect(slot.getByText("Needs eyes")).toBeTruthy();
    fireEvent.change(filter, { target: { value: "draft" } });
    fireEvent.click(slot.getByRole("button", { name: "Clear the filter" }));
    expect(filter.value).toBe("");
    expect(slot.queryByRole("button", { name: "Clear the filter" })).toBeNull();
  });

  it("lays the columns out as rows and remembers the choice", async () => {
    const slot = renderSlot(boardPanel(), { subPath: "" }, { rpc: { board: () => BOARD } });
    await slot.findByText("Needs eyes");
    fireEvent.click(slot.getByRole("button", { name: "Rows" }));
    const open = slot.getByRole("region", { name: "Open" });
    expect(open.querySelector("ul")?.className).toContain("grid");
    expect(window.localStorage.getItem("pr-board:board-layout")).toBe('"rows"');
  });

  it("hides, unhides, and shrinks pull requests, and collapses a column", async () => {
    const slot = renderSlot(boardPanel(), { subPath: "" }, { rpc: { board: () => BOARD } });
    await slot.findByText("Needs eyes");

    fireEvent.click(slot.getByRole("button", { name: "Hide #2" }));
    expect(slot.queryByText("Needs eyes")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "1 hidden" }));
    expect(slot.getByText("Needs eyes")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Unhide #2" }));
    expect(slot.queryByRole("button", { name: "1 hidden" })).toBeNull();

    fireEvent.click(slot.getByRole("button", { name: "Shrink #3" }));
    expect(slot.getByRole("button", { name: "Expand #3" })).toBeTruthy();
    expect(slot.getByText("Under review").className).toContain("truncate");

    fireEvent.click(slot.getByRole("button", { name: /^Draft/ }));
    expect(slot.queryByText("Draft work")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("pr-board:collapsed-columns") ?? "[]")).toEqual(["draft"]);
  });
});

describe("review workspace", () => {
  it("opens the review thread, lists files and findings, and loads both sides of the diff", async () => {
    const slot = renderSlot(
      boardPanel(),
      { subPath: "pr/acme/app/7" },
      { rpc: workspaceRpc(STATE) },
    );
    expect(await slot.findByText("Add thing")).toBeTruthy();
    expect(slot.getByText("Files 1/2")).toBeTruthy();
    expect(slot.getByText("agent working")).toBeTruthy();
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.filter((call) => call.method === "fileAt" && (call.input as { path: string }).path === "cmd/main.go")).toHaveLength(2),
    );
    expect(slot.inspection.rpcCalls.some((call) => call.method === "openReview")).toBe(true);
    expect(slot.inspection.experimental_fixedTabOpenCalls).toHaveLength(1);

    await waitFor(() => {
      const root = document.querySelector("diffs-container")?.shadowRoot;
      expect(root?.querySelector('[data-additions] [data-line="4"]')).toBeTruthy();
      const css = [...(root?.querySelectorAll("style") ?? [])].map((style) => style.textContent).join("\n");
      expect(css).toContain('[data-additions] [data-line="3"]');
      expect(css).toContain("var(--warning)");
    });
    expect(slot.getAllByText("Inline b into a")).toHaveLength(1);
    expect(slot.getByText("Pending note")).toBeTruthy();

    fireEvent.click(slot.getByRole("tab", { name: "Findings 1" }));
    expect(slot.getAllByText("Inline b into a")).toHaveLength(2);

    fireEvent.click(slot.getByRole("button", { name: /Submit review/ }));
    expect(await slot.findByText("1 pending comment will be posted with this review.")).toBeTruthy();
  });

  it("looks up the definition of a ⌘-clicked symbol at its position in the new file", async () => {
    const slot = renderSlot(
      boardPanel(),
      { subPath: "pr/acme/app/7" },
      {
        rpc: workspaceRpc({ ...STATE, findings: [], drafts: [] }, {
          definition: () => ({
            symbol: "b",
            source: "gopls",
            definitions: [{ path: "cmd/main.go", line: 4, preview: "func b() int { return 1 }", external: false }],
            message: null,
          }),
        }),
      },
    );
    await slot.findByText("Add thing");
    const token = await waitFor(() => {
      const root = document.querySelector("diffs-container")?.shadowRoot;
      const line = root?.querySelector('[data-additions] [data-line="3"]');
      const match = [...(line?.querySelectorAll<HTMLElement>("[data-char]") ?? [])].find((element) => element.textContent === "b");
      if (match === undefined) throw new Error("token not rendered yet");
      return match;
    });
    token.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, metaKey: true, ctrlKey: true }));
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "definition")).toBe(true));
    const call = slot.inspection.rpcCalls.find((entry) => entry.method === "definition");
    expect(call?.input).toEqual({
      repo: "acme/app",
      number: 7,
      sha: HEAD,
      path: "cmd/main.go",
      line: 3,
      character: Number(token.dataset.char),
      symbol: "b",
    });
  });

  it("turns a finding into a pending review comment on its lines", async () => {
    const saved: unknown[] = [];
    const slot = renderSlot(
      boardPanel(),
      { subPath: "pr/acme/app/7" },
      {
        rpc: workspaceRpc({ ...STATE, drafts: [] }, {
          saveDraft: (input) => {
            saved.push(input);
            return { id: "d2", path: "cmd/main.go", side: "additions", startLine: 3, endLine: 4, body: (input as { body: string }).body };
          },
        }),
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Comment" }));
    const editor = (await slot.findByRole("textbox", { name: "Comment" })) as HTMLTextAreaElement;
    expect(editor.value).toBe("**Inline b into a**\n\nb is a pass-through.");
    fireEvent.click(slot.getByRole("button", { name: "Suggest change" }));
    expect(editor.value).toContain("```suggestion\nfunc a() int { return b() }\nfunc b() int { return 1 }\n```");
    fireEvent.click(slot.getByRole("button", { name: "Add to review" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ repo: "acme/app", number: 7, id: null, path: "cmd/main.go", side: "additions", startLine: 3, endLine: 4 });
  });

  it("loads the next file's contents in the background so stepping to it shows its diff at once", async () => {
    const headSha = "5".repeat(40);
    const slot = renderSlot(boardPanel(), { subPath: "pr/acme/app/16" }, { rpc: workspaceRpc(STATE, { pull: () => ({ ...DETAIL, number: 16, headSha }) }) });
    await slot.findByText("Add thing");
    const fetched = () => slot.inspection.rpcCalls.filter((call) => call.method === "fileAt").map((call) => (call.input as { path: string }).path);
    await waitFor(() => expect(fetched()).toEqual(["cmd/main.go", "cmd/main.go", "docs/readme.md"]));
    fireEvent.click(slot.getByRole("button", { name: "Next file" }));
    expect(slot.getByText(/2\/2\s+docs\/readme\.md/)).toBeTruthy();
    expect(slot.queryByText("Loading diff…")).toBeNull();
    expect(fetched()).toHaveLength(3);
  });

  it("refreshes the PR on demand and keeps it on screen with a retry when that fails", async () => {
    let fail = false;
    const pull = () => {
      if (fail) throw new Error("gh api graphql: error connecting to api.github.com");
      return { ...DETAIL, number: 15 };
    };
    const slot = renderSlot(boardPanel(), { subPath: "pr/acme/app/15" }, { rpc: workspaceRpc(STATE, { pull }) });
    await slot.findByText("Add thing");
    const refresh = slot.getByRole("button", { name: "Refresh" });
    await waitFor(() => expect(refresh.hasAttribute("disabled")).toBe(false));
    fail = true;
    fireEvent.click(refresh);
    const retry = await slot.findByRole("button", { name: "Update failed · retry" });
    expect(retry.getAttribute("title")).toContain("error connecting");
    expect(slot.getByText("Add thing")).toBeTruthy();
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "pull").at(-1)?.input).toEqual({ repo: "acme/app", number: 15, refresh: true });
    fail = false;
    fireEvent.click(retry);
    expect(await slot.findByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("reloads the review state on its own PR's updates and after the connection comes back", async () => {
    const slot = renderSlot(boardPanel(), { subPath: "pr/acme/app/7" }, { rpc: workspaceRpc(STATE) });
    await slot.findByText("Add thing");
    const states = () => slot.inspection.rpcCalls.filter((call) => call.method === "reviewState").length;
    await waitFor(() => expect(states()).toBe(2));
    await slot.behavior.emitRealtime("pr-board-updates", { repo: "acme/app", number: 8 });
    expect(states()).toBe(2);
    await slot.behavior.emitRealtime("pr-board-updates", { repo: "acme/app", number: 7 });
    await waitFor(() => expect(states()).toBe(3));
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(states()).toBe(4));
  });

  it("says when no file matches the file filter, and clears it with Escape", async () => {
    const slot = renderSlot(boardPanel(), { subPath: "pr/acme/app/7" }, { rpc: workspaceRpc(STATE) });
    await slot.findByText("Add thing");
    const filter = slot.getByRole("textbox", { name: "Filter files" }) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(slot.getByText("No changed file matches “zzz”.")).toBeTruthy();
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(filter.value).toBe("");
    expect(slot.queryByText(/No changed file matches/)).toBeNull();
    expect(slot.getByTitle("docs/readme.md")).toBeTruthy();
  });

  it("deletes a pending comment with an Undo that puts it back", async () => {
    render(<Toaster theme="light" />);
    const saved: unknown[] = [];
    const slot = renderSlot(
      boardPanel(),
      { subPath: "pr/acme/app/17" },
      {
        rpc: workspaceRpc(STATE, {
          pull: () => ({ ...DETAIL, number: 17 }),
          deleteDraft: () => ({}),
          saveDraft: (input) => {
            saved.push(input);
            return { id: "d3", path: "cmd/main.go", side: "additions", startLine: 4, endLine: 4, body: "Pending note" };
          },
        }),
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(slot.inspection.rpcCalls.filter((call) => call.method === "deleteDraft").map((call) => call.input)).toEqual([{ id: "d1" }]));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(saved).toEqual([{ repo: "acme/app", number: 17, id: null, path: "cmd/main.go", side: "additions", startLine: 4, endLine: 4, body: "Pending note" }]),
    );
  });

  it("stacks the file list above a unified diff when the page is narrow", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 700, 900));
    const slot = renderSlot(boardPanel(), { subPath: "pr/acme/app/7" }, { rpc: workspaceRpc(STATE) });
    await slot.findByText("Add thing");
    expect(slot.queryByRole("region", { name: "Files and findings" })).toBeNull();
    await waitFor(() => expect(document.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-unified]")).toBeTruthy());

    fireEvent.click(slot.getByRole("button", { name: "Toggle the file list" }));
    expect(slot.getByRole("region", { name: "Files and findings" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Split diff" }));
    await waitFor(() => expect(document.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-additions]")).toBeTruthy());
  });
});

describe("comments", () => {
  const person = (login: string) => ({ login, avatarUrl: null });
  const COMMENTED: PullDetail = {
    ...DETAIL,
    number: 9,
    threads: [
      {
        id: "PRRT_1",
        path: "cmd/main.go",
        side: "additions",
        line: 4,
        startLine: null,
        isResolved: false,
        isOutdated: false,
        comments: [{ id: "c1", databaseId: 11, author: person("carol"), isBot: false, body: "Rename b", createdAt: "2026-10-01T00:00:00Z", url: "u" }],
      },
    ],
    conversation: [{ id: "IC_1", kind: "comment", author: person("dave"), isBot: false, body: "Please add docs", createdAt: "2026-10-02T00:00:00Z", url: "u" }],
  };
  const SUGGESTED: ReviewState = {
    ...STATE,
    addressAgent: { threadId: "thr_address", running: false },
    suggestions: [
      {
        id: "s1",
        commentId: "PRRT_1",
        summary: "Rename b to c",
        reply: "Renamed it.",
        replyState: "open",
        edits: [{ path: "cmd/main.go", find: "func b() int { return 1 }", replace: "func c() int { return 1 }" }],
        changeState: "open",
      },
      {
        id: "s2",
        commentId: "IC_1",
        summary: "Document the thing",
        reply: null,
        replyState: "open",
        edits: [
          { path: "docs/readme.md", find: "hi", replace: "hi\nmore" },
          { path: "docs/usage.md", find: "", replace: "Usage\n" },
        ],
        changeState: "open",
      },
    ],
  };

  it("shows comments with suggestions, uses a suggested reply, accepts a change, and re-runs the address thread", async () => {
    const after = NEW_FILE.replace("func b() int { return 1 }", "func c() int { return 1 }");
    const slot = renderSlot(
      boardPanel(),
      { subPath: "pr/acme/app/9" },
      {
        rpc: workspaceRpc(SUGGESTED, {
          pull: () => COMMENTED,
          suggestionFiles: (input) =>
            (input as { id: string }).id === "s1"
              ? { files: [{ path: "cmd/main.go", before: NEW_FILE, after }], error: null }
              : { files: [{ path: "docs/readme.md", before: "hi\n", after: "hi\nmore\n" }, { path: "docs/usage.md", before: null, after: "Usage\n" }], error: null },
          applySuggestion: () => ({}),
          setSuggestionState: () => ({}),
          reply: () => ({}),
          addressComments: () => ({ threadId: "thr_address", created: false, delivery: "queued" }),
        }),
      },
    );
    fireEvent.click(await slot.findByRole("tab", { name: "Comments 2" }));
    const listed = (name: RegExp) => slot.getAllByRole("button", { name }).find((button) => button.getAttribute("aria-current") !== null || button.className.includes("rounded-md border"));
    expect(listed(/carol\s*Rename b/)?.getAttribute("title")).toBe("Waiting for your reply");
    expect(listed(/carol\s*Rename b/)?.style.color).toBe("var(--attention)");
    expect(listed(/dave\s*Please add docs/)?.getAttribute("title")).toBeNull();
    expect(await slot.findByText("Rename b to c")).toBeTruthy();
    expect(slot.getByText("3 open suggestions. Accepted changes go to the address thread's worktree until you click Submit Address.")).toBeTruthy();

    const calls = (method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);
    const single = slot.getByRole("button", { name: /^cmd\/main\.go\s*\+/ });
    expect(single.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(calls("suggestionFiles")).toEqual([{ id: "s1" }]));
    const readme = slot.getByRole("button", { name: /^docs\/readme\.md\s*\+/ });
    expect(readme.getAttribute("aria-expanded")).toBe("false");
    expect(readme.textContent).toContain("+1 −0");
    fireEvent.click(readme);
    await waitFor(() => expect(calls("suggestionFiles")).toEqual([{ id: "s1" }, { id: "s2" }]));
    expect(slot.getByRole("button", { name: /^docs\/usage\.md\s*\+/ }).textContent).toContain("+1 −0");

    fireEvent.click(slot.getByRole("button", { name: "Use reply" }));
    expect((slot.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe("Renamed it.");
    expect(calls("setSuggestionState")).toEqual([]);
    fireEvent.change(slot.getByRole("textbox", { name: "Reply" }), { target: { value: "Renamed it to c." } });

    fireEvent.click(slot.getByRole("button", { name: "View in diff" }));
    expect(slot.getByRole("tab", { name: /^Files/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(slot.getByRole("button", { name: "Go back" }));
    expect(slot.getByRole("tab", { name: /^Comments/ }).getAttribute("aria-selected")).toBe("true");
    expect((slot.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe("Renamed it to c.");
    fireEvent.click(slot.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(calls("reply")).toEqual([{ repo: "acme/app", number: 9, commentId: 11, body: "Renamed it to c." }]));
    await waitFor(() => expect(calls("setSuggestionState")).toEqual([{ id: "s1", part: "reply", state: "used" }]));

    fireEvent.click(slot.getAllByRole("button", { name: "Accept change" })[0]!);
    await waitFor(() => expect(calls("applySuggestion")).toEqual([{ id: "s1" }]));

    fireEvent.click(slot.getByRole("button", { name: "Address comments" }));
    await waitFor(() => expect(calls("addressComments")).toEqual([{ repo: "acme/app", number: 9 }]));
  });

  it("shows a resolved thread as resolved as soon as GitHub takes it, before the PR reloads", async () => {
    let loads = 0;
    const slot = renderSlot(
      boardPanel(),
      { subPath: "pr/acme/app/18" },
      {
        rpc: workspaceRpc(SUGGESTED, {
          pull: () => (loads++ === 0 ? { ...COMMENTED, number: 18 } : new Promise<PullDetail>(() => {})),
          resolveThread: () => ({}),
        }),
      },
    );
    fireEvent.click(await slot.findByRole("tab", { name: "Comments 2" }));
    const card = (await slot.findAllByText("Rename b")).map((text) => text.closest("article")).find((article) => article !== null) as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Resolve" }));
    expect(await within(card).findByRole("button", { name: "Unresolve" })).toBeTruthy();
    expect(within(card).getByText("resolved")).toBeTruthy();
    expect(slot.getByRole("tab", { name: "Comments 1" })).toBeTruthy();
    expect(loads).toBe(2);
  });

  it("stacks the review and address buttons and confirms Submit Address before sending it", async () => {
    const slot = renderSlot(
      boardPanel(),
      { subPath: "pr/acme/app/10" },
      { rpc: workspaceRpc(SUGGESTED, { pull: () => ({ ...COMMENTED, number: 10 }), submitAddress: () => ({ threadId: "thr_address", delivery: "queued" }) }) },
    );
    expect(await slot.findByText("Add thing")).toBeTruthy();
    const buttons = ["Run review", "Submit review", "Address comments", "Submit Address"].map((name) => slot.getByRole("button", { name: new RegExp(`^${name}`) }));
    expect([...(buttons[0]?.parentElement?.children ?? [])]).toEqual(buttons);
    expect(buttons[0]?.parentElement?.className).toContain("grid-cols-2");
    await waitFor(() => expect(buttons[3]?.hasAttribute("disabled")).toBe(false));
    fireEvent.click(buttons[3]!);
    const dialog = await slot.findByRole("dialog");
    expect(dialog.textContent).toContain("it may fix it with edits that don't change behavior");
    expect(dialog.textContent).toContain("If a check still fails or needs a logic change, it stops without committing or pushing.");
    expect(dialog.textContent).toContain("Every commit is signed with your git signing key");
    expect(slot.inspection.rpcCalls.some((call) => call.method === "submitAddress")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Address" }));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.filter((call) => call.method === "submitAddress").map((call) => call.input)).toEqual([{ repo: "acme/app", number: 10 }]),
    );
  });
});

describe("commentCount", () => {
  it("leaves out bot conversation comments, code comments a bot started, resolved ones, and my own", () => {
    const comment = (login: string, isBot: boolean) => ({
      id: login,
      databaseId: 1,
      author: { login, avatarUrl: null },
      isBot,
      body: "x",
      createdAt: "2026-10-01T00:00:00Z",
      url: "u",
    });
    const thread = (id: string, comments: ReturnType<typeof comment>[], isResolved = false) => ({
      id,
      path: "a.go",
      side: "additions" as const,
      line: 1,
      startLine: null,
      isResolved,
      isOutdated: false,
      comments,
    });
    const conversation = (login: string, isBot: boolean) => ({ ...comment(login, isBot), kind: "comment" as const });
    expect(
      commentCount({
        viewer: "me",
        threads: [
          thread("human", [comment("carol", false)]),
          thread("bot", [comment("copilot-pull-request-reviewer", true), comment("me", false)]),
          thread("resolved", [comment("carol", false)], true),
        ],
        conversation: [conversation("dave", false), conversation("vercel", true), conversation("me", false)],
      }),
    ).toBe(2);
  });
});

describe("thread tabs", () => {
  function fixedTab(id: string) {
    const tab = boardPanel().fixedTabs?.find((candidate) => candidate.id === id);
    if (tab === undefined) throw new Error(`no ${id} tab`);
    return tab;
  }

  it("adds an Address thread tab beside the Review thread tab that shows the PR's address thread", async () => {
    expect(boardPanel().fixedTabs?.map((tab) => tab.title)).toEqual(["Review thread", "Address thread"]);
    const empty = renderSlot(fixedTab("address-thread"), { subPath: "pr/acme/app/11" }, { rpc: { reviewState: () => STATE } });
    expect(await empty.findByText("No address thread yet. Click Address comments on the PR page to start one.")).toBeTruthy();
    cleanup();

    const started = renderSlot(
      fixedTab("address-thread"),
      { subPath: "pr/acme/app/12" },
      { rpc: { reviewState: () => ({ ...STATE, addressAgent: { threadId: "thr_address", running: true } }) } },
    );
    await waitFor(() => expect(started.inspection.rpcCalls.some((call) => call.method === "reviewState")).toBe(true));
    await waitFor(() => expect(started.queryByText(/Loading the address thread|No address thread yet/)).toBeNull());
  });

  it("reloads a thread tab only for its own PR's updates", async () => {
    const slot = renderSlot(fixedTab("thread"), { subPath: "pr/acme/app/13" }, { rpc: { reviewState: () => STATE } });
    const states = () => slot.inspection.rpcCalls.filter((call) => call.method === "reviewState").length;
    await waitFor(() => expect(states()).toBe(1));
    await slot.behavior.emitRealtime("pr-board-updates", { repo: "acme/app", number: 14 });
    expect(states()).toBe(1);
    await slot.behavior.emitRealtime("pr-board-updates", { repo: "acme/app", number: 13 });
    await waitFor(() => expect(states()).toBe(2));
  });
});
