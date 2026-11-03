// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/" }
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PluginSidebarPullRequest, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot, type PluginSdkTestFakes, type TestThreadActionsResolver } from "@get-bb/plugin-sdk/testing/app";
import { makeProject, makeThread } from "./fixtures";
import { launcher } from "./launcher/store";
import type { LauncherState } from "./model";
import type { SpecHit } from "./launcher/specs";
import type { rpcContract } from "./server";
import type { TelecomHit } from "./telecom";

declare const jsdom: { window: Window };
vi.stubGlobal("localStorage", jsdom.window.localStorage);

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
  localStorage.clear();
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

const TELECOM_PLUGIN = { id: "telecom-ref", name: "Telecom reference", status: "running", enabled: true, version: "0.1.0", icon: null, iconUrl: null };

const SPEC_PLUGIN = { id: "spec-search", name: "Spec Search", status: "running", enabled: true, version: "0.1.0", icon: null, iconUrl: null };

const B1: SpecHit = {
  spec: "29.228",
  kind: "TS",
  version: "19.2.0",
  clause: "B.1",
  title: "General description",
  snippet: "The following picture gives an outline of the UML model of the user profile",
  match: "clause",
};

const B1_CLAUSE = {
  spec: { spec: "29.228", kind: "TS", title: "IP Multimedia (IM) Subsystem Cx and Dx interfaces", version: "19.2.0", release: 19 },
  clause: "B.1",
  title: "General description",
  body: "The following picture gives an outline of the UML model of the user profile, which is downloaded from HSS to S-CSCF.",
  parent: { clause: "B", title: "Annex B (informative): User profile UML model" },
  children: [],
};

function specRpc(method: string, input: { query?: string; spec?: string }) {
  if (method === "clause") return { clause: B1_CLAUSE };
  if (method === "fetch") return { status: "done", note: `Indexed TS ${input.spec} V19.6.0: 412 clauses.` };
  const query = input.query ?? "";
  if (query.startsWith("29.272")) return { hits: [], missing: "29.272" };
  if (query.startsWith("29.228")) return { hits: [B1], missing: null };
  if (query.includes("profile")) {
    return { hits: [{ ...B1, match: "text", snippet: "an outline of the UML model of the user \u0002profile\u0003" }], missing: null };
  }
  return { hits: [], missing: null };
}

const specCalls = (calls: readonly { method: string; args: readonly unknown[] }[], method: string) =>
  calls.filter((call) => call.method === "plugins.callRpc" && (call.args[0] as { pluginId: string; method: string }).method === method && (call.args[0] as { pluginId: string }).pluginId === SPEC_PLUGIN.id);

const SAR: TelecomHit = {
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
};

const SAR_FLAGS: TelecomHit = {
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
};

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
  threadId?: string | null;
  threadActions?: TestThreadActionsResolver;
  plugins?: object[];
  telecom?: (query: string) => TelecomHit[];
}

