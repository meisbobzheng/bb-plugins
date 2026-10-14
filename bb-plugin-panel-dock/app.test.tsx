// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/" }
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
  type CapturedPluginApp,
} from "@get-bb/plugin-sdk/testing/app";
import { toggleFloatingTerminal } from "./terminal";

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
    expect(root.style.getPropertyValue("--panel-dock-height")).toBe("300px");
    pointer(panel, "lostpointercapture");

    expect(root.dataset.panelDockResizing).toBeUndefined();
    expect(localStorage.getItem(`${PLUGIN_ID}:height`)).toBe("300px");
    await mounted.lifecycle.dispose();
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
  const toggle = (threadId: string) => act(() => toggleFloatingTerminal(threadId));

  it("floats a terminal from the header menu and puts the panel away again", async () => {
    const mounted = await mount();
    const { create } = renderMenu("thr_float");

    await choose("menuitem", "Floating terminal");
    expect(root.dataset.panelFloat).toBe("");
    expect(create).toHaveBeenCalledOnce();

    const hide = panelToggle("Hide");
    await toggle("thr_float");
    expect(root.dataset.panelFloat).toBeUndefined();
    expect(hide.click).toHaveBeenCalledOnce();
    await mounted.lifecycle.dispose();
  });

  it("reuses the thread's floating terminal while it is open", async () => {
    const { slot, create } = renderMenu("thr_reuse");

    await toggle("thr_reuse");
    await toggle("thr_reuse");
    await toggle("thr_reuse");

    expect(create).toHaveBeenCalledOnce();
    const opens = slot.inspection.navigateCalls.filter(
      (call) => JSON.stringify(call).includes("term_thr_reuse"),
    );
    expect(opens).toHaveLength(2);
    await toggle("thr_reuse");
  });

  it("leaves a panel that was already open in place", async () => {
    renderMenu("thr_open");
    const hide = panelToggle("Hide");

    await toggle("thr_open");
    await toggle("thr_open");

    expect(root.dataset.panelFloat).toBeUndefined();
    expect(hide.click).not.toHaveBeenCalled();
  });

  it("stops floating when the panel is closed some other way", async () => {
    const panel = renderPanels();
    renderMenu("thr_closed");

    await toggle("thr_closed");
    expect(root.dataset.panelFloat).toBe("");
    await act(async () => {
      panel.querySelector("aside")!.setAttribute("aria-hidden", "true");
    });

    expect(root.dataset.panelFloat).toBeUndefined();
  });

  it("stops floating when the thread's header unmounts", async () => {
    const { slot } = renderMenu("thr_leave");

    await toggle("thr_leave");
    slot.lifecycle.unmount();

    expect(root.dataset.panelFloat).toBeUndefined();
  });
});
