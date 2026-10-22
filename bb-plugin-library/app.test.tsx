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
  Element.prototype.scrollIntoView = () => {};
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

  it("shows truncated titles in full on hover, and when an entry last changed", async () => {
    const app = await load();
    const entry = { ...HIT, updatedAt: "2026-10-02T10:00:00.000Z", body: "x" } satisfies Entry;
    const slot = renderSlot(app.navPanels[0]!, { subPath: HIT.id }, { rpc: { search: () => RESULT, entry: () => entry } });
    expect(await slot.findByText(/^· Updated /)).toBeTruthy();
    expect(slot.getByText(HIT.title, { selector: "span" }).getAttribute("title")).toBe(HIT.title);
    expect(slot.getByRole("button", { name: "from “Debug attach”" }).getAttribute("title")).toBe("Debug attach");
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

  it("shows the last visit's entry and results at once while it refreshes them", async () => {
    const app = await load();
    const first = renderSlot(app.navPanels[0]!, { subPath: HIT.id }, { rpc: { search: () => RESULT, entry: () => ({ ...HIT, body: "x" }) satisfies Entry } });
    expect(await first.findByRole("heading", { name: HIT.title })).toBeTruthy();
    expect(await first.findByText("2 entries")).toBeTruthy();
    first.lifecycle.unmount();

    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const pending = () => new Promise<never>(() => {});
    const back = renderSlot(app.navPanels[0]!, { subPath: HIT.id }, { rpc: { search: pending, entry: pending } });
    expect(back.getByRole("heading", { name: HIT.title })).toBeTruthy();
    expect(back.getByText("2 entries")).toBeTruthy();
    expect(scrolled.mock.contexts).toEqual([back.getByText(HIT.title, { selector: "span" }).closest("button")]);
    scrolled.mockRestore();
  });

  it("forgets a remembered entry that was deleted", async () => {
    window.localStorage.setItem("test-plugin:last-entry", JSON.stringify("lib_deadbeef"));
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "lib_deadbeef" }, { rpc: { search: () => RESULT, entry: () => null } });
    await settle();
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "library", options: { subPath: "", replace: true } }]);
    expect(window.localStorage.getItem("test-plugin:last-entry")).toBe("null");
  });

  it("offers a retry when search fails", async () => {
    const app = await load();
    let calls = 0;
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: {
        search: async () => {
          calls += 1;
          if (calls === 1) throw new Error("Library is restarting");
          return RESULT;
        },
      },
    });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toContain("Could not search the Library.");
    expect(alert.textContent).toContain("Library is restarting");

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await slot.findByText("S6a attach: ULR/ULA")).toBeTruthy();
  });

  it("keeps an entry that failed to load and retries it", async () => {
    const id = "lib_0badc0de";
    window.localStorage.setItem("test-plugin:last-entry", JSON.stringify(id));
    const app = await load();
    let calls = 0;
    const slot = renderSlot(app.navPanels[0]!, { subPath: id }, {
      rpc: {
        search: () => RESULT,
        entry: async () => {
          calls += 1;
          if (calls === 1) throw new Error("Library is restarting");
          return { ...HIT, id, title: "Retried entry", body: "Back again." } satisfies Entry;
        },
      },
    });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toContain("Could not open this entry.");
    expect(slot.inspection.navigateCalls).toEqual([]);
    expect(window.localStorage.getItem("test-plugin:last-entry")).toBe(JSON.stringify(id));

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await slot.findByRole("heading", { name: "Retried entry" })).toBeTruthy();
  });

  it("closes the editor with Escape only while nothing has changed", async () => {
    const app = await load();
    const slot = renderSlot(app.navPanels[0]!, { subPath: HIT.id }, { rpc: { search: () => RESULT, entry: () => ({ ...HIT, body: "x" }) satisfies Entry } });
    fireEvent.click(await slot.findByRole("button", { name: "Edit" }));
    fireEvent.keyDown(slot.getByLabelText("Title"), { key: "Escape" });
    expect(await slot.findByRole("heading", { name: HIT.title })).toBeTruthy();

    fireEvent.click(slot.getByRole("button", { name: "Edit" }));
    const title = slot.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "S6a attach, revised" } });
    fireEvent.keyDown(title, { key: "Escape" });
    expect((slot.getByLabelText("Title") as HTMLInputElement).value).toBe("S6a attach, revised");

    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
    expect(await slot.findByRole("heading", { name: HIT.title })).toBeTruthy();
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

  describe("export", () => {
    const ENTRY: Entry = { ...HIT, body: "The MME sends ULR to the HSS." };

    async function openExport() {
      const app = await load();
      const slot = renderSlot(app.navPanels[0]!, { subPath: HIT.id }, { rpc: { search: () => RESULT, entry: () => ENTRY } });
      fireEvent.keyDown(await slot.findByRole("button", { name: /Export/ }), { key: "Enter" });
      return slot;
    }

    afterEach(() => {
      Reflect.deleteProperty(window, "showSaveFilePicker");
      vi.restoreAllMocks();
    });

    it("saves Markdown where you choose", async () => {
      const written: Blob[] = [];
      const picker = vi.fn(async () => ({
        name: "attach.md",
        createWritable: async () => ({ write: async (blob: Blob) => void written.push(blob), close: async () => {} }),
      }));
      Object.defineProperty(window, "showSaveFilePicker", { value: picker, configurable: true });

      const slot = await openExport();
      fireEvent.click(await slot.findByRole("menuitem", { name: /Markdown/ }));
      await settle();

      expect(picker).toHaveBeenCalledWith({
        suggestedName: "S6a attach - ULR-ULA.md",
        types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
      });
      expect(await written[0]!.text()).toMatch(/^---\ntitle: "S6a attach: ULR\/ULA"\n[\s\S]*The MME sends ULR to the HSS\.\n$/);
    });

    it("downloads HTML when the save dialog is unavailable", async () => {
      const blobs: Blob[] = [];
      Object.defineProperty(URL, "createObjectURL", { value: (blob: Blob) => (blobs.push(blob), "blob:export"), configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, configurable: true });
      const names: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });

      const slot = await openExport();
      fireEvent.click(await slot.findByRole("menuitem", { name: /HTML/ }));
      await settle();

      expect(names).toEqual(["S6a attach - ULR-ULA.html"]);
      const page = await blobs[0]!.text();
      expect(page).toContain("<title>S6a attach: ULR/ULA</title>");
      expect(page).toContain("<p>The MME sends ULR to the HSS.</p>");
    });

    it("prints a PDF of just the entry and cleans up afterwards", async () => {
      const seen: Array<{ title: string; text: string | null }> = [];
      window.print = vi.fn(() => {
        seen.push({ title: document.title, text: document.getElementById("library-print")?.textContent ?? null });
        window.dispatchEvent(new Event("afterprint"));
      });
      document.title = "bb";

      const slot = await openExport();
      fireEvent.click(await slot.findByRole("menuitem", { name: /PDF/ }));
      await settle();

      expect(seen).toHaveLength(1);
      expect(seen[0]!.title).toBe("S6a attach: ULR/ULA");
      expect(seen[0]!.text).toContain("The MME sends ULR to the HSS.");
      expect(document.getElementById("library-print")).toBeNull();
      expect(document.title).toBe("bb");
    });
  });
});
