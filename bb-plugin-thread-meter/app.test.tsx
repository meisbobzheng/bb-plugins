// @vitest-environment jsdom
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot, type PluginSdkTestFakes } from "@get-bb/plugin-sdk/testing/app";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

const THREAD_ID = "thr_test";
const USAGE_SOURCE = "provider-claude-code";

const requested = (seq: number, model: string) => ({
  id: `evt_${seq}`,
  seq,
  threadId: THREAD_ID,
  createdAt: seq,
  scope: { kind: "thread" },
  type: "client/turn/requested",
  data: { execution: { model } },
});

const tokenUsage = (seq: number) => ({
  id: `evt_${seq}`,
  seq,
  threadId: THREAD_ID,
  createdAt: seq,
  scope: { kind: "turn", turnId: "t1" },
  type: "thread/tokenUsage/updated",
  data: {
    tokenUsage: {
      last: {
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 1_000_000,
        reasoningOutputTokens: 0,
        totalTokens: 2_000_000,
      },
    },
  },
});

function fakeBb(events: unknown[]) {
  const threadListeners: Array<(event: unknown) => void> = [];
  const sdk = {
    subscribe: (args: { event: string; callback: (event: unknown) => void }) => {
      if (args.event === "thread:changed") threadListeners.push(args.callback);
      return () => {};
    },
    threads: {
      context: async () => ({
        usage: { usedTokens: 250_000, modelContextWindow: 1_000_000, estimated: true },
      }),
      events: {
        list: async ({ afterSeq }: { afterSeq?: string }) =>
          events.filter((event) => (event as { seq: number }).seq > Number(afterSeq ?? 0)),
      },
    },
    plugins: {
      experimental_discoverRpc: async () => [{ pluginId: USAGE_SOURCE }],
      callRpc: async ({ method }: { method: string }) =>
        method === "provider-usage.v1.listResources"
          ? {
              resources: [
                {
                  id: "res",
                  providerId: "claude-code",
                  scope: { kind: "host", hostId: "host_1" },
                },
              ],
            }
          : {
              usage: {
                status: "ok",
                planLabel: "Max (5x)",
                windows: [
                  { id: "5h", label: "Current session", usedPercent: 12, resetsAt: null },
                  { id: "wk", label: "Weekly limit", usedPercent: 40, resetsAt: null },
                ],
              },
            },
    },
  };
  const emit = (eventTypes: string[]) =>
    act(async () => {
      for (const listener of threadListeners) {
        listener({ entity: "thread", changes: ["events-appended"], metadata: { eventTypes } });
      }
    });
  return { sdk: sdk as unknown as PluginSdkTestFakes, emit };
}

async function renderMeter(events: unknown[]) {
  const app = await loadPluginApp(() => import("./app"));
  const action = app.composerCustomizations[0]!.actions![0]!;
  const { sdk, emit } = fakeBb(events);
  const slot = renderSlot(action, {}, {
    sdk,
    composer: {
      scope: { kind: "thread", threadId: THREAD_ID },
      selection: { providerId: "claude-code", model: "claude-opus-5-5" },
    },
  });
  return { slot, emit };
}

describe("thread meter", () => {
  it("shows context, cost, and the most-used plan window next to the model", async () => {
    const { slot } = await renderMeter([requested(1, "claude-opus-5-5"), tokenUsage(2)]);
    const trigger = await slot.findByRole("button", { name: "Context, token cost, and plan usage" });
    await slot.findByText("$24.00");
    expect(trigger.textContent).toContain("25%");
    expect(trigger.textContent).toContain("40% plan");
  });

  it("prices new turns when a token usage event arrives", async () => {
    const events: unknown[] = [requested(1, "claude-opus-5-5"), tokenUsage(2)];
    const { slot, emit } = await renderMeter(events);
    await slot.findByText("$24.00");
    events.push(requested(3, "claude-sonnet-5"), tokenUsage(4));
    await emit(["item/agentMessage/delta"]);
    expect(slot.queryByText("$36.00")).toBeNull();
    await emit(["thread/tokenUsage/updated"]);
    await slot.findByText("$36.00");
  });

  it("opens a breakdown with tokens, cost, and plan reset windows", async () => {
    const { slot } = await renderMeter([requested(1, "claude-opus-5-5"), tokenUsage(2)]);
    fireEvent.click(await slot.findByRole("button", { name: "Context, token cost, and plan usage" }));
    await slot.findByText("API-equivalent cost");
    await slot.findByText("Plan usage · Max (5x)");
    await slot.findByText("250K / 1M");
    expect(slot.getAllByText("$24.00")).toHaveLength(2);
  });
});
