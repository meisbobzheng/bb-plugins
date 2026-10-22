import { describe, expect, it } from "vitest";
import { LIKED_ID, type Playlist } from "../../../contract";
import { DEFAULT_SHUFFLE } from "../../model";
import { bandSize, knobOf, knobPatch, needleAt, stationsOf, stepDays, wrap } from "./dial";

const playlist = (id: string, readable = true): Playlist => ({
  id,
  uri: `spotify:playlist:${id}`,
  name: id,
  owner: "you",
  ownedByMe: readable,
  collaborative: false,
  readable,
  trackCount: 1,
  imageUrl: null,
  url: null,
  kind: id === LIKED_ID ? "liked" : "playlist",
});

describe("stations", () => {
  it("puts Liked Songs first and followed playlists last, keeping order otherwise", () => {
    const order = stationsOf([playlist("a"), playlist("followed", false), playlist(LIKED_ID), playlist("b")]).map((entry) => entry.id);
    expect(order).toEqual([LIKED_ID, "a", "b", "followed"]);
    expect(stationsOf(null)).toEqual([]);
  });

  it("balances bands to the dial width", () => {
    expect(bandSize(930, 8)).toBe(8);
    expect(bandSize(930, 30)).toBe(8);
    expect(bandSize(930, 9)).toBe(5);
    expect(bandSize(300, 30)).toBe(3);
    expect(bandSize(3000, 40)).toBe(10);
  });

  it("parks the needle at the edge when the tuned station is on another band", () => {
    expect(needleAt(1, 0, 4)).toBeCloseTo(0.375);
    expect(needleAt(5, 0, 4)).toBe(1);
    expect(needleAt(1, 1, 4)).toBe(0);
    expect(needleAt(-1, 0, 4)).toBe(0);
  });

  it("wraps tuning past either end", () => {
    expect(wrap(-1, 8)).toBe(7);
    expect(wrap(8, 8)).toBe(0);
  });
});

describe("shuffle knob", () => {
  it("round-trips every position through the options", () => {
    for (const mode of ["off", "spread", "fresh", "vibe"] as const) expect(knobOf({ ...DEFAULT_SHUFFLE, ...knobPatch(mode, "slow burn") })).toBe(mode);
  });

  it("steps fresh days through the preset ladder", () => {
    expect(stepDays(30, 1)).toBe(60);
    expect(stepDays(45, -1)).toBe(30);
    expect(stepDays(365, 1)).toBe(365);
    expect(stepDays(7, -1)).toBe(7);
  });
});
