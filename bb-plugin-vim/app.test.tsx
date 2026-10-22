// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { SHELL, press, stage } from "./fixtures";
import { vim } from "./vim/store";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  act(() => vim.set({ help: false, paused: false }));
  document.body.innerHTML = "";
});

async function renderVim(settings: Record<string, boolean> = {}) {
  stage(SHELL);
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(app.appOverlays[0]!, {}, { settings, context: { projectId: "proj_a", threadId: "t1" } });
}

const indicator = () => document.querySelector("[data-vim-mode]");
const keydown = (key: string, init: KeyboardEventInit = {}) => act(() => void press(key, init));

describe("vim overlay", () => {
  it("shows the mode and follows focus into text fields", async () => {
    await renderVim();
    await waitFor(() => expect(indicator()?.textContent).toBe("NORMAL"));
    keydown("i");
    await waitFor(() => expect(indicator()?.textContent).toBe("INSERT"));
    keydown("Escape");
    await waitFor(() => expect(indicator()?.textContent).toBe("NORMAL"));
    keydown("g");
    expect(indicator()?.textContent).toBe("NORMALg");
  });

  it("draws the cursor ring and link hints", async () => {
    await renderVim();
    keydown("h");
    expect(document.querySelector("[data-vim-ring]")).not.toBeNull();
    keydown("f");
    expect(document.querySelectorAll("[data-vim-hint]")).toHaveLength(6);
    const copy = vim.get().hints!.find((hint) => hint.element.id === "copy")!;
    const label = document.querySelector<HTMLElement>(`[data-vim-hint="${copy.label}"]`)!;
    expect([label.style.left, label.style.top]).toEqual(["900px", "104px"]);
    expect(indicator()?.textContent).toBe("HINT");
    keydown("Escape");
    expect(document.querySelectorAll("[data-vim-hint]")).toHaveLength(0);
  });

  it("shows the hint letters typed so far", async () => {
    await renderVim();
    stage(Array.from({ length: 14 }, (_, index) => `<button data-box="${300 + index * 30},300,20,20">${index}</button>`).join(""));
    keydown("f");
    keydown("s");
    expect(indicator()?.textContent).toBe("HINTs");
  });

  it("fades the indicator while the pointer is near it, and draws hints over it", async () => {
    await renderVim();
    const move = (clientX: number, clientY: number) => window.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY }));
    move(1000, 760);
    expect(indicator()?.hasAttribute("data-near")).toBe(true);
    move(500, 300);
    expect(indicator()?.hasAttribute("data-near")).toBe(false);
    keydown("f");
    expect(indicator()!.compareDocumentPosition(document.querySelector("[data-vim-hint]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("fits the ring around the cursor and hides it when the item goes away", async () => {
    await renderVim();
    keydown("h");
    const ring = document.querySelector<HTMLElement>("[data-vim-ring]")!;
    expect(ring.style.transform).toBe("translate(-2px, 38px)");
    expect(ring.style.width).toBe("244px");
    expect(ring.hidden).toBe(false);
    const row = document.querySelector<HTMLElement>('[data-sidebar-thread-id="t1"]')!;
    row.getBoundingClientRect = Element.prototype.getBoundingClientRect;
    row.remove();
    await waitFor(() => expect(ring.hidden).toBe(true));
  });

  it("switches threads through bb's navigation", async () => {
    const slot = await renderVim();
    keydown("g");
    keydown("t");
    expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread", threadId: "t2" }));
  });

  it("opens the cheat sheet with ?", async () => {
    const slot = await renderVim();
    keydown("?", { shiftKey: true });
    const dialog = await slot.findByRole("dialog", { name: "Vim keys" });
    expect(dialog.textContent).toContain("Click anything on screen by its hint");
    expect(dialog.textContent).toContain("gT");
  });

  it("does nothing when turned off in settings", async () => {
    await renderVim({ enabled: false });
    expect(indicator()).toBeNull();
    expect(press("j").defaultPrevented).toBe(false);
  });

  it("hides the indicator but keeps the keys", async () => {
    await renderVim({ showModeIndicator: false });
    expect(indicator()).toBeNull();
    expect(press("j").defaultPrevented).toBe(true);
  });

  it("pauses and resumes from the command", async () => {
    await renderVim();
    act(() => vim.togglePaused());
    expect(indicator()?.textContent).toBe("PAUSED");
    expect(press("j").defaultPrevented).toBe(false);
    act(() => vim.togglePaused());
    expect(press("j").defaultPrevented).toBe(true);
  });
});
