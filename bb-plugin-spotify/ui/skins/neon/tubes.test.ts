import { describe, expect, it } from "vitest";
import { capFor, fitSize, flickerAt, igniteDelay, layoutFor, nextDays, tagFor } from "./tubes";

describe("layout", () => {
  it("falls back to the full panel when unmeasured", () => {
    expect(layoutFor({ width: 0, height: 0 })).toBe("full");
  });

  it("folds into tabs when short or narrow", () => {
    expect(layoutFor({ width: 1040, height: 680 })).toBe("full");
    expect(layoutFor({ width: 1300, height: 900 })).toBe("full");
    expect(layoutFor({ width: 1040, height: 520 })).toBe("compact");
    expect(layoutFor({ width: 620, height: 400 })).toBe("compact");
    expect(layoutFor({ width: 920, height: 900 })).toBe("compact");
    expect(layoutFor({ width: 420, height: 340 })).toBe("tight");
  });
});

describe("the title sign", () => {
  it("puts the failing tube on the first letter of the last word", () => {
    expect(flickerAt("Let It Happen")).toBe(7);
    expect(flickerAt("Kerala")).toBe(1);
    expect(flickerAt("A")).toBe(0);
  });

  it("lights letters in a scattered but steady order", () => {
    expect(igniteDelay(0)).toBe(0);
    expect(igniteDelay(3)).toBe(igniteDelay(3));
    expect(new Set([0, 1, 2, 3, 4].map(igniteDelay)).size).toBe(5);
  });

  it("shrinks to fit, then wraps below the floor", () => {
    expect(fitSize(42, 300, 400)).toEqual({ size: 42, wrap: false });
    expect(fitSize(42, 600, 400)).toEqual({ size: 28, wrap: false });
    expect(fitSize(42, 1200, 400)).toEqual({ size: 23, wrap: true });
    expect(fitSize(42, 500, 0)).toEqual({ size: 42, wrap: false });
  });
});

describe("smart shuffle", () => {
  it("tags reasons by what they mean", () => {
    expect(tagFor(null, true)).toBeNull();
    expect(tagFor("unheard for 41 days", true)).toBe("fresh");
    expect(tagFor("new to you", false)).toBe("fresh");
    expect(tagFor("a gentle step up", true)).toBe("vibe");
    expect(tagFor("different artist", false)).toBe("spread");
  });

  it("cycles the fresh window through presets", () => {
    expect(nextDays(7)).toBe(14);
    expect(nextDays(30)).toBe(60);
    expect(nextDays(45)).toBe(60);
    expect(nextDays(90)).toBe(7);
    expect(nextDays(365)).toBe(7);
  });
});

describe("keycaps", () => {
  it("maps pressed keys to the cap that lights", () => {
    expect(capFor(" ")).toBe("space");
    expect(capFor("=")).toBe("− +");
    expect(capFor("ArrowLeft")).toBe("← →");
    expect(capFor("3")).toBe("1–4");
    expect(capFor("R")).toBe("R");
    expect(capFor("Shift")).toBeNull();
  });
});
