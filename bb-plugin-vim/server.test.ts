import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server";

describe("vim server", () => {
  it("defines the on/off and indicator settings, both on by default", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "vim" });
    await plugin(bb);
    const descriptors = harness.registrations.settingsDescriptors;
    expect(Object.keys(descriptors)).toEqual(["enabled", "showModeIndicator"]);
    expect(Object.values(descriptors).map((descriptor) => descriptor.default)).toEqual([true, true]);
  });
});
