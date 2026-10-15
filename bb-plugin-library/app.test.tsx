// @vitest-environment jsdom
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { toggleRequests } from "./components/requests";
import { markLibraryVisible } from "./components/session";
import type { Entry, EntryHit, SearchResult } from "./contract";

const HIT: EntryHit = {
  id: "lib_1a2b3c4d",
  title: "S6a attach: ULR/ULA",
  kind: "flow",
  summary: "",
  tags: [
    { tag: "S6a", group: "interfaces" },
    { tag: "ULR/ULA", group: "messages" },
  ],
  source: { threadId: "thr_1", threadTitle: "Debug attach", messageId: null },
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  snippet: "the MME sends \u0002ULR\u0003 to the HSS",
};

const OTHER_HIT: EntryHit = { ...HIT, id: "lib_5e6f7a8b", title: "HSS outbox", tags: [{ tag: "Outbox", group: "topics" }], snippet: "" };

const RESULT: SearchResult = {
  entries: [HIT, OTHER_HIT],
  total: 2,
  kinds: [{ kind: "flow", count: 2 }],
  tags: [
    { tag: "S6a", group: "interfaces", count: 1 },
    { tag: "ULR/ULA", group: "messages", count: 1 },
    { tag: "Outbox", group: "topics", count: 1 },
  ],
};

function settle() {
  return act(() => new Promise((resolve) => setTimeout(resolve, 50)));
}

async function load() {
  return loadPluginApp(() => import("./app"));
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true });
});
afterEach(cleanup);

