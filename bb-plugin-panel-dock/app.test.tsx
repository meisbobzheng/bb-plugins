// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/" }
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
  type CapturedPluginApp,
} from "@get-bb/plugin-sdk/testing/app";
import { floating } from "./floating";

const xterm = vi.hoisted(() => ({
  instances: [] as Array<{
    written: unknown[];
    disposed: boolean;
    type(data: string): void;
    press(event: Partial<KeyboardEvent>): boolean;
  }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 100;
    rows = 30;
    written: unknown[] = [];
    disposed = false;
    private data: (data: string) => void = () => {};
    private keys: (event: KeyboardEvent) => boolean = () => true;
    constructor() {
      xterm.instances.push(this);
    }
    loadAddon() {}
    open(parent: HTMLElement) {
      const textarea = document.createElement("textarea");
      textarea.addEventListener("keydown", (event) => this.keys(event));
      parent.append(textarea);
    }
    focus() {}
    write(data: unknown) {
      this.written.push(data);
    }
    onData(handler: (data: string) => void) {
      this.data = handler;
    }
    onResize() {}
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keys = handler;
    }
    dispose() {
      this.disposed = true;
    }
    type(data: string) {
      this.data(data);
    }
    press(event: Partial<KeyboardEvent>) {
      return this.keys(new KeyboardEvent("keydown", { ...event, bubbles: true, cancelable: true } as KeyboardEventInit));
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

declare const jsdom: { window: Window };
vi.stubGlobal("localStorage", jsdom.window.localStorage);

const pointer = (target: Element, type: string, init: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...init }));

const PLUGIN_ID = "panel-dock";
const THREAD_ID = "thr_test";
const root = document.documentElement;

let app: CapturedPluginApp;

beforeAll(async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  app = await loadPluginApp(() => import("./app"));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.innerHTML = "";
});

const mount = () => mountPluginContentScripts(app, { pluginId: PLUGIN_ID });

function renderMenu(threadId = THREAD_ID) {
  const create = vi.fn(async () => ({ id: `term_${threadId}` }));
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId, projectId: "proj_test", isCompactViewport: false },
    { sdk: { terminals: { create } } as never, openTerminal: () => true },
  );
  return { slot, create };
}

function renderPanels() {
  localStorage.setItem(`${PLUGIN_ID}:dock`, "bottom");
  document.body.innerHTML = `
    <div data-split-resize-grid-root>
      <div data-panel></div>
      <div data-panel-resize-handle-id="thread-detail-secondary-panel-handle"></div>
      <div data-panel id="secondary"><aside></aside></div>
    </div>`;
  const panel = document.getElementById("secondary")!;
  panel.parentElement!.getBoundingClientRect = () => ({ bottom: 900 }) as DOMRect;
  panel.setPointerCapture = vi.fn();
  return panel;
}

function panelToggle(action: "Show" | "Hide") {
  const click = vi.fn();
  const button = document.createElement("button");
  button.setAttribute("aria-label", `${action} right panel`);
  button.addEventListener("click", click);
  document.body.append(button);
  return { click, button };
}

async function choose(role: "menuitem" | "menuitemradio", name: string) {
  const trigger = screen.getByRole("button", { name: "Panel position and terminal" });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.keyDown(screen.getByRole(role, { name }), { key: "Enter" });
  });
}

