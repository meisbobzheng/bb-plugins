import { describe, expect, it } from "vitest";
import type { Element, Point } from "../model";
import { elementBox, hitTest, simplify, translate } from "./geometry";

function pen(points: Point[], width = 2): Element {
  return { id: "p", type: "pen", points, color: "ink", width };
}

describe("simplify", () => {
  it("drops points within tolerance of the stroke and keeps corners", () => {
    const points: Point[] = [[0, 0], [10, 0.2], [20, -0.2], [30, 0], [30, 10], [30.3, 20], [30, 30]];
    expect(simplify(points, 0.75)).toEqual([[0, 0], [30, 0], [30, 30]]);
  });

  it("keeps strokes that are too short to simplify", () => {
    expect(simplify([[4, 4]], 0.75)).toEqual([[4, 4]]);
    expect(simplify([[0, 0], [5, 5]], 0.75)).toEqual([[0, 0], [5, 5]]);
  });

  it("keeps a closed loop's shape", () => {
    const loop: Point[] = Array.from({ length: 400 }, (_, step) => {
      const angle = (step / 399) * Math.PI * 2;
      return [Math.cos(angle) * 100, Math.sin(angle) * 100];
    });
    const simplified = simplify(loop, 0.75);
    expect(simplified.length).toBeLessThan(loop.length / 4);
    expect(simplified[0]).toEqual(loop[0]);
    expect(simplified.at(-1)).toEqual(loop.at(-1));
    expect(elementBox(pen(simplified)).w).toBeCloseTo(200, 0);
  });
});

describe("hitTest", () => {
  it("hits strokes within tolerance plus half their width", () => {
    const stroke = pen([[0, 0], [100, 0]], 8);
    expect(hitTest(stroke, [50, 9], 6)).toBe(true);
    expect(hitTest(stroke, [50, 11], 6)).toBe(false);
    expect(hitTest(stroke, [-9, 0], 6)).toBe(true);
    expect(hitTest(stroke, [500, 500], 6)).toBe(false);
  });

  it("hits filled outlines inside and near their edges", () => {
    const polygon: Element = { id: "g", type: "polygon", points: [[0, 0], [100, 0], [50, 80]], color: "ink", width: 2, fill: false };
    expect(hitTest(polygon, [50, 30], 4)).toBe(true);
    expect(hitTest(polygon, [50, 84], 4)).toBe(true);
    expect(hitTest(polygon, [5, 70], 4)).toBe(false);
    const ellipse: Element = { id: "e", type: "shape", kind: "ellipse", x: 0, y: 0, w: 100, h: 50, color: "ink", width: 2, fill: false };
    expect(hitTest(ellipse, [50, 25], 4)).toBe(true);
    expect(hitTest(ellipse, [2, 2], 4)).toBe(false);
  });
});

describe("elementBox", () => {
  it("reuses the box for an unchanged element and recomputes it after an edit", () => {
    const stroke = pen([[0, 0], [10, 20]]);
    expect(elementBox(stroke)).toBe(elementBox(stroke));
    expect(elementBox(translate(stroke, 5, 5))).toEqual({ x: 5, y: 5, w: 10, h: 20 });
  });
});
