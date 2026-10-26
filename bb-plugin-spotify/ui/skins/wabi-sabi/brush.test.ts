import { describe, expect, it } from "vitest";
import { crack, crackY, deckle, kanji, layoutFor, listened, rgbOf, rng, SEAM_H, SEAM_W, stillWater, tagFor } from "./brush";

describe("brush helpers", () => {
  it("repeats the same strokes for the same seed", () => {
    const [a, b] = [rng(11), rng(11)];
    const first = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("writes counts in kanji", () => {
    expect(kanji(7)).toBe("七");
    expect(kanji(10)).toBe("十");
    expect(kanji(12)).toBe("十二");
    expect(kanji(42)).toBe("四十二");
    expect(kanji(1284)).toBe("千二百八十四");
    expect(kanji(0)).toBe("〇");
  });

  it("runs the crack across the whole seam inside its height", () => {
    const line = crack(21);
    expect(line.points[0]![0]).toBe(0);
    expect(line.points[line.points.length - 1]![0]).toBe(SEAM_W);
    expect(line.points.every(([, y]) => y >= 0 && y <= SEAM_H)).toBe(true);
    expect(line.path.startsWith("M0.0 14.0")).toBe(true);
    expect(crack(21)).toEqual(line);
  });

  it("follows the crack for the gold bead", () => {
    const points: [number, number][] = [
      [0, 10],
      [100, 20],
      [200, 10],
    ];
    expect(crackY(points, 50)).toBe(15);
    expect(crackY(points, 150)).toBe(15);
    expect(crackY(points, 500)).toBe(10);
  });

  it("tears a deckle edge from top to bottom", () => {
    const edge = deckle(5, 10);
    expect(edge.startsWith("polygon(")).toBe(true);
    expect(edge).toContain("100.00%");
    expect(edge.endsWith("100% 100%, 100% 0)")).toBe(true);
  });

  it("reads hex ink as rgb", () => {
    expect(rgbOf("#27231e")).toBe("39,35,30");
    expect(rgbOf("#fff")).toBe("255,255,255");
    expect(rgbOf("oops")).toBe("39,35,30");
  });

  it("chooses layouts from the measured panel", () => {
    expect(layoutFor({ width: 0, height: 0 })).toBe("full");
    expect(layoutFor({ width: 1040, height: 680 })).toBe("full");
    expect(layoutFor({ width: 620, height: 400 })).toBe("compact");
    expect(layoutFor({ width: 1040, height: 400 })).toBe("compact");
    expect(layoutFor({ width: 420, height: 340 })).toBe("tight");
    expect(stillWater({ height: 400 })).toBe(true);
    expect(stillWater({ height: 0 })).toBe(false);
  });

  it("tags reasons like the other looks", () => {
    expect(tagFor(null, true)).toBeNull();
    expect(tagFor("unheard in 30 days", true)).toBe("fresh");
    expect(tagFor("a gentle step up", true)).toBe("vibe");
    expect(tagFor("a gentle step up", false)).toBe("spread");
  });

  it("splits listening time into a number and a word", () => {
    expect(listened(14 * 3_600_000)).toEqual(["14", "h listened"]);
    expect(listened(20 * 60_000)).toEqual(["20", "min listened"]);
  });
});
