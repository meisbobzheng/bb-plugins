import { describe, expect, it } from "vitest";
import { dialAngle, dialPercent, doodleOf, DOODLES, fillOf, fractionAt, scallop, springs, squash, stepDays, tilt, wobble } from "./stickers";

describe("deterministic stickers", () => {
  it("tilts the same name the same way, within range", () => {
    const names = ["Deep Work", "Liked Songs", "Lo-fi Beats", "90s R&B", ""];
    for (const name of names) {
      expect(tilt(name)).toBe(tilt(name));
      expect(Math.abs(tilt(name))).toBeLessThanOrEqual(2);
      expect(Math.abs(tilt(name, 6))).toBeLessThanOrEqual(6);
    }
    expect(new Set(names.map((name) => tilt(name))).size).toBeGreaterThan(1);
  });

  it("always picks a real doodle and palette color, even for high hashes", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const kind = doodleOf(`playlist ${index}`);
      expect(DOODLES).toContain(kind);
      seen.add(kind);
      expect(fillOf(`playlist ${index}`)).toMatch(/^var\(--(pink|mint|butter|lilac|sky)\)$/);
    }
    expect(seen.size).toBe(DOODLES.length);
  });
});

describe("seeking and the volume dial", () => {
  it("clamps the pointer to the progress pill", () => {
    expect(fractionAt(150, 100, 200)).toBe(0.25);
    expect(fractionAt(50, 100, 200)).toBe(0);
    expect(fractionAt(400, 100, 200)).toBe(1);
    expect(fractionAt(10, 0, 0)).toBe(0);
  });

  it("maps pointer angles onto a 270 degree dial", () => {
    expect(dialPercent(0, -10)).toBe(50);
    expect(dialPercent(10, 0)).toBe(83);
    expect(dialPercent(-10, 0)).toBe(17);
    expect(dialPercent(-1, 10)).toBe(0);
    expect(dialPercent(1, 10)).toBe(100);
    expect(dialAngle(0)).toBe(-135);
    expect(dialAngle(50)).toBe(0);
    expect(dialAngle(140)).toBe(135);
  });
});

describe("fresh days stepper", () => {
  it("steps through friendly day counts and stops at the ends", () => {
    expect(stepDays(30, 1)).toBe(60);
    expect(stepDays(30, -1)).toBe(14);
    expect(stepDays(45, 1)).toBe(60);
    expect(stepDays(45, -1)).toBe(30);
    expect(stepDays(7, -1)).toBe(7);
    expect(stepDays(365, 1)).toBe(365);
  });
});

describe("scalloped badges", () => {
  it("draws one curve per bump and closes the path", () => {
    const path = scallop(12, 40, 6);
    expect(path.startsWith("M50.0 10.0")).toBe(true);
    expect(path.match(/Q/g)).toHaveLength(12);
    expect(path.endsWith("50.0 10.0Z")).toBe(true);
  });
});

describe("jelly springs", () => {
  it("overshoots then settles on the target", () => {
    const state = springs(1);
    const target = new Float32Array([1]);
    let peak = 0;
    for (let step = 0; step < 400; step += 1) {
      wobble(state, target, 1 / 60);
      peak = Math.max(peak, state.position[0]!);
    }
    expect(peak).toBeGreaterThan(1.05);
    expect(state.position[0]).toBeCloseTo(1, 2);
  });

  it("ignores long frame gaps instead of exploding", () => {
    const state = springs(2);
    wobble(state, new Float32Array([1, 0.5]), 5);
    expect(Math.abs(state.position[0]!)).toBeLessThan(2);
  });

  it("stretches thin while rising and squashes wide while falling", () => {
    expect(squash(4)).toBeLessThan(1);
    expect(squash(-4)).toBeGreaterThan(1);
    expect(squash(100)).toBe(0.72);
    expect(squash(-100)).toBe(1.3);
  });
});