describe("content script", () => {
  it("restores the saved dock and height, and clears them on dispose", async () => {
    localStorage.setItem(`${PLUGIN_ID}:dock`, "bottom");
    localStorage.setItem(`${PLUGIN_ID}:height`, "320px");

    const mounted = await mount();
    expect(root.dataset.panelDock).toBe("bottom");
    expect(root.style.getPropertyValue("--panel-dock-height")).toBe("320px");

    await mounted.lifecycle.dispose();
    expect(root.dataset.panelDock).toBeUndefined();
    expect(root.style.getPropertyValue("--panel-dock-height")).toBe("");
  });

  it("falls back to the right for an unknown saved dock", async () => {
    localStorage.setItem(`${PLUGIN_ID}:dock`, "left");
    const mounted = await mount();
    expect(root.dataset.panelDock).toBe("right");
    await mounted.lifecycle.dispose();
  });

  it("resizes the bottom panel from its top edge and saves the height", async () => {
    const panel = renderPanels();
    const mounted = await mount();

    pointer(panel, "pointerdown");
    expect(root.dataset.panelDockResizing).toBe("");
    pointer(panel, "pointermove", { clientY: 600 });
    expect(panel.style.getPropertyValue("--panel-dock-height")).toBe("300px");
    expect(root.style.getPropertyValue("--panel-dock-height")).toBe("");
    pointer(panel, "lostpointercapture");

    expect(root.dataset.panelDockResizing).toBeUndefined();
    expect(root.style.getPropertyValue("--panel-dock-height")).toBe("300px");
    expect(panel.style.getPropertyValue("--panel-dock-height")).toBe("");
    expect(localStorage.getItem(`${PLUGIN_ID}:height`)).toBe("300px");
    await mounted.lifecycle.dispose();
  });

  it("keeps the saved height when the top edge is pressed without a drag", async () => {
    const panel = renderPanels();
    localStorage.setItem(`${PLUGIN_ID}:height`, "320px");
    const mounted = await mount();

    pointer(panel, "pointerdown");
    pointer(panel, "lostpointercapture");

    expect(root.style.getPropertyValue("--panel-dock-height")).toBe("320px");
    expect(localStorage.getItem(`${PLUGIN_ID}:height`)).toBe("320px");
    await mounted.lifecycle.dispose();
  });

  it("resets the bottom panel height on a double-click of its top edge", async () => {
    const panel = renderPanels();
    localStorage.setItem(`${PLUGIN_ID}:height`, "320px");
    const mounted = await mount();

    pointer(panel, "click", { detail: 1 });
    expect(root.style.getPropertyValue("--panel-dock-height")).toBe("320px");
    pointer(panel.querySelector("aside")!, "click", { detail: 2 });
    expect(root.style.getPropertyValue("--panel-dock-height")).toBe("320px");
    pointer(panel, "click", { detail: 2 });

    expect(root.style.getPropertyValue("--panel-dock-height")).toBe("");
    expect(localStorage.getItem(`${PLUGIN_ID}:height`)).toBeNull();
    await mounted.lifecycle.dispose();
  });

  it("clears a drag in progress on dispose", async () => {
    const panel = renderPanels();
    const mounted = await mount();

    pointer(panel, "pointerdown");
    pointer(panel, "pointermove", { clientY: 600 });
    await mounted.lifecycle.dispose();

    expect(root.dataset.panelDockResizing).toBeUndefined();
    expect(panel.style.getPropertyValue("--panel-dock-height")).toBe("");
  });

  it("ignores presses inside the panel content", async () => {
    const panel = renderPanels();
    const mounted = await mount();

    pointer(panel.querySelector("aside")!, "pointerdown");
    expect(root.dataset.panelDockResizing).toBeUndefined();
    await mounted.lifecycle.dispose();
  });
});

describe("header menu", () => {
  it("docks the panel at the bottom and opens it", async () => {
    const mounted = await mount();
    const show = panelToggle("Show");
    renderMenu();

    await choose("menuitemradio", "At the bottom");

    expect(root.dataset.panelDock).toBe("bottom");
    expect(localStorage.getItem(`${PLUGIN_ID}:dock`)).toBe("bottom");
    expect(show.click).toHaveBeenCalledOnce();
    await mounted.lifecycle.dispose();
  });

  it("opens a new thread terminal in the panel", async () => {
    const { slot, create } = renderMenu();

    await choose("menuitem", "New terminal");

    expect(create).toHaveBeenCalledWith({
      scope: { kind: "thread", threadId: THREAD_ID },
      cols: 80,
      rows: 24,
    });
    expect(slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({ options: { terminalId: `term_${THREAD_ID}` } }),
    );
  });

  it("renders nothing on compact viewports", () => {
    const slot = renderSlot(app.threadHeaderActions[0]!, {
      threadId: THREAD_ID,
      projectId: "proj_test",
      isCompactViewport: true,
    });
    expect(slot.container.innerHTML).toBe("");
  });
});


