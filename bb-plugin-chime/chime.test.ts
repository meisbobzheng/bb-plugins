import { describe, expect, it } from "vitest";
import { COALESCE_MS, commands, createChime, type ChimeEvent } from "./chime";

function setup({
  platform = "darwin" as NodeJS.Platform,
  sounds = { input: "Glass", finished: "None", failed: "Basso" } as Record<ChimeEvent, string>,
  volumePercent = 60,
  failing = [] as string[],
  files = ["/usr/share/sounds/freedesktop/stereo/message-new-instant.oga"],
} = {}) {
  const clock = { now: 0 };
  const runs: string[] = [];
  const logs: string[] = [];
  const chime = createChime({
    platform,
    settings: async () => ({ sounds, volumePercent }),
    run: async (command, args) => {
      runs.push([command, ...args].join(" "));
      if (failing.includes(command)) throw new Error(`spawn ${command} ENOENT`);
    },
    exists: (path) => files.includes(path),
    now: () => clock.now,
    log: (message) => logs.push(message),
  });
  return { chime, clock, runs, logs };
}

describe("chime", () => {
  it("plays one sound for a burst of pending interactions", async () => {
    const { chime, clock, runs } = setup();
    await chime.notify("input");
    clock.now = COALESCE_MS - 1;
    await chime.notify("input");
    expect(runs).toEqual(["afplay -v 0.6 /System/Library/Sounds/Glass.aiff"]);
    clock.now = 2 * COALESCE_MS;
    await chime.notify("input");
    expect(runs).toHaveLength(2);
  });

  it("coalesces each event on its own", async () => {
    const { chime, runs } = setup();
    await chime.notify("input");
    await chime.notify("failed");
    expect(runs).toEqual(["afplay -v 0.6 /System/Library/Sounds/Glass.aiff", "afplay -v 0.6 /System/Library/Sounds/Basso.aiff"]);
  });

  it("stays silent for None or zero volume", async () => {
    const none = setup();
    expect(await none.chime.play("finished")).toBeNull();
    const muted = setup({ volumePercent: 0 });
    expect(await muted.chime.play("input")).toBeNull();
    expect([...none.runs, ...muted.runs]).toEqual([]);
  });

  it("maps the volume to afplay and paplay levels", () => {
    expect(commands("darwin", "input", "Pop", 0.25, () => false)).toEqual([["afplay", ["-v", "0.25", "/System/Library/Sounds/Pop.aiff"]]]);
    expect(commands("linux", "failed", "Pop", 0.5, () => true)[0]).toEqual(["paplay", ["--volume=32768", "/usr/share/sounds/freedesktop/stereo/dialog-error.oga"]]);
  });

  it("falls back from paplay to aplay on Linux", async () => {
    const { chime, runs } = setup({ platform: "linux", failing: ["paplay"] });
    expect(await chime.play("input")).toBe("Glass");
    expect(runs).toEqual([
      "paplay --volume=39322 /usr/share/sounds/freedesktop/stereo/message-new-instant.oga",
      "aplay -q /usr/share/sounds/freedesktop/stereo/message-new-instant.oga",
    ]);
  });

  it("logs once and plays nothing without a player or sound file", async () => {
    const windows = setup({ platform: "win32" });
    await expect(windows.chime.play("input")).rejects.toThrow("no sound player on win32");
    const bare = setup({ platform: "linux", files: [] });
    await bare.chime.notify("input");
    await bare.chime.notify("failed");
    expect(bare.runs).toEqual([]);
    expect(bare.logs).toEqual(["chime: can't play sounds: no sound player on linux"]);
  });

  it("never throws out of notify when the player fails", async () => {
    const { chime, logs } = setup({ failing: ["afplay"] });
    await expect(chime.notify("input")).resolves.toBeUndefined();
    expect(logs).toEqual(["chime: can't play sounds: spawn afplay ENOENT"]);
  });
});
