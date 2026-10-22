import { describe, expect, it } from "vitest";
import { computeStats, observe, type Listening, type Observation } from "./history";
import type { PlayRecord, PlayRow } from "./store";
import { track } from "./test/fake-spotify";

const A = track("a", { durationMs: 200_000 });
const B = track("b", { durationMs: 180_000 });

function run(observations: Observation[]): PlayRecord[] {
  let current: Listening | null = null;
  const finished: PlayRecord[] = [];
  for (const observation of observations) {
    const result = observe(current, observation);
    current = result.next;
    if (result.finished !== null) finished.push(result.finished);
  }
  return finished;
}

const at = (seconds: number, progressSeconds: number, playing = true, which = A): Observation => ({
  at: seconds * 1000,
  track: which,
  progressMs: progressSeconds * 1000,
  isPlaying: playing,
  contextUri: "spotify:playlist:p",
});

describe("observe", () => {
  it("records a full listen when the next song starts", () => {
    const [play] = run([at(0, 0), at(100, 100), at(195, 195), at(205, 2, true, B)]);
    expect(play).toMatchObject({ track: { id: "a" }, skipped: false, listenedMs: 195_000, contextUri: "spotify:playlist:p" });
  });

  it("marks a song skipped after a few seconds", () => {
    const [play] = run([at(0, 0), at(8, 8), at(9, 1, true, B)]);
    expect(play).toMatchObject({ track: { id: "a" }, skipped: true, listenedMs: 8_000 });
  });

  it("does not count a forward seek as listening", () => {
    const [play] = run([at(0, 0), at(4, 4), at(8, 150), at(10, 152), at(11, 0, true, B)]);
    expect(play!.listenedMs).toBe(6_000);
    expect(play!.skipped).toBe(true);
  });

  it("does not count paused time", () => {
    const [play] = run([at(0, 40, false), at(60, 40, false), at(64, 44, true), at(70, 1, true, B)]);
    expect(play!.listenedMs).toBe(4_000);
  });

  it("splits a repeated song into two plays", () => {
    const plays = run([at(0, 0), at(190, 190), at(198, 2), at(260, 64), { ...at(261, 0), track: null }]);
    expect(plays.map((play) => play.skipped)).toEqual([false, false]);
    expect(plays).toHaveLength(2);
  });
});

describe("computeStats", () => {
  const now = Date.UTC(2026, 9, 22, 12);
  const day = 86_400_000;
  const row = (trackId: string, daysAgo: number, listenedMs: number, skipped = false, contextUri: string | null = null): PlayRow => ({
    trackId,
    startedAt: now - daysAgo * day - listenedMs,
    endedAt: now - daysAgo * day,
    listenedMs,
    durationMs: 200_000,
    skipped,
    contextUri,
  });

  it("ranks artists by listening time and finds forgotten playlists", () => {
    const stats = computeStats({
      now,
      plays: [row("a", 1, 200_000), row("a", 2, 200_000), row("b", 1, 150_000), row("b", 3, 5_000, true), row("a", 40, 200_000)],
      tracks: new Map([
        ["a", A],
        ["b", B],
      ]),
      firstPlayAt: now - 60 * day,
      playlists: [
        { id: "p1", uri: "spotify:playlist:p1", name: "Deep Work", owner: "me", ownedByMe: true, collaborative: false, readable: true, trackCount: 1, imageUrl: null, url: null, kind: "playlist" },
        { id: "p2", uri: "spotify:playlist:p2", name: "Sunday Coffee", owner: "me", ownedByMe: true, collaborative: false, readable: true, trackCount: 1, imageUrl: null, url: null, kind: "playlist" },
      ],
      contextsLastPlayed: new Map([
        ["spotify:playlist:p1", now - day],
        ["spotify:playlist:p2", now - 45 * day],
      ]),
      utcOffsetMinutes: 0,
    });
    expect(stats.topArtists.map((artist) => [artist.name, artist.plays])).toEqual([
      ["Artist a", 2],
      ["Artist b", 1],
    ]);
    expect(stats.plays30).toBe(3);
    expect(stats.skipRate30).toBe(0.25);
    expect(stats.listenedMs7).toBe(555_000);
    expect(stats.forgotten.map((entry) => entry.name)).toEqual(["Sunday Coffee"]);
    expect(stats.byHour.reduce((sum, value) => sum + value, 0)).toBe(555_000);
  });

  it("holds back forgotten playlists until there are two weeks of history", () => {
    const stats = computeStats({ now, plays: [], tracks: new Map(), firstPlayAt: now - 3 * day, playlists: [], contextsLastPlayed: new Map() });
    expect(stats.forgotten).toEqual([]);
    expect(stats.skipRate30).toBeNull();
  });
});
