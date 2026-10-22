// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD, SHELL, press, settle, stage, type } from "./fixtures";
import { mountVim, type VimHost } from "./vim/engine";
import { vim } from "./vim/store";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

let unmount: () => void = () => {};
let host: VimHost & { openThread: ReturnType<typeof vi.fn> };

function start(html: string, { mac = false, threadId = "t1" }: { mac?: boolean; threadId?: string | null } = {}) {
  const root = stage(html);
  host = { openThread: vi.fn(), threadId: () => threadId };
  unmount = mountVim(host, document, mac);
  return root;
}

const byId = (id: string) => document.getElementById(id)!;
const row = (threadId: string) => document.querySelector<HTMLElement>(`[data-sidebar-thread-id="${threadId}"]`)!;

beforeEach(() => {
  vim.set({ help: false, paused: false });
});

afterEach(() => {
  unmount();
  document.body.innerHTML = "";
});

describe("panes and lists", () => {
  it("scrolls the chat with j and k, then moves into the sidebar with h", () => {
    start(SHELL);
    const timeline = byId("timeline");
    expect(press("j").defaultPrevented).toBe(true);
    press("j");
    expect(timeline.scrollTop).toBe(120);
    press("k");
    expect(timeline.scrollTop).toBe(60);

    press("h");
    expect(document.activeElement).toBe(row("t1"));
    expect(vim.get().cursor).toBe(row("t1"));
    press("j");
    expect(document.activeElement).toBe(row("t2"));
    type("gg");
    expect(document.activeElement).toBe(row("t1"));
    press("G", { shiftKey: true });
    expect(document.activeElement).toBe(row("t3"));
    press("j");
    expect(document.activeElement).toBe(row("t3"));
  });

  it("lands on the row level with the chat when the open thread is not listed", () => {
    start(SHELL, { threadId: null });
    press("h");
    expect(document.activeElement).toBe(row("t3"));
  });

  it("returns to the chat with l and back to the same row with h", () => {
    start(SHELL);
    press("h");
    press("j");
    press("l");
    expect(vim.get().cursor).toBeNull();
    expect(vim.get().flash).toBe(document.querySelector("[data-split-pane-id]"));
    press("j");
    expect(byId("timeline").scrollTop).toBe(60);
    press("h");
    expect(document.activeElement).toBe(row("t2"));
  });

  it("moves between board columns to the card at the same height", () => {
    start(BOARD);
    press("j");
    expect(document.activeElement).toBe(byId("open-1"));
    press("j");
    press("j");
    expect(document.activeElement).toBe(byId("open-3"));
    press("l");
    expect(document.activeElement).toBe(byId("ready-2"));
    press("h");
    expect(document.activeElement).toBe(byId("open-3"));
    press("l");
    press("l");
    expect(document.activeElement).toBe(byId("ready-2"));
  });

  it("pages half a screen with d and u, and with Ctrl+D and Ctrl+U on macOS", () => {
    start(SHELL, { mac: true });
    const timeline = byId("timeline");
    press("d");
    expect(timeline.scrollTop).toBe(320);
    press("u", { ctrlKey: true });
    expect(timeline.scrollTop).toBe(0);
    press("d", { ctrlKey: true });
    expect(timeline.scrollTop).toBe(320);
    press("G", { shiftKey: true });
    expect(timeline.scrollTop).toBe(4000);
  });

  it("finds the chat's scroller without measuring every message in it", () => {
    start(SHELL);
    byId("timeline").insertAdjacentHTML("beforeend", "<article><p><span>message</span></p></article>".repeat(200));
    const measured = vi.spyOn(Element.prototype, "scrollHeight", "get");
    press("j");
    expect(byId("timeline").scrollTop).toBe(60);
    expect(measured.mock.calls.length).toBeLessThan(10);
    measured.mockRestore();
  });

  it("scrolls the chat without measuring every sidebar row", () => {
    start(SHELL.replace("</a>\n</div>", `</a>${'<a href="/threads/tx" class="more" data-sidebar-thread-shortcut-target="" data-box="0,140,240,32">More</a>'.repeat(50)}</div>`));
    const measured = [...document.querySelectorAll<HTMLElement>(".more")].map((el) => vi.spyOn(el, "getBoundingClientRect"));
    press("j");
    expect(byId("timeline").scrollTop).toBe(60);
    expect(measured).toHaveLength(50);
    expect(measured.filter((spy) => spy.mock.calls.length > 0)).toEqual([]);
  });

  it("leaves Ctrl+D to bb elsewhere, where it toggles the diff", () => {
    start(SHELL);
    expect(press("d", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("keeps j and k inside an open menu", () => {
    start(`${SHELL}
      <div role="menu" data-box="400,200,200,120">
        <div role="menuitem" tabindex="-1" id="rename" data-box="400,200,200,30">Rename</div>
        <div role="menuitem" tabindex="-1" id="archive" data-box="400,230,200,30">Archive</div>
      </div>`);
    press("j");
    expect(document.activeElement).toBe(byId("rename"));
    press("j");
    expect(document.activeElement).toBe(byId("archive"));
    press("h");
    expect(document.activeElement).toBe(byId("archive"));
  });
});

describe("acting", () => {
  it("opens the row under the cursor with Enter, and in a split with O", () => {
    start(SHELL);
    const clicked = vi.fn((event: MouseEvent) => event.preventDefault());
    row("t2").addEventListener("click", clicked);
    expect(press("Enter").defaultPrevented).toBe(false);
    press("h");
    press("j");
    press("Enter");
    expect(clicked).toHaveBeenCalledTimes(1);
    press("o");
    expect(clicked).toHaveBeenCalledTimes(2);
    press("O", { shiftKey: true });
    expect(host.openThread).toHaveBeenCalledWith("t2", true);
  });

  it("drops the cursor when focus moves elsewhere, so Enter reaches that control", async () => {
    start(SHELL);
    press("h");
    byId("copy").focus();
    await settle();
    expect(vim.get().cursor).toBeNull();
    expect(press("Enter").defaultPrevented).toBe(false);
  });

  it("routes an unhandled in-app link through history instead of reloading", () => {
    start(SHELL);
    const popped = vi.fn();
    window.addEventListener("popstate", popped, { once: true });
    press("h");
    press("Enter");
    expect(location.pathname).toBe("/threads/t1");
    expect(popped).toHaveBeenCalled();
  });

  it("switches threads with gt, gT, J, and K", () => {
    start(SHELL, { threadId: "t2" });
    type("gt");
    expect(host.openThread).toHaveBeenLastCalledWith("t3", false);
    type("gT");
    expect(host.openThread).toHaveBeenLastCalledWith("t1", false);
    press("J", { shiftKey: true });
    expect(host.openThread).toHaveBeenLastCalledWith("t3", false);
    expect(vim.get().pending).toBe("");
  });

  it("shows pending keys and drops them on Escape", () => {
    start(SHELL);
    press("g");
    expect(vim.get().pending).toBe("g");
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(vim.get().pending).toBe("");
    expect(press("Escape").defaultPrevented).toBe(false);
  });

  it("focuses the composer with i and leaves it with Escape", async () => {
    start(SHELL);
    press("i");
    const composer = byId("composer");
    expect(document.activeElement).toBe(composer);
    await settle();
    expect(vim.get().mode).toBe("insert");
    expect(press("j").defaultPrevented).toBe(false);
    press("Escape");
    await settle();
    expect(document.activeElement).toBe(document.body);
    expect(vim.get().mode).toBe("normal");
  });

  it("leaves a field with Ctrl+[ on macOS", async () => {
    start(SHELL, { mac: true });
    press("i");
    press("[", { ctrlKey: true });
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not blur when the field handled Escape itself", async () => {
    start(SHELL);
    press("i");
    byId("composer").addEventListener("keydown", (event) => event.preventDefault());
    press("Escape");
    await settle();
    expect(document.activeElement).toBe(byId("composer"));
  });

  it("focuses search with /, falling back to the composer", () => {
    start(BOARD);
    press("/");
    expect(document.activeElement).toBe(document.querySelector('input[type="search"]'));
    unmount();
    document.body.innerHTML = "";
    start(SHELL);
    press("/");
    expect(document.activeElement).toBe(byId("composer"));
  });

  it("toggles the cheat sheet with ?", () => {
    start(SHELL);
    press("?", { shiftKey: true });
    expect(vim.get().help).toBe(true);
    press("?", { shiftKey: true });
    expect(vim.get().help).toBe(false);
  });
});

describe("hints", () => {
  it("labels what is on screen and clicks the one you type", () => {
    start(SHELL);
    const copied = vi.fn();
    byId("copy").addEventListener("click", copied);
    press("f");
    const hints = vim.get().hints!;
    expect(hints.map((hint) => hint.element.textContent?.trim() || hint.element.id)).toEqual([
      "New thread",
      "Plan rollout",
      "Fix CER retries",
      "Review PR 12",
      "Copy",
      "composer",
    ]);
    const label = hints.find((hint) => hint.element.id === "copy")!.label;
    for (const char of label) press(char);
    expect(copied).toHaveBeenCalledTimes(1);
    expect(vim.get().hints).toBeNull();
  });

  it("measures each offscreen button once and gives it no hint", () => {
    start(`${SHELL}${'<button class="later" data-box="300,900,60,24">Later</button>'.repeat(50)}`);
    const measured = [...document.querySelectorAll<HTMLElement>(".later")].map((el) => vi.spyOn(el, "getBoundingClientRect"));
    press("f");
    expect(vim.get().hints).toHaveLength(6);
    expect(measured.map((spy) => spy.mock.calls.length)).toEqual(measured.map(() => 1));
  });

  it("skips buttons that stay transparent until hovered", () => {
    start(`${SHELL}<button id="close" data-box="400,300,20,20">Close</button>`);
    byId("close").checkVisibility = (options) => options?.opacityProperty !== true;
    press("f");
    expect(vim.get().hints!.map((hint) => hint.element.id)).not.toContain("close");
    expect(vim.get().hints).toHaveLength(6);
  });

  it("focuses a text field picked by hint", () => {
    start(SHELL);
    press("f");
    const label = vim.get().hints!.find((hint) => hint.element.id === "composer")!.label;
    for (const char of label) press(char);
    expect(document.activeElement).toBe(byId("composer"));
  });

  it("moves the cursor with F, then lists continue from there", () => {
    start(SHELL);
    press("F", { shiftKey: true });
    const label = vim.get().hints!.find((hint) => hint.element === row("t1"))!.label;
    for (const char of label) press(char);
    expect(vim.get().cursor).toBe(row("t1"));
    press("j");
    expect(document.activeElement).toBe(row("t2"));
  });

  it("opens menus with a pointer press so popup triggers respond", () => {
    start(`<button aria-haspopup="menu" id="more" data-box="10,10,40,20">More</button>`);
    const events: string[] = [];
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) byId("more").addEventListener(type, () => events.push(type));
    press("f");
    press(vim.get().hints![0]!.label);
    expect(events).toEqual(["pointerdown", "mousedown", "mouseup", "click"]);
  });

  it("cancels on Escape or any key that is not a hint", () => {
    start(SHELL);
    press("f");
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(vim.get().hints).toBeNull();
    press("f");
    press("z");
    expect(vim.get().hints).toBeNull();
  });
});

describe("staying out of the way", () => {
  it("ignores keys while typing", () => {
    start(`${SHELL}<input id="name" data-box="10,10,100,20" />`);
    byId("name").focus();
    expect(press("j").defaultPrevented).toBe(false);
    expect(press("f").defaultPrevented).toBe(false);
  });

  it("passes everything through to terminals, including Escape", async () => {
    start(`${SHELL}<div class="xterm" data-box="300,300,400,200"><textarea id="term"></textarea></div>`);
    byId("term").focus();
    expect(press("j").defaultPrevented).toBe(false);
    press("Escape");
    await settle();
    expect(document.activeElement).toBe(byId("term"));
  });

  it("treats a floating, non-modal window as a pane and leaves the Scratchpad canvas alone", () => {
    start(`${SHELL}
      <div role="dialog" aria-modal="false" data-box="600,100,400,400">
        <div data-scratchpad-canvas="" tabindex="0" id="canvas" data-box="600,140,400,360"></div>
      </div>`);
    press("h");
    expect(document.activeElement).toBe(row("t1"));
    byId("canvas").focus();
    expect(press("r").defaultPrevented).toBe(false);
    expect(press("j").defaultPrevented).toBe(false);
  });

  it("leaves keys another surface claims with data-vim-defer", () => {
    start(`${SHELL}<div data-vim-defer="j k" data-box="240,0,784,768"></div>`);
    expect(press("j").defaultPrevented).toBe(false);
    expect(press("l").defaultPrevented).toBe(true);
  });

  it("skips keys someone already handled, and modifier shortcuts", () => {
    start(SHELL);
    document.body.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    press("j");
    expect(byId("timeline").scrollTop).toBe(0);
    expect(press("k", { metaKey: true }).defaultPrevented).toBe(false);
    expect(press("1").defaultPrevented).toBe(false);
  });

  it("removes every listener when unmounted", () => {
    start(SHELL);
    unmount();
    expect(press("j").defaultPrevented).toBe(false);
    expect(vim.get().cursor).toBeNull();
  });
});
