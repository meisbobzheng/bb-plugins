import { existsSync } from "node:fs";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import type { Element } from "./model";
import plugin from "./server";

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "scratchpad" });
  await plugin(bb);
  const call = <T>(method: string, input?: unknown) =>
    harness.behavior.callRpc(method, input) as Promise<T>;
  const mentions = harness.registrations.mentionProviders.find((provider) => provider.id === "board")!;
  return { harness, call, mentions };
}

const elements: Element[] = [
  { id: "a", type: "note", x: 0, y: 0, w: 200, h: 150, text: "Ingest events", color: "yellow" },
  { id: "b", type: "shape", kind: "rect", x: 400, y: 0, w: 160, h: 100, color: "blue", width: 2, fill: false },
  { id: "c", type: "text", x: 420, y: 20, text: "Queue", color: "ink", size: 18 },
  { id: "d", type: "line", points: [[200, 75], [400, 50]], arrow: true, color: "ink", width: 2 },
  { id: "e", type: "pen", points: [[0, 300], [10, 310], [20, 300]], color: "red", width: 4 },
];

describe("scratchpad server", () => {
  it("creates a default board on first list", async () => {
    const { call } = await setup();
    const { boards } = await call<{ boards: { name: string }[] }>("boards_list", null);
    expect(boards.map((board) => board.name)).toEqual(["Scratchpad"]);
  });

  it("round-trips board content and publishes changes", async () => {
    const { call, harness } = await setup();
    const board = await call<{ id: string }>("board_create", { name: "Design" });
    await call("board_save", { id: board.id, elements, snapshot: null, clientId: "c1" });
    const { board: loaded } = await call<{ board: { elements: Element[]; elementCount: number } }>(
      "board_get",
      { id: board.id },
    );
    expect(loaded.elements).toEqual(elements);
    expect(loaded.elementCount).toBe(elements.length);
    expect(harness.realtimeSignals.at(-1)?.payload).toEqual({ boardId: board.id, clientId: "c1" });
  });

  it("rejects malformed elements at the boundary", async () => {
    const { call } = await setup();
    const board = await call<{ id: string }>("board_create", { name: "Bad" });
    await expect(
      call("board_save", {
        id: board.id,
        elements: [{ id: "x", type: "shape", kind: "star" }],
        snapshot: null,
        clientId: "c1",
      }),
    ).rejects.toThrow();
  });

  it("renames and deletes boards", async () => {
    const { call } = await setup();
    const board = await call<{ id: string }>("board_create", { name: "Old" });
    const renamed = await call<{ name: string }>("board_rename", { id: board.id, name: "  New  " });
    expect(renamed.name).toBe("New");
    expect(await call("board_delete", { id: board.id })).toEqual({ deleted: true });
    expect(await call("board_get", { id: board.id })).toEqual({ board: null });
  });

  it("finds boards by name and resolves them into agent context with a rendering", async () => {
    const { call, mentions } = await setup();
    const board = await call<{ id: string }>("board_create", { name: "Pipeline sketch" });
    await call("board_create", { name: "Groceries" });
    await call("board_save", { id: board.id, elements, snapshot: PIXEL_PNG, clientId: "c1" });

    const items = await mentions.search({ trigger: "@", query: "pipe", projectId: null, threadId: null });
    expect(items.map((item) => item.title)).toEqual(["Pipeline sketch"]);

    const resolved = await mentions.resolve(board.id);
    expect(resolved.context).toContain('Scratchpad board "Pipeline sketch"');
    expect(resolved.context).toContain("> Ingest events");
    expect(resolved.context).toContain('"Ingest events" → rectangle "Queue"');
    expect(resolved.context).toContain("1 rectangle, 1 arrow, 1 freehand stroke");
    const image = resolved.experimental_images?.[0];
    expect(image?.type).toBe("localImage");
    expect(image?.type === "localImage" && existsSync(image.path)).toBe(true);
  });

  it("blocks sending a mention of a deleted board", async () => {
    const { mentions } = await setup();
    await expect(Promise.resolve().then(() => mentions.resolve("missing"))).rejects.toThrow(/no longer exists/);
  });
});