describe("floating terminal", () => {
  const encoded = (text: string) => btoa(text);

  function renderFloating(context: { threadId?: string | null; projectId?: string | null } = {}) {
    const create = vi.fn(async () => ({ id: "term_float", initialCwd: "/Users/bob/dev/bob-bb" }));
    const output = vi.fn(async ({ sinceSeq }: { sinceSeq?: number }) =>
      sinceSeq === undefined
        ? { chunks: [{ seq: 1, dataBase64: encoded("$ ") }], nextSeq: 2, status: "running" as const, exitCode: null, closeReason: null, truncated: false }
        : { chunks: [], nextSeq: sinceSeq, status: "running" as const, exitCode: null, closeReason: null, truncated: false },
    );
    const input = vi.fn(async () => ({}));
    const close = vi.fn(async () => ({}));
    const sdk = {
      terminals: { create, output, input, close, resize: vi.fn(async () => ({})) },
      environments: { list: vi.fn(async () => [{ id: "env_checkout", isWorktree: false, path: "/Users/bob/dev/bob-bb" }]) },
      hosts: { list: vi.fn(async () => [{ id: "host_local", machineProviderId: null, status: "connected" }]) },
    };
    const slot = renderSlot(app.appOverlays[0]!, {}, { sdk: sdk as never, context, pluginId: PLUGIN_ID });
    return { slot, sdk, create, output, input, close };
  }

  afterEach(() => {
    act(() => floating.hide());
    xterm.instances.length = 0;
  });

  it("opens over any screen in the project's checkout and shows its output", async () => {
    const { slot, create } = renderFloating({ projectId: "proj_test" });
    expect(slot.queryByRole("dialog", { name: "Floating terminal" })).toBeNull();

    act(() => floating.toggle());

    expect(await slot.findByRole("dialog", { name: "Floating terminal" })).toBeTruthy();
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        scope: { kind: "environment", environmentId: "env_checkout" },
        cols: 100,
        rows: 30,
        title: "Floating terminal",
      }),
    );
    expect(await slot.findByText("~/dev/bob-bb")).toBeTruthy();
    await waitFor(() => expect(xterm.instances[0]!.written).toHaveLength(1));
  });

  it("opens in the thread's workspace from a thread, and in the home folder elsewhere", async () => {
    const fromThread = renderFloating();
    act(() => floating.toggle({ threadId: THREAD_ID, projectId: "proj_test" }));
    await waitFor(() =>
      expect(fromThread.create).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: "thread", threadId: THREAD_ID } })),
    );
    act(() => fireEvent.click(fromThread.slot.getByRole("button", { name: "Close terminal" })));
    cleanup();

    const fromHome = renderFloating();
    act(() => floating.toggle());
    await waitFor(() =>
      expect(fromHome.create).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { kind: "host_path", hostId: "host_local", cwd: null } }),
      ),
    );
  });

  it("sends keystrokes, hides on Ctrl+` while keeping the session, and closes it from the header", async () => {
    const { slot, create, input, close } = renderFloating();
    act(() => floating.toggle());
    await slot.findByText("~/dev/bob-bb");
    const terminal = xterm.instances[0]!;

    terminal.type("ls\r");
    await waitFor(() => expect(input).toHaveBeenCalledWith({ terminalId: "term_float", dataBase64: encoded("ls\r") }));

    expect(terminal.press({ ctrlKey: true, key: "`" })).toBe(false);
    await waitFor(() => expect(slot.getByRole("dialog", { hidden: true }).className).toContain("hidden"));
    act(() => floating.toggle());
    expect(slot.getByRole("dialog").className).toContain("flex");
    expect(create).toHaveBeenCalledOnce();

    act(() => fireEvent.click(slot.getByRole("button", { name: "Close terminal" })));
    expect(close).toHaveBeenCalledWith({ terminalId: "term_float", mode: "force" });
    expect(terminal.disposed).toBe(true);
    expect(slot.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("hides on Ctrl+` pressed inside the terminal without bb's shortcut reopening it", async () => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "`") floating.toggle();
    };
    window.addEventListener("keydown", shortcut);
    try {
      const { slot } = renderFloating();
      act(() => floating.toggle());
      const dialog = await slot.findByRole("dialog", { name: "Floating terminal" });
      const textarea = dialog.querySelector("textarea")!;

      act(() => {
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "`", ctrlKey: true, bubbles: true, cancelable: true }));
      });

      expect(floating.get().open).toBe(false);
      expect(slot.getByRole("dialog", { hidden: true }).className).toContain("hidden");
    } finally {
      window.removeEventListener("keydown", shortcut);
    }
  });

  it("toggles from the sidebar footer on any screen", () => {
    const item = app.experimentalSidebarFooterItems.find(
      (entry) => (entry as { id?: string }).id === "floating-terminal",
    ) as unknown as { label: string; onActivate(): void };
    expect(item.label).toBe("Floating terminal");
    act(() => item.onActivate());
    expect(floating.get()).toEqual({ open: true, place: null });
  });
});