async function renderLauncher({
  settings = {},
  state: initialState = { pinnedProjectIds: [], usage: {} },
  threads = THREADS,
  outline = async () => CER_OUTLINE,
  pullRequests,
  threadId = null,
  threadActions,
  plugins = [],
  telecom = (query) => (query.toLowerCase().startsWith("sar") ? [SAR, SAR_FLAGS] : []),
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
      list: async () => ({ plugins }),
      experimental_discoverRpc: async () => [{ pluginId: "spotify", method: "launcher.search", displayName: "Spotify", methodDescription: null, registrationDescription: null, inputSchema: {}, outputSchema: {} }],
      callRpc: async ({ pluginId, method, input }: { pluginId: string; method: string; input: { query?: string } }) =>
        pluginId === SPEC_PLUGIN.id
          ? specRpc(method, input)
          : method === "launcher.search"
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
    context: { projectId: "proj_a", threadId },
    threadActions,
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
      telecom_search: ({ query }) => telecom(query),
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

  it("offers the secondary action with its shortcut in the footer", async () => {
    const slot = await renderLauncher();
    pressModK();
    fireEvent.click(await slot.findByRole("button", { name: "Open in split Ctrl+↵" }));
    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_wait", options: { split: true } }),
    );
  });

  it("highlights the part of each title that matches the query", async () => {
    const slot = await renderLauncher();
    pressModK();
    fireEvent.change(await slot.findByRole("combobox"), { target: { value: "clean old" } });
    const marks = [...slot.getByRole("option", { selected: true }).querySelectorAll("mark")];
    expect(marks.map((mark) => mark.textContent)).toEqual(["Old", "clean"]);
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
    expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("go-diameter");
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
    fireEvent.mouseMove(await slot.findByRole("option", { name: /Streamer mode/ }));
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
    await waitFor(() => expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("Deep Work"));
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
    expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("Plugins…");
    fireEvent.keyDown(input, { key: "Enter" });
    await slot.findByText("Plugins", { selector: "span" });
    expect(callCount(slot.inspection.sdkCalls, "plugins.list")).toBe(2);
    fireEvent.keyDown(slot.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(slot.getByRole("combobox").getAttribute("placeholder")).toContain("Search threads"));
    fireEvent.keyDown(slot.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("adds bb's and plugins' thread actions to a thread's actions, skipping ones the launcher has", async () => {
    const ran: string[] = [];
    const entry = (key: string, label: string, extra: object = {}) => ({
      key,
      pluginId: key.split("/")[0]!,
      group: "a",
      action: { label, icon: "Archive", run: async (value?: string) => void ran.push(value === undefined ? key : `${key}:${value}`), ...extra },
    });
    const slot = await renderLauncher({
      threadActions: (thread) => [
        entry("bb--core/pin", "Pin"),
        entry("bb--core/fork", "Fork"),
        entry("pr-board/review", "Run PR review"),
        entry("bb--core/hidden", "Disabled one", { disabled: true }),
        entry("bb--core/move", "Move to section", {
          choices: { items: [{ id: "sec_hss", label: "hss" }, { id: "sec_other", label: "other", selected: true }] },
        }),
        ...(thread.id === "thr_old" ? [] : [entry("x/never", "Never")]),
      ],
    });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "old cleanup" } });
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });
    const more = await slot.findByRole("group", { name: "More actions" });
    expect([...more.querySelectorAll('[role="option"]')].map((row) => row.textContent)).toEqual([
      "Fork",
      "Run PR review",
      "Move to section…",
    ]);

    fireEvent.change(input, { target: { value: "review" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(ran).toEqual(["pr-board/review"]));
  });

  it("lists a thread action's choices on their own page and runs the pick", async () => {
    const ran: string[] = [];
    const slot = await renderLauncher({
      threadActions: () => [
        {
          key: "bb--core/move",
          pluginId: "bb--core",
          group: "a",
          action: {
            label: "Move to section",
            icon: "FolderInput",
            choices: { items: [{ id: "sec_hss", label: "hss" }, { id: "sec_other", label: "other", selected: true }] },
            run: async (value?: string) => void ran.push(value ?? ""),
          },
        },
      ],
    });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "old cleanup" } });
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });
    await slot.findByRole("group", { name: "More actions" });
    fireEvent.change(input, { target: { value: "move" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await slot.findByRole("group", { name: "Move to section" })).textContent).toContain("other");
    fireEvent.change(slot.getByRole("combobox"), { target: { value: "hss" } });
    fireEvent.keyDown(slot.getByRole("combobox"), { key: "Enter" });
    await waitFor(() => expect(ran).toEqual(["sec_hss"]));
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("jumps back to the previous thread with Tab on an empty search", async () => {
    localStorage.setItem("test-plugin:visits", JSON.stringify(["thr_old", "thr_pin"]));
    const slot = await renderLauncher({ threadId: "thr_wait" });
    pressModK();
    const input = await slot.findByRole("combobox");
    expect(slot.getByRole("button", { name: /Back to Old cleanup/ })).toBeTruthy();

    fireEvent.change(input, { target: { value: "cer" } });
    expect(slot.queryByRole("button", { name: /Back to/ })).toBeNull();
    fireEvent.change(input, { target: { value: "" } });

    fireEvent.keyDown(input, { key: "Tab" });
    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_old" }),
    );
    expect(slot.queryByRole("dialog")).toBeNull();
    expect(JSON.parse(localStorage.getItem("test-plugin:visits")!)).toEqual(["thr_wait", "thr_old", "thr_pin"]);
  });

  it("leaves Tab alone when there is no previous thread", async () => {
    const slot = await renderLauncher({ threadId: "thr_wait" });
    pressModK();
    const input = await slot.findByRole("combobox");
    expect(slot.queryByRole("button", { name: /Back to/ })).toBeNull();
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
  });

  it("selects the best match across sections as Top hit and lists it once", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "settings" } });
    const top = slot.getByRole("group", { name: "Top hit" });
    expect(within(top).getByRole("option", { selected: true }).textContent).toContain("Settings…");
    expect(slot.queryByRole("group", { name: "Commands" })?.textContent ?? "").not.toContain("Settings…");
    expect(slot.getByRole("group", { name: "Ask an agent" })).toBeTruthy();
  });

  it("navigates to bb pages from results that close the launcher", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "keyboard shortcuts" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(window.location.pathname).toBe("/settings/keyboard"));
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("runs the Nth result with ⌘N while open and leaves the keys to bb while closed", async () => {
    const jumps: string[] = [];
    const onKeyDown = (event: KeyboardEvent) => jumps.push(event.key);
    window.addEventListener("keydown", onKeyDown);
    try {
      const slot = await renderLauncher();
      fireEvent.keyDown(window, { key: "1", ctrlKey: true });
      expect(jumps).toEqual(["1"]);
      pressModK();
      const input = await slot.findByRole("combobox");
      const second = slot.getAllByRole("option")[1]!;
      expect(second.textContent).toContain("Pinned rollout plan");
      expect(second.textContent).toContain("Ctrl+2");
      expect(slot.getAllByRole("option")[9]?.textContent ?? "").not.toMatch(/Ctrl\+\d/);
      expect(fireEvent.keyDown(input, { key: "2", ctrlKey: true })).toBe(false);
      await waitFor(() => expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_pin" }));
      expect(jumps).toEqual(["1"]);
      expect(slot.queryByRole("dialog")).toBeNull();
    } finally {
      window.removeEventListener("keydown", onKeyDown);
    }
  });

  it("drills into the selected project with Tab", async () => {
    const slot = await renderLauncher();
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "go-diameter" } });
    expect(slot.getByRole("button", { name: "Open project ⇥" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Tab" });
    await waitFor(() => expect(slot.getByRole("combobox").getAttribute("placeholder")).toContain("this project"));
    expect(slot.getByRole("combobox")).toHaveProperty("value", "");
    expect(slot.getByRole("group", { name: "Pinned" }).textContent).toContain("Pinned rollout plan");
  });

  it("asks telecom-ref only while it is running", async () => {
    const slot = await renderLauncher();
    pressModK();
    fireEvent.change(await slot.findByRole("combobox"), { target: { value: "SAR" } });
    await wait(200);
    expect(callCount(slot.inspection.rpcCalls, "telecom_search")).toBe(0);
    expect(slot.queryByRole("group", { name: "Telecom reference" })).toBeNull();
  });

  it("puts an exact telecom match first, above threads that only start with the query", async () => {
    const threads = [...THREADS, makeThread({ id: "thr_sar", displayTitle: "SAR retry handling" })];
    const slot = await renderLauncher({ threads, plugins: [TELECOM_PLUGIN] });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "SAR" } });
    expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("SAR retry handling");
    await waitFor(() => expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("SAR / SAA"));
    expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("Server-Assignment · command 301 · TS 29.229 §6.1.3");
    expect(slot.getByRole("group", { name: "Telecom reference" }).textContent).toContain("SAR-Flags");
    expect(slot.getByRole("group", { name: "Threads" }).textContent).toContain("SAR retry handling");
    const preview = slot.getByRole("complementary", { name: "Preview" });
    expect(preview.textContent).toContain("S-CSCF → HSS");
    expect(preview.textContent).toContain("store or clear itself");
    expect(slot.inspection.rpcCalls.find((call) => call.method === "telecom_search")?.input).toEqual({ query: "SAR", limit: 6 });

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(window.location.pathname).toBe("/plugins/telecom-ref/ref/diam.cmd/301"));
  });

  it("copies a telecom entry's citation", async () => {
    const slot = await renderLauncher({ plugins: [TELECOM_PLUGIN] });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "SAR" } });
    await waitFor(() => expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("SAR / SAA"));
    fireEvent.keyDown(input, { key: "c", ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(slot.inspection.experimental_clipboardWrites).toContainEqual({
        text: "SAR / SAA · Server-Assignment (command 301) · TS 29.229 §6.1.3",
      }),
    );
  });

  it("searches Telecom reference with ⌘↵ and drills into more telecom results with Tab", async () => {
    const slot = await renderLauncher({ plugins: [TELECOM_PLUGIN] });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "SAR" } });
    await waitFor(() => expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("SAR / SAA"));
    expect(slot.getByRole("button", { name: "More telecom results ⇥" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Tab" });
    const page = await slot.findByRole("group", { name: "Telecom reference" });
    expect(slot.getByRole("combobox")).toHaveProperty("value", "SAR");
    expect(within(page).getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("SAR / SAA"),
      expect.stringContaining("SAR-Flags"),
    ]);
    expect(slot.inspection.rpcCalls.at(-1)?.input).toEqual({ query: "SAR", limit: 20 });

    fireEvent.keyDown(slot.getByRole("combobox"), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(window.location.pathname).toBe("/plugins/telecom-ref/ref/q/SAR"));
  });

  it("asks Spec Search only while it is running", async () => {
    const slot = await renderLauncher();
    pressModK();
    fireEvent.change(await slot.findByRole("combobox"), { target: { value: "29.228 B.1" } });
    await wait(200);
    expect(specCalls(slot.inspection.sdkCalls, "search")).toHaveLength(0);
    expect(slot.queryByRole("group", { name: "3GPP specs" })).toBeNull();
  });

  it("makes an exact clause the top hit, previews its text, and asks about it with Enter", async () => {
    const slot = await renderLauncher({ plugins: [SPEC_PLUGIN] });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "29.228 B.1" } });
    await waitFor(() => expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("§B.1 General description"));
    expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("TS 29.228 V19.2.0");
    expect(specCalls(slot.inspection.sdkCalls, "search")[0]?.args[0]).toMatchObject({ input: { query: "29.228 B.1", limit: 5 } });
    const preview = slot.getByRole("complementary", { name: "Preview" });
    await waitFor(() => expect(preview.textContent).toContain("which is downloaded from HSS to S-CSCF"));
    expect(preview.textContent).toContain("§B Annex B (informative): User profile UML model");

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toCompose",
        options: { projectId: "proj_a", initialPrompt: "Read 3GPP TS 29.228 §B.1 (General description, V19.2.0) and explain it.", focusPrompt: true },
      }),
    );
  });

  it("copies a clause's text with ⌘↵ and its citation with ⌘⇧C", async () => {
    const slot = await renderLauncher({ plugins: [SPEC_PLUGIN] });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "29.228 B.1" } });
    await waitFor(() => expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("§B.1 General description"));
    fireEvent.keyDown(input, { key: "c", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(slot.inspection.experimental_clipboardWrites).toContainEqual({ text: "TS 29.228 §B.1 General description (V19.2.0)" }));
    pressModK();
    const reopened = await slot.findByRole("combobox");
    fireEvent.change(reopened, { target: { value: "29.228 B.1" } });
    await waitFor(() => expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("§B.1 General description"));
    fireEvent.keyDown(reopened, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(slot.inspection.experimental_clipboardWrites).toContainEqual({ text: `TS 29.228 §B.1 General description (V19.2.0)\n\n${B1_CLAUSE.body}` }),
    );
  });

  it("offers to fetch a spec that is not indexed", async () => {
    const slot = await renderLauncher({ plugins: [SPEC_PLUGIN] });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "29.272 7.3.2" } });
    await waitFor(() => expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("Fetch 29.272 from 3GPP"));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(specCalls(slot.inspection.sdkCalls, "fetch")[0]?.args[0]).toMatchObject({ input: { spec: "29.272" } }));
  });

  it("drills into more spec results with Tab and highlights the matched words", async () => {
    const slot = await renderLauncher({ plugins: [SPEC_PLUGIN] });
    pressModK();
    const input = await slot.findByRole("combobox");
    fireEvent.change(input, { target: { value: "user profile" } });
    await waitFor(() => expect(slot.getByRole("group", { name: "Top hit" }).textContent).toContain("§B.1 General description"));
    expect(within(slot.getByRole("group", { name: "Top hit" })).getByText("profile").tagName).toBe("MARK");
    expect(slot.getByRole("button", { name: "More spec results ⇥" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Tab" });
    await waitFor(() => expect(slot.getByRole("combobox").getAttribute("placeholder")).toContain("Search 3GPP specs"));
    const page = await slot.findByRole("group", { name: "3GPP specs" });
    expect(within(page).getAllByRole("option")).toHaveLength(1);
    expect(specCalls(slot.inspection.sdkCalls, "search").at(-1)?.args[0]).toMatchObject({ input: { query: "user profile", limit: 30 } });
  });
});
