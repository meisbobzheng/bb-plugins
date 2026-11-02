// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/" }
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { makeProject, makeThread } from "./fixtures";

declare const jsdom: { window: Window };
vi.stubGlobal("localStorage", jsdom.window.localStorage);

beforeAll(() => {
  window.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a[href]")) event.preventDefault();
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const BRANCH = { id: "env_1", name: null, branchName: "bob/cer", path: "/w", isWorktree: true, providerId: null, workspaceDisplayKind: null };

const THREADS = [
  makeThread({ id: "thr_old", displayTitle: "Old cleanup", updatedAt: 1 }),
  makeThread({ id: "thr_run", displayTitle: "Run the suite", status: "active", updatedAt: 2 }),
  makeThread({
    id: "thr_wait",
    displayTitle: "Review CER handling",
    indicator: "waiting-for-input",
    indicatorLabel: "Thread needs user input",
    environment: BRANCH,
  }),
  makeThread({ id: "thr_child", displayTitle: "Child task", parentThreadId: "thr_old", updatedAt: 0 }),
  makeThread({ id: "thr_pin", displayTitle: "Pinned rollout plan", isPinned: true, projectId: "proj_b" }),
  makeThread({ id: "thr_b", displayTitle: "Diameter fix", projectId: "proj_b", indicator: "unread-error" }),
];

interface RenderOptions extends Omit<RenderSlotOptions, "sidebarThreads"> {
  threads?: PluginSidebarThread[];
  props?: Partial<PluginThreadListProps>;
}

async function renderList({ threads = THREADS, props = {}, ...options }: RenderOptions = {}) {
  const app = await loadPluginApp(() => import("./app"));
  const list = app.threadLists[0]!;
  const onNavigate = vi.fn();
  const slot = renderSlot<PluginThreadListProps>(
    list,
    {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate,
      searchQuery: "",
      ...props,
    },
    {
      pluginId: "thread-sidebar",
      sidebarThreads: {
        status: "ready",
        threads,
        projects: [makeProject("proj_a", "hss"), makeProject("proj_b", "go-diameter")],
        sections: [],
      },
      ...options,
    },
  );
  return { slot, onNavigate };
}

const section = (slot: ReturnType<typeof renderSlot>, name: string) => slot.getByRole("region", { name: new RegExp(`^${name}`) });
const rowNames = (element: HTMLElement) => within(element).queryAllByRole("link").map((link) => link.getAttribute("aria-label"));

describe("thread sidebar", () => {
  it("registers one thread list", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.threadLists.map(({ id, title }) => ({ id, title }))).toEqual([{ id: "thread-sidebar", title: "Thread Sidebar" }]);
  });

  it("groups threads under Pinned and each project, with threads needing input first", async () => {
    const { slot } = await renderList();
    expect(slot.getAllByRole("button", { expanded: true }).map((header) => header.textContent)).toEqual([
      "Pinned",
      "hss1, 1 waiting for input",
      "go-diameter",
    ]);
    expect(slot.getByRole("button", { name: /^hss ?, 1 waiting for input$/ })).toBeTruthy();
    expect(rowNames(section(slot, "Pinned"))).toEqual(["Pinned rollout plan"]);
    expect(rowNames(section(slot, "hss"))).toEqual([
      "Review CER handling, Thread needs user input",
      "Run the suite",
      "Old cleanup",
      "Child task",
    ]);
    const waiting = slot.getByRole("link", { name: /Review CER handling/ });
    expect(waiting.textContent).toContain("Needs input");
    expect(waiting.textContent).toContain("bob/cer");
    expect(slot.getByRole("link", { name: "Run the suite" }).textContent).toContain("Working");
    expect(slot.getByRole("link", { name: "Diameter fix" }).textContent).toContain("Failed");
  });

  it("marks rows for bb's jump shortcuts and vim, and the open thread as current", async () => {
    const { slot, onNavigate } = await renderList({
      props: { activeThreadId: "thr_run" },
      sidebarShortcuts: { thr_pin: { label: "⌘1", ariaKeyshortcuts: "Meta+1" } },
    });
    const pinned = slot.getByRole("link", { name: "Pinned rollout plan" });
    expect(pinned.dataset).toMatchObject({ sidebarThreadId: "thr_pin", sidebarThreadShortcutTarget: "", vimItem: "" });
    expect(pinned.getAttribute("aria-keyshortcuts")).toBe("Meta+1");
    expect(pinned.textContent).toContain("⌘1");
    expect(slot.getByRole("link", { name: "Run the suite" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(pinned);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("collapses a project to the threads needing input and remembers it", async () => {
    const { slot } = await renderList();
    fireEvent.click(within(section(slot, "hss")).getAllByRole("button")[0]!);
    expect(rowNames(section(slot, "hss"))).toEqual(["Review CER handling, Thread needs user input"]);
    cleanup();
    const { slot: again } = await renderList();
    expect(within(section(again, "hss")).getAllByRole("button")[0]!.getAttribute("aria-expanded")).toBe("false");
  });

  it("previews eight threads per project and shows the rest on request", async () => {
    const threads = Array.from({ length: 11 }, (_, index) => makeThread({ id: `thr_${index}`, updatedAt: 100 - index }));
    const { slot } = await renderList({ threads });
    expect(rowNames(section(slot, "hss"))).toHaveLength(8);
    fireEvent.click(slot.getByRole("button", { name: "Show 3 more" }));
    expect(rowNames(section(slot, "hss"))).toHaveLength(11);
    fireEvent.click(slot.getByRole("button", { name: "Show less" }));
    expect(rowNames(section(slot, "hss"))).toHaveLength(8);
  });

  it("starts a thread in a project from its + button", async () => {
    const { slot, onNavigate } = await renderList();
    fireEvent.click(slot.getByRole("button", { name: "New thread in go-diameter" }));
    expect(slot.navigateCalls).toEqual([{ method: "toCompose", options: { projectId: "proj_b", focusPrompt: true } }]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("archives from the hover button and lists bb's actions in the row menu", async () => {
    const ran: string[] = [];
    const entry = (key: string, label: string) => ({
      key,
      pluginId: "bb--core",
      group: "4_lifecycle",
      action: { label, icon: "Archive", run: async () => void ran.push(key) },
    });
    const { slot } = await renderList({
      threadActions: (thread) => (thread.id === "thr_old" ? [entry("bb--core/pin", "Pin"), entry("bb--core/archive", "Archive")] : []),
    });
    const row = slot.getByRole("link", { name: "Old cleanup" }).parentElement!;
    expect(within(row).queryByRole("button", { name: "Archive" })).toBeNull();
    fireEvent.pointerEnter(row);
    fireEvent.click(within(row).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(ran).toEqual(["bb--core/archive"]));
    fireEvent.click(within(row).getByRole("button", { name: "Thread actions" }));
    expect(within(row).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Pin", "Archive"]);
  });

  it("keeps the menu button visible on compact viewports", async () => {
    const { slot } = await renderList({ props: { isCompactViewport: true } });
    expect(slot.getAllByRole("button", { name: "Thread actions" })).toHaveLength(THREADS.length);
    expect(slot.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("drops the branch line in compact density and draws other plugins' row statuses", async () => {
    const { slot } = await renderList({
      settings: { density: "compact" },
      sidebarRowStatuses: { thr_old: { icon: "Workflow", label: "Workflow running", tone: "running" } },
      sidebarDraftThreadIds: ["thr_run"],
    });
    expect(slot.getByRole("link", { name: /Review CER handling/ }).textContent).not.toContain("bob/cer");
    expect(slot.container.querySelector('[data-row-status="Workflow running"]')).not.toBeNull();
    expect(slot.container.querySelector('[data-thread-status-glyph="working-draft"]')).not.toBeNull();
  });

  it("shows an empty state when there are no threads", async () => {
    const { slot } = await renderList({ threads: [makeThread({ id: "gone", isArchived: true })] });
    expect(slot.getByText("No threads yet")).toBeTruthy();
    expect(slot.queryAllByRole("link")).toHaveLength(0);
  });
});
