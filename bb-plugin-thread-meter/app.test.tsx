// @vitest-environment jsdom
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot, type PluginSdkTestFakes } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "./server";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

const THREAD_ID = "thr_test";

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
  };
  const emit = (eventTypes: string[], changes = ["events-appended"]) =>
    act(async () => {
      for (const listener of threadListeners) {
        listener({ entity: "thread", changes, metadata: { eventTypes } });
      }
    });
  return { sdk: sdk as unknown as PluginSdkTestFakes, emit };
}

async function renderMeter(events: unknown[]) {
  const app = await loadPluginApp(() => import("./app"));
  const action = app.composerCustomizations[0]!.actions![0]!;
  const { sdk, emit } = fakeBb(events);
  const slot = renderSlot<object, typeof rpcContract>(action, {}, {
    sdk,
    rpc: {
      plan_usage_get: () => ({
        planLabel: "Max (5x)",
        windows: [
          { id: "5h", label: "Current session", usedPercent: 12, resetsAt: null },
          { id: "wk", label: "Weekly limit", usedPercent: 40, resetsAt: null },
        ],
      }),
    },
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
    const trigger = await slot.findByRole("button", {
      name: "Thread usage: 25% of context used, $24.00 API-equivalent cost, 40% of plan used",
    });
    expect(trigger.textContent).toContain("25%");
    expect(trigger.textContent).toContain("$24.00");
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

  it("reads only new events on each update and rereads after a history rewrite", async () => {
    const events: unknown[] = [requested(1, "claude-opus-5-5"), tokenUsage(2)];
    const { slot, emit } = await renderMeter(events);
    await slot.findByText("$24.00");
    events.push(requested(3, "claude-sonnet-5"), tokenUsage(4));
    await emit(["thread/tokenUsage/updated"]);
    await slot.findByText("$36.00");
    events.splice(2);
    await emit([], ["history-rewritten"]);
    await slot.findByText("$24.00");
    const listedAfter = slot.sdkCalls
      .filter((call) => call.method === "threads.events.list")
      .map((call) => (call.args[0] as { afterSeq?: string }).afterSeq);
    expect(listedAfter).toEqual([undefined, "2", "2", "4", undefined, "2"]);
  });

  it("asks for fresh plan usage when a turn completes", async () => {
    const { slot, emit } = await renderMeter([requested(1, "claude-opus-5-5"), tokenUsage(2)]);
    await slot.findByText("40% plan");
    expect(slot.rpcCalls).toEqual([
      { method: "plan_usage_get", input: { providerId: "claude-code", hostId: null, refresh: false } },
    ]);
    await emit(["turn/completed"]);
    expect(slot.rpcCalls.at(-1)).toEqual({
      method: "plan_usage_get",
      input: { providerId: "claude-code", hostId: null, refresh: true },
    });
  });

  it("opens a breakdown with tokens, cost, and plan reset windows", async () => {
    const { slot } = await renderMeter([requested(1, "claude-opus-5-5"), tokenUsage(2)]);
    fireEvent.click(await slot.findByRole("button", { name: /^Thread usage:/ }));
    await slot.findByRole("dialog", { name: "Thread usage" });
    await slot.findByText("API-equivalent cost");
    await slot.findByText("Plan usage · Max (5x)");
    await slot.findByText("250K / 1M");
    expect(slot.getAllByText("$24.00")).toHaveLength(2);
  });
});
