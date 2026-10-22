// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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

async function renderLauncher(settings: Record<string, boolean> = {}) {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays[0]!;
  let state: LauncherState = { pinnedProjectIds: [], usage: {} };
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
      conversationOutline: async () => ({ items: [{ id: "m1", role: "user", preview: "Please check the CER", attachmentSummary: null }], maxSeq: 1 }),
      pin: async () => ({}),
      spawn: async () => ({ id: "thr_new" }),
    },
  } as unknown as PluginSdkTestFakes;
  const slot = renderSlot<object, typeof rpcContract>(overlay, {}, {
    settings,
    context: { projectId: "proj_a", threadId: null },
    sidebarThreads: {
      status: "ready",
      threads: THREADS,
      projects: [makeProject("proj_a", "hss"), makeProject("proj_b", "go-diameter")],
      sections: [],
    },
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

  it("leaves ⌘K to bb when the shortcut setting is off", async () => {
    const slot = await renderLauncher({ replaceShortcut: false });
    pressModK();
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("filters by query and opens the selected thread", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("textbox");
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
    const input = await slot.findByRole("textbox");
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
    const input = await slot.findByRole("textbox");
    fireEvent.change(input, { target: { value: "add retry to the CER loop" } });
    fireEvent.mouseMove(await slot.findByText("Ask in hss"));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const spawn = slot.inspection.sdkCalls.find((call) => call.method === "threads.spawn");
      expect(spawn?.args[0]).toMatchObject({ projectId: "proj_a", prompt: "add retry to the CER loop" });
    });
  });

  it("toggles an app setting from the settings page", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("textbox");
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
    const input = await slot.findByRole("textbox");
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

  it("goes back with Escape before closing", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("textbox");
    fireEvent.change(input, { target: { value: "plugins" } });
    fireEvent.mouseMove(await slot.findByText("Plugins…"));
    fireEvent.keyDown(input, { key: "Enter" });
    await slot.findByText("Plugins", { selector: "span" });
    fireEvent.keyDown(slot.getByRole("textbox"), { key: "Escape" });
    await waitFor(() => expect(slot.getByRole("textbox").getAttribute("placeholder")).toContain("Search threads"));
    fireEvent.keyDown(slot.getByRole("textbox"), { key: "Escape" });
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });
});