describe("Library app", () => {
  it("registers its page, side panel, overlay, message action, and command", async () => {
    const app = await load();
    expect(app.navPanels.map((panel) => panel.path)).toEqual(["library"]);
    expect(app.threadPanelActions.map((action) => action.id)).toEqual(["library"]);
    expect(app.appOverlays.map((overlay) => overlay.id)).toEqual(["save-dialog"]);
    expect(app.messageActions.map((action) => action.title)).toEqual(["Save to Library"]);
  });

  it("lists search results with highlights and opens an entry", async () => {
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: { search: () => RESULT } });
    const row = await slot.findByText("S6a attach: ULR/ULA");
    expect((await slot.findByText("ULR", { selector: "mark" })).tagName).toBe("MARK");
    fireEvent.click(row);
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "library", options: { subPath: "lib_1a2b3c4d", replace: true } }]);
  });

  it("filters by tags chosen from a group menu", async () => {
    const app = await load();
    const searches: Array<{ tags: string[] }> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: {
        search: (input: unknown) => {
          searches.push(input as { tags: string[] });
          return RESULT;
        },
      },
    });
    const filters = await slot.findByRole("group", { name: "Filter by tag" });
    const pills = within(filters).getAllByRole("button");
    expect(pills.map((pill) => pill.getAttribute("aria-label"))).toEqual(["Interfaces, 1 tag", "Messages, 1 tag", "Topics, 1 tag"]);

    fireEvent.keyDown(pills[0]!, { key: "Enter" });
    const option = await slot.findByRole("menuitemcheckbox", { name: /S6a/ });
    expect(option.textContent).toContain("MME ↔ HSS");
    fireEvent.click(option);

    await settle();
    expect(searches.at(-1)?.tags).toEqual(["S6a"]);
    expect(option.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(option, { key: "Escape" });
    await settle();
    expect(within(await slot.findByRole("group", { name: "Selected tags" })).getByText("S6a")).toBeTruthy();
    expect(await slot.findByRole("button", { name: "Interfaces, 1 tag, 1 selected" })).toBeTruthy();
  });

  it("filters the Library by a tag picked from an entry's group menu", async () => {
    const app = await load();
    const searches: Array<{ tags: string[] }> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: HIT.id }, {
      rpc: {
        search: (input: unknown) => {
          searches.push(input as { tags: string[] });
          return RESULT;
        },
        entry: () => ({ ...HIT, body: "The MME sends ULR to the HSS." }) satisfies Entry,
      },
    });
    const tags = await slot.findByRole("group", { name: "Tags" });
    const interfaces = within(tags).getByRole("button", { name: "Interfaces: S6a" });
    expect(interfaces.getAttribute("title")).toBe("S6a");

    fireEvent.keyDown(interfaces, { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitem", { name: /S6a/ }));
    await settle();
    expect(searches.at(-1)?.tags).toEqual(["S6a"]);
  });

  it("saves a chat message through the dialog with detected and hand-grouped tags", async () => {
    const app = await load();
    const saved: unknown[] = [];
    const overlay = renderSlot(app.appOverlays[0]!, {}, {
      rpc: {
        catalog: () => ({ tags: [] }),
        save: (input: unknown) => {
          saved.push(input);
          const { title, body } = input as Pick<Entry, "title" | "body">;
          return { ...HIT, title, body } satisfies Entry;
        },
      },
    });
    const message = {
      id: "msg_1",
      threadId: "thr_1",
      role: "assistant" as const,
      text: "## Gx session setup\n\nThe PCEF sends CCR-I over Gx to the PCRF.",
      sourceSeqEnd: 1,
    };
    await act(async () => {
      await app.messageActions[0]!.run({ threadId: "thr_1", message, openPanel: () => false, composer: null });
    });
    expect(await overlay.findByDisplayValue("Gx session setup")).toBeTruthy();

    const addTag = await overlay.findByLabelText("Add tag");
    const group = (await overlay.findByLabelText("Group for the new tag")) as HTMLSelectElement;
    fireEvent.change(addTag, { target: { value: "s6a" } });
    expect(group.disabled).toBe(true);
    fireEvent.change(addTag, { target: { value: "Outbox" } });
    fireEvent.change(group, { target: { value: "components" } });
    fireEvent.keyDown(addTag, { key: "Enter" });

    fireEvent.click(await overlay.findByRole("button", { name: "Save" }));
    await act(async () => {});
    expect(saved).toEqual([
      {
        title: "Gx session setup",
        kind: "explanation",
        summary: "",
        body: message.text,
        tags: [
          { tag: "Gx", group: "interfaces" },
          { tag: "CCR/CCA", group: "messages" },
          { tag: "PCRF", group: "functions" },
          { tag: "Outbox", group: "components" },
        ],
        threadId: "thr_1",
        messageId: "msg_1",
      },
    ]);
  });

  it("reopens the last entry and keeps the search when you come back", async () => {
    const app = await load();
    const rpc = { search: () => RESULT, entry: () => ({ ...HIT, body: "The MME sends ULR to the HSS." }) satisfies Entry };
    const first = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc });
    fireEvent.change(await first.findByLabelText("Search the Library"), { target: { value: "regis" } });
    fireEvent.click(await first.findByText("S6a attach: ULR/ULA"));
    first.lifecycle.unmount();

    const back = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc });
    expect(await back.findByRole("heading", { name: "S6a attach: ULR/ULA" })).toBeTruthy();
    expect((back.getByLabelText("Search the Library") as HTMLInputElement).value).toBe("regis");
    expect(back.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "library", options: { subPath: HIT.id, replace: true } }]);
  });

  it("forgets a remembered entry that was deleted", async () => {
    window.localStorage.setItem("test-plugin:last-entry", JSON.stringify("lib_deadbeef"));
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "lib_deadbeef" }, { rpc: { search: () => RESULT, entry: () => null } });
    await settle();
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "library", options: { subPath: "", replace: true } }]);
    expect(window.localStorage.getItem("test-plugin:last-entry")).toBe("null");
  });

  it("toggles to the last entry, and back when the Library is showing", async () => {
    window.localStorage.setItem("test-plugin:last-entry", JSON.stringify(HIT.id));
    const app = await load();
    const overlay = renderSlot(app.appOverlays[0]!, {}, {});
    act(() => {
      toggleRequests.emit(null);
    });
    expect(overlay.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "library", options: { subPath: HIT.id } }]);

    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    window.history.pushState({}, "", "/plugins/test-plugin/library");
    const release = markLibraryVisible();
    act(() => {
      toggleRequests.emit(null);
    });
    release();
    expect(back).toHaveBeenCalledOnce();
    expect(overlay.inspection.navigateCalls).toHaveLength(1);
    back.mockRestore();
  });
});
