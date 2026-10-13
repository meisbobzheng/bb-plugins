// @vitest-environment jsdom
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Entry, EntryHit, SearchResult } from "./contract";

const HIT: EntryHit = {
  id: "lib_1a2b3c4d",
  title: "S6a attach: ULR/ULA",
  kind: "flow",
  summary: "",
  tags: ["S6a", "ULR/ULA"],
  source: { threadId: "thr_1", threadTitle: "Debug attach", messageId: null },
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  snippet: "the MME sends \u0002ULR\u0003 to the HSS",
};

const RESULT: SearchResult = { entries: [HIT], total: 1, kinds: [{ kind: "flow", count: 1 }], tags: [{ tag: "S6a", count: 1 }] };

async function load() {
  return loadPluginApp(() => import("./app"));
}

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
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "library", options: { subPath: "lib_1a2b3c4d" } }]);
  });

  it("saves a chat message through the dialog with detected tags", async () => {
    const app = await load();
    const saved: unknown[] = [];
    const overlay = renderSlot(app.appOverlays[0]!, {}, {
      rpc: {
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
    fireEvent.click(await overlay.findByRole("button", { name: "Save" }));
    await act(async () => {});
    expect(saved).toEqual([
      {
        title: "Gx session setup",
        kind: "explanation",
        summary: "",
        body: message.text,
        tags: ["Gx", "CCR/CCA"],
        threadId: "thr_1",
        messageId: "msg_1",
      },
    ]);
  });
});
