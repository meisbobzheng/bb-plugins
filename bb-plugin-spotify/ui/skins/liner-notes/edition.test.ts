import { describe, expect, it } from "vitest";
import { IDLE_DUCK, type Play, type Playlist, type ShuffleSession, type Stats, type Track } from "../../../contract";
import { DEFAULT_SHUFFLE } from "../../model";
import { ago, contents, credits, duckNote, issueLine, listened, nextWindow, peakHour, prose, quoted, roman, runtime, sentence, sessionNote, sides, songs } from "./edition";

const now = Date.UTC(2026, 9, 22, 12);
const day = 86_400_000;

const song = (id: string, seconds: number): Track => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Song ${id}`,
  artists: [{ id: null, name: `Artist ${id}`, uri: null }],
  album: { id: null, uri: null, name: "Album", year: 2015, imageUrl: null },
  durationMs: seconds * 1000,
  url: null,
  explicit: false,
});

const list = (id: string, readable: boolean): Playlist => ({
  id,
  uri: `spotify:playlist:${id}`,
  name: id,
  owner: "you",
  ownedByMe: readable,
  collaborative: false,
  readable,
  trackCount: 3,
  imageUrl: null,
  url: null,
  kind: "playlist",
});

const stats = (patch: Partial<Stats> = {}): Stats => ({
  since: now - 60 * day,
  listenedMs7: 0,
  listenedMs30: 61 * 3_600_000,
  plays30: 0,
  skipRate30: null,
  topArtists: [{ name: "Floating Points", plays: 40, listenedMs: 1 }],
  topTracks: [],
  byHour: Array.from({ length: 24 }, () => 0),
  byWeekday: Array.from({ length: 7 }, () => 0),
  forgotten: [],
  ...patch,
});

describe("sides", () => {
  it("keeps a short list on one side", () => {
    expect(sides([song("a", 100), song("b", 100)]).map((side) => side.label)).toEqual(["A"]);
  });

  it("splits a long list where the running time is closest to half", () => {
    const tracks = [650, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100].map((seconds, index) => song(String(index), seconds));
    const [a, b] = sides(tracks);
    expect(a!.tracks.map((track) => track.id)).toEqual(["0", "1", "2"]);
    expect(b!.tracks).toHaveLength(9);
    expect(a!.durationMs + b!.durationMs).toBe(1750_000);
  });

  it("never leaves a side empty", () => {
    const tracks = [song("long", 5000), ...Array.from({ length: 11 }, (_, index) => song(String(index), 10))];
    expect(sides(tracks).every((side) => side.tracks.length > 0)).toBe(true);
  });
});

describe("contents", () => {
  it("groups yours before followed and filters by name", () => {
    const result = contents([list("Lo-fi", false), list("Deep Work", true), list("Late Night", true)], "l");
    expect(result.yours.map((entry) => entry.id)).toEqual(["Late Night"]);
    expect(result.order.map((entry) => entry.id)).toEqual(["Late Night", "Lo-fi"]);
  });
});

describe("typesetting", () => {
  it("writes roman numerals", () => {
    expect([1, 4, 9, 14, 26, 99].map(roman)).toEqual(["I", "IV", "IX", "XIV", "XXVI", "XCIX"]);
  });

  it("sets the issue line", () => {
    expect(issueLine(new Date(2026, 9, 22))).toBe("Vol. XXVI · No. 295 · Thursday, 22 October 2026");
  });

  it("closes sentences once", () => {
    expect(sentence("Tame Impala")).toBe("Tame Impala.");
    expect(sentence("Fred again..")).toBe("Fred again..");
    expect(quoted("Where Is My Mind?")).toBe("“Where Is My Mind?”");
  });

  it("reads lengths and times", () => {
    expect(runtime(467_000)).toBe("7 min 47 s");
    expect(runtime(42_000)).toBe("42 s");
    expect(listened(61 * 3_600_000)).toBe("61 hours");
    expect(listened(45 * 60_000)).toBe("45 minutes");
    expect(ago(now - 30_000, now)).toBe("just now");
    expect(ago(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3 hr ago");
    expect(ago(now - 3 * day, now)).toBe("3 days ago");
  });

  it("names the busiest hour", () => {
    const byHour = Array.from({ length: 24 }, (_, hour) => (hour === 14 ? 9 : 1));
    expect(peakHour(byHour)).toBe("2 p.m.");
    expect(peakHour(Array.from({ length: 24 }, () => 0))).toBeNull();
  });

  it("counts songs", () => {
    expect([songs(1), songs(1284)]).toEqual(["1 song", "1,284 songs"]);
  });

  it("cycles the freshness window", () => {
    expect(nextWindow(30)).toBe(60);
    expect(nextWindow(365)).toBe(7);
  });
});

describe("credits", () => {
  it("only says what the history can back up", () => {
    const track = song("x", 467);
    const play: Play = { track, startedAt: now - 2 * day, endedAt: now - 2 * day, listenedMs: 1, skipped: false, contextUri: null };
    const withPlays = stats({ topTracks: [{ name: track.name, track, plays: 38, listenedMs: 1 }] });
    expect(credits(track, true, withPlays, [play], now)).toEqual(["7 min 47 s", "Kept in Liked Songs", "Played 38 times this month", "Last heard 2 days ago"]);
    expect(credits(track, false, null, [], now)).toEqual(["7 min 47 s"]);
  });
});

describe("prose", () => {
  it("summarizes the month and the most forgotten playlist", () => {
    const text = prose(stats({ forgotten: [{ playlistId: "s", name: "Sunday Coffee", lastPlayedAt: Date.UTC(2026, 7, 20) }] }), now)
      .map((part) => part.text)
      .join("");
    expect(text).toBe("This month you listened for 61 hours, mostly Floating Points. You haven't played Sunday Coffee since August.");
  });

  it("admits when there is no history", () => {
    expect(prose(stats({ since: null }), now)[0]!.text).toMatch(/^No history yet/);
  });
});

describe("notes", () => {
  it("describes the shuffle session", () => {
    const session: ShuffleSession = {
      id: "s",
      sourceId: "deep",
      sourceName: "Deep Work",
      createdAt: now,
      options: DEFAULT_SHUFFLE,
      tracks: [{ track: song("a", 1), reason: null }],
      dropped: 2,
      candidates: 3,
      vibeError: null,
    };
    expect(sessionNote(session)).toBe("Dealt 1 from Deep Work; 2 skip-prone songs left out.");
    expect(sessionNote(null)).toBeNull();
  });

  it("lists the threads the music stepped aside for", () => {
    expect(duckNote(IDLE_DUCK)).toBeNull();
    expect(duckNote({ active: true, mode: "pause", threads: [{ id: "1", title: "Fix login" }, { id: "2", title: "Ship it" }] })).toBe("Paused for “Fix login” and “Ship it”, waiting on you.");
  });
});
