import { describe, expect, it } from "vitest";
import { IDLE_DUCK, type Playlist } from "../../../contract";
import { plot, rng, strokes } from "./pencil";
import { duckLine, fractionAt, layoutFor, nextDays, ordered, playlistMeta, revision, stamp, tagFor, vibeEnds, weekBars } from "./sheet";

const list = (id: string, name: string, readable = true): Playlist => ({
  id,
  uri: `spotify:playlist:${id}`,
  name,
  owner: readable ? "you" : "Spotify",
  ownedByMe: readable,
  collaborative: false,
  readable,
  trackCount: 12,
  imageUrl: null,
  url: null,
  kind: "playlist",
});

describe("freehand strokes", () => {
  it("draws the same element the same way until its size changes", () => {
    expect(strokes("box", 120, 40, "search")).toEqual(strokes("box", 120, 40, "search"));
    expect(strokes("box", 121, 40, "search")).not.toEqual(strokes("box", 120, 40, "search"));
    expect(strokes("box", 120, 40, "a")).not.toEqual(strokes("box", 120, 40, "b"));
  });

  it("doubles boxes and circles, and skips unmeasured elements", () => {
    expect(strokes("box", 80, 20)).toHaveLength(2);
    expect(strokes("circle", 30, 30)).toHaveLength(2);
    expect(strokes("cloud", 200, 30)).toHaveLength(1);
    expect(strokes("box", 0, 20)).toEqual([]);
    for (const path of strokes("box", 80, 20)) expect(path.match(/M/g)).toHaveLength(4);
  });

  it("keeps the jitter close to the outline", () => {
    for (const path of [...strokes("box", 100, 30, "x"), ...strokes("under", 100, 30, "x")]) {
      const numbers = path.match(/-?\d+\.\d/g)!.map(Number);
      for (const value of numbers) expect(value).toBeGreaterThan(-6), expect(value).toBeLessThan(106);
    }
  });

  it("seeds a repeatable random stream", () => {
    const [a, b] = [rng(7), rng(7)];
    const values = Array.from({ length: 5 }, () => a());
    expect(values).toEqual(Array.from({ length: 5 }, () => b()));
    for (const value of values) expect(value).toBeGreaterThanOrEqual(0), expect(value).toBeLessThan(1);
  });
});

describe("up-next plot", () => {
  it("places one dot per pick, rising toward the right when there is a vibe", () => {
    const rising = plot(5, true);
    expect(rising.dots).toHaveLength(5);
    expect(rising.dots[4]![0]).toBeGreaterThan(rising.dots[0]![0]);
    expect(rising.dots[4]![1]).toBeLessThan(rising.dots[0]![1]);
    expect(plot(0, true).dots).toEqual([]);
    expect(plot(40, false).dots).toHaveLength(6);
  });

  it("labels the arc from the vibe", () => {
    expect(vibeEnds("start mellow, end euphoric")).toEqual(["mellow", "euphoric"]);
    expect(vibeEnds("Begin with ambient and finish on techno")).toEqual(["ambient", "techno"]);
    expect(vibeEnds("calm → loud")).toEqual(["calm", "loud"]);
    expect(vibeEnds("rainy day jazz")).toEqual(["now", "later"]);
    expect(vibeEnds(null)).toEqual(["now", "later"]);
  });
});

describe("sheet helpers", () => {
  it("picks a layout from the measured size, full when unmeasured", () => {
    expect(layoutFor({ width: 0, height: 0 })).toBe("full");
    expect(layoutFor({ width: 1040, height: 680 })).toBe("full");
    expect(layoutFor({ width: 1040, height: 400 })).toBe("compact");
    expect(layoutFor({ width: 620, height: 400 })).toBe("compact");
    expect(layoutFor({ width: 420, height: 340 })).toBe("tight");
  });

  it("tags smart shuffle reasons", () => {
    expect(tagFor(null, true)).toBeNull();
    expect(tagFor("unheard for 41 days", true)).toBe("fresh");
    expect(tagFor("new to you", false)).toBe("fresh");
    expect(tagFor("a gentle step up", true)).toBe("vibe");
    expect(tagFor("different artist", false)).toBe("spread");
  });

  it("writes the duck note", () => {
    expect(duckLine(IDLE_DUCK)).toBeNull();
    expect(duckLine({ active: true, mode: "lower", threads: [{ id: "a", title: "fix auth flake" }] })).toBe("♪ lowered · thread 'fix auth flake' needs you");
    expect(duckLine({ active: true, mode: "pause", threads: [] })).toBe("♪ paused · an agent needs you");
    expect(duckLine({ active: true, mode: "lower", threads: ["a", "b", "c"].map((id) => ({ id, title: id })) })).toBe("♪ lowered · 'a', 'b' +1 need you");
  });

  it("steps the fresh window and wraps around", () => {
    expect(nextDays(30)).toBe(60);
    expect(nextDays(45)).toBe(60);
    expect(nextDays(365)).toBe(7);
  });

  it("stamps the title block", () => {
    expect(stamp(new Date(2026, 9, 6))).toBe("06.10.26");
    expect(revision("blueprint", ["graphite", "blueprint", "highlighter"])).toBe("B");
    expect(revision("nope", ["graphite"])).toBe("A");
  });

  it("starts the week on monday and clamps seeking", () => {
    expect(weekBars([0, 1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(fractionAt(150, 100, 200)).toBe(0.25);
    expect(fractionAt(0, 100, 200)).toBe(0);
    expect(fractionAt(900, 100, 200)).toBe(1);
    expect(fractionAt(5, 0, 0)).toBe(0);
  });

  it("filters playlists and lists followed ones last", () => {
    const all = [list("a", "Lo-fi Beats", false), list("b", "Deep Work"), list("c", "Late Night Drive")];
    expect(ordered(all, "").map((entry) => entry.id)).toEqual(["b", "c", "a"]);
    expect(ordered(all, " l").map((entry) => entry.id)).toEqual(["c", "a"]);
    expect(ordered(null, "x")).toEqual([]);
    expect(playlistMeta(all[0]!)).toBe("playlist · followed · play only · 12 tracks");
    expect(playlistMeta(all[1]!)).toBe("playlist · by you · 12 tracks");
  });
});
