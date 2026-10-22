import { describe, expect, it } from "vitest";
import type { DuckState } from "./contract";
import { createDucker, type DuckMode } from "./duck";

function setup(mode: DuckMode, player: { isPlaying: boolean; volumePercent: number | null; trackId: string | null }) {
  const pending = new Set<string>();
  const actions: string[] = [];
  const states: DuckState[] = [];
  const ducker = createDucker({
    settings: async () => ({ mode, volumePercent: 20 }),
    player: {
      snapshot: async () => ({ ...player }),
      setVolume: async (percent) => {
        actions.push(`volume ${percent}`);
        player.volumePercent = percent;
      },
      pause: async () => {
        actions.push("pause");
        player.isPlaying = false;
      },
      resume: async () => {
        actions.push("resume");
        player.isPlaying = true;
      },
    },
    isPending: async (id) => pending.has(id),
    onChange: (state) => states.push(state),
    log: () => undefined,
  });
  return { ducker, pending, actions, states, player };
}

describe("ducker", () => {
  it("lowers the volume while any thread waits and restores it after the last one", async () => {
    const { ducker, pending, actions, states } = setup("lower", { isPlaying: true, volumePercent: 70, trackId: "t" });
    pending.add("a").add("b");
    await ducker.pending("a", "Deploy");
    await ducker.pending("b", "Review");
    expect(actions).toEqual(["volume 20"]);
    expect(states.at(-1)).toEqual({ active: true, mode: "lower", threads: [{ id: "a", title: "Deploy" }, { id: "b", title: "Review" }] });
    pending.delete("a");
    await ducker.reconcile(["a"]);
    expect(actions).toEqual(["volume 20"]);
    pending.delete("b");
    await ducker.reconcile();
    expect(actions).toEqual(["volume 20", "volume 70"]);
    expect(states.at(-1)?.active).toBe(false);
  });

  it("leaves the volume alone if you changed it while ducked", async () => {
    const { ducker, pending, actions, player } = setup("lower", { isPlaying: true, volumePercent: 70, trackId: "t" });
    pending.add("a");
    await ducker.pending("a", "Deploy");
    player.volumePercent = 55;
    await ducker.forget("a");
    expect(actions).toEqual(["volume 20"]);
  });

  it("pauses and resumes the same song", async () => {
    const { ducker, pending, actions } = setup("pause", { isPlaying: true, volumePercent: 70, trackId: "t" });
    pending.add("a");
    await ducker.pending("a", "Deploy");
    pending.delete("a");
    await ducker.reconcile(["a"]);
    expect(actions).toEqual(["pause", "resume"]);
  });

  it("falls back to pausing on a device without volume control", async () => {
    const { ducker, actions } = setup("lower", { isPlaying: true, volumePercent: null, trackId: "t" });
    await ducker.pending("a", "Deploy");
    expect(actions).toEqual(["pause"]);
  });

  it("does nothing when the music is already stopped or ducking is off", async () => {
    const stopped = setup("lower", { isPlaying: false, volumePercent: 70, trackId: "t" });
    await stopped.ducker.pending("a", "Deploy");
    const off = setup("off", { isPlaying: true, volumePercent: 70, trackId: "t" });
    await off.ducker.pending("a", "Deploy");
    expect([...stopped.actions, ...off.actions]).toEqual([]);
  });
});
