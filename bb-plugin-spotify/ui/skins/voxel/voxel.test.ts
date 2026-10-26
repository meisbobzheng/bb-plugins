import { describe, expect, it } from "vitest";
import { charsFor, clip, coverTones, fitPixels, GLYPHS, headCell, identicon, pixelable, runs, tagFor, textPath, tonePaths, vox, wrapWords } from "./pixels";
import { cityGrid, donut } from "./scene";

describe("bitmap font", () => {
  it("has a 5×7 glyph for every character it claims", () => {
    for (const glyph of Object.values(GLYPHS)) {
      expect(glyph).toHaveLength(7);
      for (const row of glyph) expect(row).toMatch(/^[01]{5}$/);
    }
  });

  it("emits one rectangle per horizontal run", () => {
    expect(runs(["0110", "1001"], 2)).toBe("M2 0h4v2h-4zM0 2h2v2h-2zM6 2h2v2h-2z");
    expect(runs(["000"], 3)).toBe("");
  });

  it("measures text with a 6-pixel advance and folds accents and case", () => {
    expect(textPath("AB", 2)).toMatchObject({ width: 22, height: 14 });
    expect(textPath("é", 1).d).toBe(textPath("E", 1).d);
    expect(pixelable("Let It Happen (2015)")).toBe(true);
    expect(pixelable("夜に駆ける")).toBe(false);
  });
});

describe("fitting titles", () => {
  it("wraps on words and hard-breaks words that are too long", () => {
    expect(wrapWords("Let It Happen", 7)).toEqual(["Let It", "Happen"]);
    expect(wrapWords("Supercalifragilistic", 8)).toEqual(["Supercal", "ifragili", "stic"]);
    expect(wrapWords("", 5)).toEqual([""]);
  });

  it("keeps the biggest scale that fits on one line, then wraps and clips at the smallest", () => {
    expect(fitPixels("KERALA", 300, [3, 2], 2)).toEqual({ scale: 3, lines: ["KERALA"] });
    const long = fitPixels("DELILAH (PULL ME OUT OF THIS)", 200, [3, 2], 2);
    expect(long.scale).toBe(2);
    expect(long.lines).toHaveLength(2);
    for (const line of long.lines) expect(line.length).toBeLessThanOrEqual(charsFor(200, 2));
    const clipped = fitPixels("ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT", 100, [2], 1);
    expect(clipped.lines).toHaveLength(1);
    expect(clipped.lines[0]!.endsWith("...")).toBe(true);
  });

  it("falls back to the largest scale when the width is unknown", () => {
    expect(fitPixels("Anything at all", 0, [3, 2], 2)).toEqual({ scale: 3, lines: ["Anything at all"] });
    expect(clip("short", 10)).toBe("short");
    expect(clip("a long title here", 10)).toBe("a long...");
  });
});

describe("pixel art", () => {
  it("mirrors identicons and keeps them stable", () => {
    const { rows, tone } = identicon("Deep Work");
    expect(identicon("Deep Work")).toEqual({ rows, tone });
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row).toBe([...row].reverse().join(""));
    expect(tone).toBeGreaterThanOrEqual(0);
    expect(tone).toBeLessThan(4);
  });

  it("quantizes cover luma into palette tones and draws the fallback without art", () => {
    const luma = new Float32Array(16 * 16).map((_, index) => (index % 16) / 15);
    const tones = coverTones(luma, 16);
    expect(Math.max(...tones)).toBe(4);
    expect(Math.min(...tones)).toBe(0);
    expect(new Set(coverTones(null, 16)).size).toBeGreaterThan(2);
    expect(tonePaths(tones, 16, 1)).toHaveLength(5);
  });

  it("finds the seek head cell and names the disc", () => {
    expect(headCell(0, 10)).toBe(0);
    expect(headCell(0.55, 10)).toBe(5);
    expect(headCell(1, 10)).toBe(9);
    expect(vox("Currents")).toBe("currents.vox");
    expect(vox("Hurry Up, We're Dreaming")).toBe("hurry-up-we-re.vox");
    expect(vox("")).toBe("disc.vox");
  });

  it("tags smart shuffle reasons like the other looks", () => {
    expect(tagFor("unheard in 41 days", true)).toBe("fresh");
    expect(tagFor("new to you", false)).toBe("fresh");
    expect(tagFor("builds", true)).toBe("vibe");
    expect(tagFor("builds", false)).toBe("spread");
    expect(tagFor(null, true)).toBeNull();
  });
});

describe("scenes", () => {
  it("renders the record as exactly rows × cols characters", () => {
    const render = donut(40, 21);
    const html = render({ tilt: 1, roll: 0.1, spin: 0, pulse: 0, aspect: 0.6 });
    const lines = html.replace(/<[^>]+>/g, "").split("\n");
    expect(lines).toHaveLength(21);
    for (const line of lines) expect(line).toHaveLength(40);
    expect(html).toContain("v-tf");
    expect(render({ tilt: 1, roll: 0.1, spin: 0, pulse: 0, aspect: 0.6 })).toBe(html);
  });

  it("centers the voxel city and fits whole bands", () => {
    const shape = { pitch: 13, width: 10, depth: 3, rows: 6 };
    const grid = cityGrid(480, shape);
    expect(grid.bands).toBeGreaterThan(20);
    const span = grid.bands * 13 - 3 + 5 * grid.step + 6;
    expect(span).toBeLessThanOrEqual(480);
    expect(grid.left).toBe(Math.floor((480 - span) / 2));
    expect(cityGrid(0, shape).bands).toBe(1);
  });
});
