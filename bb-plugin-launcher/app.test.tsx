// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PluginSidebarPullRequest, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot, type PluginSdkTestFakes } from "@get-bb/plugin-sdk/testing/app";
import { makeProject, makeThread } from "./fixtures";
import { launcher } from "./launcher/store";
import type { LauncherState } from "./model";
import type { rpcContract } from "./server";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  act(() => launcher.close());
  cleanup();
});

const GENERAL = {
  allowFastServiceTier: false,
  confirmThreadArchive: true,
  defaultMachineAccess: null,
  defaultProviderId: "claude-code",
  keepHistoryAfterContextClear: false,
  machineGitCredentialsEnabled: false,
  machineServerUrl: null,
  managedBranchPrefix: "bb/",
  onboardingCompletedAt: null,
  providerCompletedTurnDisplay: {},
  providerOrder: [],
  showDiagnosticEvents: false,
  showGitChanges: true,
  showKeyboardHints: true,
  steerActiveThreadOnEnter: false,
  streamerMode: false,
  telemetryEnabled: false,
};

const THREADS = [
  makeThread({ id: "thr_wait", displayTitle: "Review CER handling", indicator: "waiting-for-input", latestAttentionAt: 9 }),
  makeThread({ id: "thr_pin", displayTitle: "Pinned rollout plan", isPinned: true, projectId: "proj_b" }),
  makeThread({ id: "thr_old", displayTitle: "Old cleanup", updatedAt: 1 }),
];

const CER_OUTLINE = {
  items: [{ id: "m1", role: "user", preview: "Please check the CER", attachmentSummary: null }],
  maxSeq: 1,
};

interface RenderOptions {
  settings?: Record<string, boolean>;
  state?: LauncherState;
  threads?: PluginSidebarThread[];
  outline?: (threadId: string) => Promise<unknown>;
  pullRequests?: Record<string, PluginSidebarPullRequest>;
}

async function renderLauncher({
  settings = {},
  state: initialState = { pinnedProjectIds: [], usage: {} },
  threads = THREADS,
  outline = async () => CER_OUTLINE,
  pullRequests,
}: RenderOptions = {}) {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays[0]!;
  let state = initialState;
  const sdk = {
    system: {
      config: async () => ({ generalSettings: GENERAL }),
      updateGeneralSettings: async () => ({}),
    },
    plugins: {
      list: async () => ({ plugins: [] }),
      experimental_discoverRpc: async () => [{ pluginId: "spotify", method: "launcher.search", displayName: "Spotify", methodDescription: null, registrationDescription: null, inputSchema: {}, outputSchema: {} }],
      callRpc: async ({ method, input }: { method: string; input: { query?: string } }) =>
        method === "launcher.search"
          ? {
              items: (input.query ?? "").includes("deep")
                ? [{ id: "pl:spotify:playlist:p1", title: "Deep Work", subtitle: "Playlist · 42 songs", section: "Spotify playlists", actions: [{ id: "play", title: "Play" }], keywords: [] }]
                : [],
            }
          : { message: "Playing Deep Work", navigate: null },
    },
    threads: {
      search: async () => ({ active: { results: [], total: 0 }, archived: { results: [], total: 0 } }),
      conversationOutline: ({ threadId }: { threadId: string }) => outline(threadId),
      pin: async () => ({}),
      spawn: async () => ({ id: "thr_new" }),
    },
  } as unknown as PluginSdkTestFakes;
  const slot = renderSlot<object, typeof rpcContract>(overlay, {}, {
    settings,
    context: { projectId: "proj_a", threadId: null },
    sidebarThreads: {
      status: "ready",
      threads,
      projects: [makeProject("proj_a", "hss"), makeProject("proj_b", "go-diameter")],
      sections: [],
    },
    sidebarPullRequests: pullRequests,
    sdk,
    rpc: {
      state_get: () => state,
      usage_record: () => state,
      project_pin_set: ({ projectId, pinned }) => {
        state = { ...state, pinnedProjectIds: pinned ? [projectId] : [] };
        return state;
      },
    },
  });
  return slot;
}

