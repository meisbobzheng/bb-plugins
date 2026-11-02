import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { PluginSettingValue } from "@get-bb/plugin-sdk";
import { createPlugin } from "./server";

async function setup(settings: Record<string, PluginSettingValue> = {}) {
  const runs: string[] = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "chime", settings });
  await createPlugin({
    platform: "darwin",
    run: async (_command, args) => void runs.push(args.at(-1)!),
    exists: () => true,
  })(bb);
  const emit = harness.behavior.emitThreadEvent;
  return { harness, runs, emit };
}

const thread = makeThreadResponse({ id: "thr_1" });
const glass = "/System/Library/Sounds/Glass.aiff";

describe("chime plugin", () => {
  it("chimes when a visible thread needs input", async () => {
    const hidden = await setup();
    await hidden.emit("interaction.pending", { thread: { ...thread, visibility: "hidden" }, interaction: {} as never });
    const { runs, emit } = await setup();
    await emit("interaction.pending", { thread, interaction: {} as never });
    await expect.poll(() => runs).toEqual([glass]);
    expect(hidden.runs).toEqual([]);
  });

  it("chimes when an active thread finishes or fails, once those sounds are set", async () => {
    const quiet = await setup();
    await quiet.emit("thread.active", { thread });
    await quiet.emit("thread.idle", { thread, lastAssistantText: "Done" });
    const never = await setup({ finishedSound: "Hero" });
    await never.emit("thread.idle", { thread, lastAssistantText: null });
    const { runs, emit } = await setup({ finishedSound: "Hero", failedSound: "Basso" });
    await emit("thread.active", { thread });
    await emit("thread.idle", { thread, lastAssistantText: "Done" });
    await emit("thread.failed", { thread, error: "boom" });
    await expect.poll(() => runs).toEqual(["/System/Library/Sounds/Hero.aiff", "/System/Library/Sounds/Basso.aiff"]);
    expect([...quiet.runs, ...never.runs]).toEqual([]);
  });

  it("previews a sound and prints the settings from the CLI", async () => {
    const { harness, runs } = await setup({ volume: 30 });
    expect(await harness.behavior.runCli(["test"])).toMatchObject({ exitCode: 0, stdout: "Played Glass.\n" });
    expect(await harness.behavior.runCli(["test", "finished"])).toMatchObject({ exitCode: 0, stdout: "Thread finished is silent.\n" });
    expect((await harness.behavior.runCli(["test", "nope"])).exitCode).not.toBe(0);
    expect(runs).toEqual([glass]);
    expect((await harness.behavior.runCli(["status"])).stdout).toBe("Needs input     Glass\nThread finished None\nThread failed   None\nVolume          30%\n");
  });
});
