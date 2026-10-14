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

function renderMenu(openTerminal = () => true) {
  const create = vi.fn(async () => ({ id: "term_1" }));
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: THREAD_ID, projectId: "proj_test", isCompactViewport: false },
    { sdk: { terminals: { create } } as never, openTerminal },
  );
  return { slot, create };
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
    document.body.insertAdjacentHTML(
      "beforeend",
      `<button aria-label="Show right panel (⌘B)"></button>`,
    );
    const show = vi.fn();
    document.querySelector("[aria-label^='Show right panel']")!.addEventListener("click", show);
    renderMenu();

    await choose("menuitemradio", "At the bottom");

    expect(root.dataset.panelDock).toBe("bottom");
    expect(localStorage.getItem(`${PLUGIN_ID}:dock`)).toBe("bottom");
    expect(show).toHaveBeenCalledOnce();
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
      expect.objectContaining({ options: { terminalId: "term_1" } }),
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
