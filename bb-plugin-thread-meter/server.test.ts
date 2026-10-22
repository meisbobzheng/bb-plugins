import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server";

const WINDOWS = [{ id: "wk", label: "Weekly limit", usedPercent: 40, resetsAt: null }];

const RESOURCES = [
  { id: "res_shared", providerId: "claude-code", scope: { kind: "shared" } },
  { id: "res_host_1", providerId: "claude-code", scope: { kind: "host", hostId: "host_1" } },
  { id: "res_codex", providerId: "codex", scope: { kind: "shared" } },
];

interface RpcArgs {
  pluginId: string;
  method: string;
  input: { resourceId?: string };
}

function setup({ status = "ok" }: { status?: string } = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "thread-meter",
    sdk: {
      plugins: {
        experimental_discoverRpc: async () =>
          [{ pluginId: "provider-claude-code" }, { pluginId: "broken-source" }] as never,
        callRpc: (async ({ pluginId, method, input }: RpcArgs) => {
          if (pluginId === "broken-source") throw new Error("unavailable");
          if (method === "provider-usage.v1.listResources") return { resources: RESOURCES };
          return { usage: { status, planLabel: `Max for ${input.resourceId}`, windows: WINDOWS } };
        }) as never,
      },
    },
  });
  plugin(bb);
  const getPlanUsage = (input: { providerId: string; hostId: string | null; refresh: boolean }) =>
    harness.behavior.callRpc("plan_usage_get", input);
  return { harness, getPlanUsage };
}

describe("plan usage", () => {
  it("reads the provider's resource on the thread's host", async () => {
    const { harness, getPlanUsage } = setup();
    expect(await getPlanUsage({ providerId: "claude-code", hostId: "host_1", refresh: true })).toEqual({
      planLabel: "Max for res_host_1",
      windows: WINDOWS,
    });
    expect(harness.sdk.callsTo("plugins.callRpc").at(-1)?.[0]).toMatchObject({
      pluginId: "provider-claude-code",
      method: "provider-usage.v1.getResource",
      input: { resourceId: "res_host_1", refresh: true },
    });
  });

  it("falls back to the provider's first resource when no host matches", async () => {
    const { getPlanUsage } = setup();
    expect(await getPlanUsage({ providerId: "claude-code", hostId: "host_2", refresh: false })).toMatchObject({
      planLabel: "Max for res_shared",
    });
  });

  it("reports nothing when no source has the provider or its usage is not ok", async () => {
    expect(await setup().getPlanUsage({ providerId: "acp", hostId: null, refresh: false })).toBeNull();
    expect(
      await setup({ status: "unauthenticated" }).getPlanUsage({ providerId: "claude-code", hostId: null, refresh: false }),
    ).toBeNull();
  });
});