const pressModK = () => fireEvent.keyDown(window, { key: "k", ctrlKey: true });
const wait = (ms = 0) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const callCount = (calls: readonly { method: string }[], method: string) =>
  calls.filter((call) => call.method === method).length;

describe("launcher", () => {
  it("opens with ⌘K and groups threads by attention, pins, and projects", async () => {
    const slot = await renderLauncher();
    expect(slot.queryByRole("dialog")).toBeNull();
    pressModK();
    await slot.findByRole("dialog");
    expect(slot.getByRole("group", { name: "Needs attention" }).textContent).toContain("Review CER handling");
    expect(slot.getByRole("group", { name: "Pinned" }).textContent).toContain("Pinned rollout plan");
    expect(slot.getByRole("group", { name: "Projects" }).textContent).toContain("go-diameter");
    await slot.findByText("Please check the CER");
  });

  it("has pins and usage loaded before it opens and keeps them between opens", async () => {
    const slot = await renderLauncher({ state: { pinnedProjectIds: ["proj_b"], usage: {} } });
    await wait();
    pressModK();
    expect(slot.getByRole("group", { name: "Pinned" }).textContent).toContain("go-diameter");
    act(() => launcher.close());
    pressModK();
    await slot.findByRole("dialog");
    expect(callCount(slot.inspection.rpcCalls, "state_get")).toBe(1);
    expect(callCount(slot.inspection.sdkCalls, "system.config")).toBe(3);
  });

  it("previews only the selected thread's own messages and pull request", async () => {
    const pullRequest = { number: 12, title: "Handle CER retries" } as PluginSidebarPullRequest;
    const slot = await renderLauncher({
      outline: (threadId) =>
        threadId === "thr_wait" ? Promise.resolve(CER_OUTLINE) : threadId === "thr_old" ? Promise.reject(new Error("offline")) : new Promise(() => {}),
      pullRequests: { thr_wait: pullRequest },
    });
    pressModK();
    const preview = await slot.findByRole("complementary", { name: "Preview" });
    await within(preview).findByText("Please check the CER");
    expect(preview.textContent).toContain("#12 Handle CER retries");
    fireEvent.keyDown(slot.getByRole("combobox"), { key: "ArrowDown" });
    await wait(200);
    expect(preview.textContent).toContain("Pinned rollout plan");
    expect(preview.textContent).toContain("Loading conversation…");
    expect(preview.textContent).not.toContain("Please check the CER");
    expect(preview.textContent).not.toContain("Handle CER retries");
    fireEvent.keyDown(slot.getByRole("combobox"), { key: "ArrowDown" });
    await within(preview).findByText("Could not load messages.");
  });

  it("keeps the preview pane open on results without a preview", async () => {
    const slot = await renderLauncher();
    pressModK();
    await slot.findByRole("dialog");
    fireEvent.mouseMove(slot.getByText("Settings…"));
    expect(within(slot.getByRole("complementary", { name: "Preview" })).getByText("Settings…")).toBeTruthy();
  });

  it("leaves ⌘K to bb when the shortcut setting is off", async () => {
    const slot = await renderLauncher({ settings: { replaceShortcut: false } });
    pressModK();
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("filters by query and opens the selected thread", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "cleanup" } });
    expect(slot.getByRole("option", { selected: true }).textContent).toContain("Old cleanup");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_old" }),
    );
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("opens the actions panel and pins a thread", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "old cleanup" } });
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });
    await slot.findByRole("group", { name: "Actions" });
    fireEvent.change(input, { target: { value: "pin" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(slot.inspection.sdkCalls.some((call) => call.method === "threads.pin")).toBe(true),
    );
  });

  it("starts a thread in the current project from a typed prompt", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "add retry to the CER loop" } });
    fireEvent.mouseMove(await slot.findByText("Ask in hss"));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const spawn = slot.inspection.sdkCalls.find((call) => call.method === "threads.spawn");
      expect(spawn?.args[0]).toMatchObject({ projectId: "proj_a", prompt: "add retry to the CER loop" });
    });
  });

  it("lists a project's latest threads and finds older ones by search", async () => {
    const threads = Array.from({ length: 120 }, (_, index) =>
      makeThread({ id: `thr_${index}`, projectId: "proj_b", displayTitle: `Rollout step ${index}`, updatedAt: 1000 - index }),
    );
    const slot = await renderLauncher({ threads });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "go-diameter" } });
    fireEvent.mouseMove(within(slot.getByRole("group", { name: "Projects" })).getByText("go-diameter"));
    fireEvent.keyDown(input, { key: "Enter" });
    const latest = await slot.findByRole("group", { name: "Threads · latest 100 of 120" });
    expect(within(latest).getAllByRole("option")).toHaveLength(100);
    fireEvent.change(input, { target: { value: "step 119" } });
    expect(slot.getByRole("option", { selected: true }).textContent).toContain("Rollout step 119");
  });

  it("toggles an app setting from the settings page", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "streamer" } });
    await slot.findByText("Streamer mode");
    fireEvent.mouseMove(slot.getByText("Streamer mode"));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const update = slot.inspection.sdkCalls.find((call) => call.method === "system.updateGeneralSettings");
      expect(update?.args[0]).toMatchObject({ streamerMode: true, showGitChanges: true });
    });
  });

  it("lists results from plugins that publish launcher.search and runs their action", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "deep" } });
    const group = await slot.findByRole("group", { name: "Spotify playlists" });
    expect(group.textContent).toContain("Deep Work");
    fireEvent.mouseMove(slot.getByText("Deep Work"));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const run = slot.inspection.sdkCalls.find((call) => call.method === "plugins.callRpc" && (call.args[0] as { method: string }).method === "launcher.run");
      expect(run?.args[0]).toMatchObject({ pluginId: "spotify", input: { itemId: "pl:spotify:playlist:p1", actionId: "play" } });
    });
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("points the search field at the selected result and starts over as you type", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    const selected = () => slot.getByRole("option", { selected: true });
    expect(input.getAttribute("aria-controls")).toBe(slot.getByRole("listbox").id);
    expect(input.getAttribute("aria-activedescendant")).toBe(selected().id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected().textContent).toContain("Pinned rollout plan");
    expect(input.getAttribute("aria-activedescendant")).toBe(selected().id);
    fireEvent.change(input, { target: { value: "o" } });
    expect(slot.getAllByRole("option")[0]).toBe(selected());
  });

  it("returns to the same result after its actions close", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(slot.getByRole("option", { selected: true }).textContent).toContain("Old cleanup");
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });
    await slot.findByRole("group", { name: "Actions" });
    fireEvent.keyDown(slot.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(slot.getByRole("option", { selected: true }).textContent).toContain("Old cleanup"));
  });

  it("keeps focus in the search field when a result is clicked", async () => {
    const slot = await renderLauncher();
    pressModK();
    await slot.findByRole("dialog");
    expect(fireEvent.mouseDown(slot.getByText("Old cleanup"))).toBe(false);
  });

  it("goes back with Escape before closing", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "plugins" } });
    fireEvent.mouseMove(await slot.findByText("Plugins…"));
    fireEvent.keyDown(input, { key: "Enter" });
    await slot.findByText("Plugins", { selector: "span" });
    expect(callCount(slot.inspection.sdkCalls, "plugins.list")).toBe(1);
    fireEvent.keyDown(slot.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(slot.getByRole("combobox").getAttribute("placeholder")).toContain("Search threads"));
    fireEvent.keyDown(slot.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });
});
