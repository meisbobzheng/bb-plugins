import { describe, expect, it } from "vitest";
import type { ShuffleOptions } from "./contract";
import { applyVibeOrder, planShuffle, seededRandom, spread, type Candidate } from "./shuffle";
import { track } from "./test/fake-spotify";

const now = Date.UTC(2026, 9, 22);
const day = 86_400_000;
const base: ShuffleOptions = { sourceId: "p", spread: false, fresh: false, freshDays: 30, noSkips: false, vibe: null };

const candidate = (id: string, artist: string, history: Candidate["history"] = null, album = `al-${id}`): Candidate => ({ track: track(id, { artist, albumId: album }), history });

describe("spread", () => {
  it("keeps an artist from playing twice in a row when it can", () => {
    const order = spread(
      ["a1", "a2", "a3", "b1", "c1", "b2", "d1"].map((id) => candidate(id, id[0]!)),
      (entry) => entry.track,
    );
    const artists = order.map((entry) => entry.track.artists[0]!.name);
    for (let index = 1; index < artists.length - 1; index += 1) expect(artists[index]).not.toBe(artists[index - 1]);
  });

  it("interleaves an artist who fills half the list instead of saving them for the end", () => {
    const order = spread(
      [candidate("o1", "o1"), candidate("o2", "o2"), candidate("o3", "o3"), candidate("e1", "e"), candidate("e2", "e"), candidate("e3", "e")],
      (entry) => entry.track,
    );
    expect(order.map((entry) => entry.track.id)).toEqual(["o1", "e1", "o2", "e2", "o3", "e3"]);
  });

  it("separates two songs from one album", () => {
    const order = spread([candidate("x", "x", null, "same"), candidate("y", "y", null, "same"), candidate("z", "z")], (entry) => entry.track);
    expect(order.map((entry) => entry.track.id)).toEqual(["x", "z", "y"]);
  });
});

describe("planShuffle", () => {
  it("drops songs you usually skip", () => {
    const plan = planShuffle(
      [candidate("keep", "k", { plays: 5, skips: 1, lastPlayedAt: now - day }), candidate("skip", "s", { plays: 4, skips: 3, lastPlayedAt: now - day }), candidate("new", "n")],
      { ...base, noSkips: true },
      now,
      seededRandom(7),
    );
    expect(plan.tracks.map((entry) => entry.track.id).sort()).toEqual(["keep", "new"]);
    expect(plan.dropped).toBe(1);
  });

  it("favors songs you have not heard lately and says why", () => {
    const stale = Array.from({ length: 20 }, (_, index) => candidate(`old${index}`, `o${index}`, { plays: 2, skips: 0, lastPlayedAt: now - 90 * day }));
    const recent = Array.from({ length: 20 }, (_, index) => candidate(`hot${index}`, `h${index}`, { plays: 9, skips: 0, lastPlayedAt: now - day / 2 }));
    const plan = planShuffle([...recent, ...stale], { ...base, fresh: true }, now, seededRandom(42));
    const firstTen = plan.tracks.slice(0, 10).map((entry) => entry.track.id);
    expect(firstTen.filter((id) => id.startsWith("old")).length).toBeGreaterThanOrEqual(8);
    expect(plan.tracks.find((entry) => entry.track.id === "old0")!.reason).toBe("unheard for 90 days");
    expect(plan.tracks.find((entry) => entry.track.id === "hot0")!.reason).toBeNull();
  });

  it("removes duplicate songs and caps the session at 100", () => {
    const many = Array.from({ length: 150 }, (_, index) => candidate(`t${index % 120}`, `a${index}`));
    const plan = planShuffle(many, base, now, seededRandom(1));
    expect(plan.tracks).toHaveLength(100);
    expect(new Set(plan.tracks.map((entry) => entry.track.id)).size).toBe(100);
  });
});

describe("applyVibeOrder", () => {
  it("follows Claude's order, ignores repeats and unknown numbers, and keeps notes", () => {
    const pool = ["a", "b", "c"].map((id) => candidate(id, id));
    const planned = applyVibeOrder(
      pool,
      [
        { index: 2, note: "mellow opener" },
        { index: 2, note: "again" },
        { index: 9, note: "missing" },
        { index: 0, note: "the peak" },
      ],
      base,
    );
    expect(planned.map((entry) => [entry.track.id, entry.reason])).toEqual([
      ["c", "mellow opener"],
      ["a", "the peak"],
    ]);
  });
});
