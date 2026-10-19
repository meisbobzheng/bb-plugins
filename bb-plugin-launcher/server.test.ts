import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { STATE_CHANGED, type LauncherState } from "./model";
import plugin from "./server";

async function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "launcher" });
  await plugin(bb);
  const call = (method: string, input: unknown = null) =>
    harness.behavior.callRpc(method, input) as Promise<LauncherState>;
  return { harness, call };
}

describe("launcher server", () => {
  it("starts empty", async () => {
    const { call } = await setup();
    expect(await call("state_get")).toEqual({ pinnedProjectIds: [], usage: {} });
  });

  it("records usage and pins projects in order", async () => {
    const { call, harness } = await setup();
    await call("usage_record", { key: "thread:t1" });
    const recorded = await call("usage_record", { key: "thread:t1" });
    expect(recorded.usage["thread:t1"]?.count).toBe(2);

    await call("project_pin_set", { projectId: "proj_a", pinned: true });
    await call("project_pin_set", { projectId: "proj_b", pinned: true });
    await call("project_pin_set", { projectId: "proj_a", pinned: true });
    expect((await call("state_get")).pinnedProjectIds).toEqual(["proj_b", "proj_a"]);

    const unpinned = await call("project_pin_set", { projectId: "proj_b", pinned: false });
    expect(unpinned.pinnedProjectIds).toEqual(["proj_a"]);
    expect(harness.inspection.realtimeSignals.filter((signal) => signal.channel === STATE_CHANGED)).toHaveLength(6);
  });

  it("serializes concurrent writes", async () => {
    const { call } = await setup();
    await Promise.all(Array.from({ length: 5 }, () => call("usage_record", { key: "command:settings" })));
    expect((await call("state_get")).usage["command:settings"]?.count).toBe(5);
  });
});
