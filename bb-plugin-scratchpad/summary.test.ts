import { describe, expect, it } from "vitest";
import type { Board, Element } from "./model";
import { summarizeBoard } from "./summary";

function board(elements: Element[]): Board {
  return { id: "b1", name: "Pipeline sketch", elementCount: elements.length, updatedAt: "2026-10-15T00:00:00.000Z", elements };
}

describe("summarizeBoard", () => {
  it("describes writing, connections, and drawings", () => {
    const context = summarizeBoard(
      board([
        { id: "a", type: "note", x: 0, y: 0, w: 200, h: 150, text: "Ingest events", color: "yellow" },
        { id: "b", type: "shape", kind: "rect", x: 400, y: 0, w: 160, h: 100, color: "blue", width: 2, fill: false },
        { id: "c", type: "text", x: 420, y: 20, text: "Queue", color: "ink", size: 18 },
        { id: "d", type: "line", points: [[200, 75], [400, 50]], arrow: true, color: "ink", width: 2 },
        { id: "e", type: "pen", points: [[0, 300], [10, 310]], color: "red", width: 4 },
      ]),
      true,
    );
    expect(context).toContain('# Scratchpad board "Pipeline sketch"');
    expect(context).toContain("attached image is a rendering");
    expect(context).toContain("Sticky note at (0, 0):\n  > Ingest events");
    expect(context).toContain('- "Ingest events" → rectangle "Queue"');
    expect(context).toContain("1 rectangle, 1 arrow, 1 freehand stroke");
  });

  it("orders writing top to bottom, then left to right", () => {
    const context = summarizeBoard(
      board([
        { id: "2", type: "text", x: 0, y: 200, text: "second", color: "ink", size: 18 },
        { id: "1b", type: "text", x: 300, y: 0, text: "first-right", color: "ink", size: 18 },
        { id: "1a", type: "text", x: 0, y: 4, text: "first-left", color: "ink", size: 18 },
      ]),
      false,
    );
    const order = ["first-left", "first-right", "second"].map((text) => context.indexOf(text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(context).not.toContain("attached image");
  });

  it("reports an empty board", () => {
    expect(summarizeBoard(board([]), false)).toContain("The board is empty.");
  });
});
