import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { PluginSettingValue } from "@get-bb/plugin-sdk";
import plugin from "./server";

const REVIEWS = { id: "sec_reviews", name: "reviews" };
const OTHER = { id: "sec_other", name: "other" };

async function setup({
  title = null as string | null,
  output = "reviews\nhss",
  sections = [REVIEWS, OTHER],
  settings = {} as Record<string, PluginSettingValue>,
} = {}) {
  const state = { thread: makeThreadResponse({ id: "thr_1", title }) };
  const { bb, harness } = createFakePluginHost({
    pluginId: "thread-router",
    settings,
    sdk: {
      threads: {
        get: async () => state.thread,
        list: async () => [],
        promptHistory: async () => [{ createdAt: 1, input: [{ type: "text", text: "Fix the HSS ULR handler" }] }],
        spawn: async () => ({ id: "thr_worker" }),
        wait: async () => ({}),
        output: async () => ({ output }),
        archive: async () => ({}),
        stop: async () => ({}),
        update: async () => ({}),
      },
      threadSections: { list: async () => sections },
      projects: { get: async () => ({ name: "Bob BB" }) },
    },
  });
  await plugin(bb);
  const created = () => harness.behavior.emitThreadEvent("thread.created", { thread: state.thread });
  const active = () => harness.behavior.emitThreadEvent("thread.active", { thread: state.thread });
  const updates = () => harness.inspection.sdk.callsTo("threads.update").map(([args]) => args);
  return { harness, state, created, active, updates };
}

describe("thread router", () => {
  it("files an untitled thread and replaces bb's generated title with a funky name", async () => {
    const { state, created, active, updates } = await setup();
    await created();
    state.thread = { ...state.thread, title: "Fix HSS ULR handler" };
    await active();
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: REVIEWS.id, title: expect.stringMatching(/^hss-h[a-z]+$/) }]);
  });

  it("names a thread apart from recent threads on the same topic", async () => {
    const { harness, created, active, updates } = await setup();
    const recent = ["hss-hammer", "hss-hank", "hss-hawk", "hss-hero", "hss-hornet"];
    harness.inspection.sdk.stub("threads.list", async () => recent.map((title) => ({ title })));
    await created();
    await active();
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: REVIEWS.id, title: "hss-husky" }]);
  });

  it("keeps a title set when the thread was created", async () => {
    const { created, active, updates } = await setup({ title: "My ULR fix" });
    await created();
    await active();
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: REVIEWS.id }]);
  });

  it("keeps a title the user changes while routing runs", async () => {
    const { harness, state, created, active, updates } = await setup();
    await created();
    state.thread = { ...state.thread, title: "Fix HSS ULR handler" };
    harness.inspection.sdk.stub("threads.wait", async () => {
      state.thread = { ...state.thread, title: "Mine now" };
      return {};
    });
    await active();
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: REVIEWS.id }]);
  });

  it("names from the project when the classifier gives no topic, even with no sections to pick", async () => {
    const { harness, created, active, updates } = await setup({ sections: [OTHER], output: "other" });
    await created();
    await active();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: OTHER.id, title: expect.stringMatching(/^bob-b[a-z]+$/) }]);
  });

  it("skips naming, and the classifier when only other exists, with naming off", async () => {
    const { harness, created, active, updates } = await setup({ sections: [OTHER], settings: { naming: false } });
    await created();
    await active();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: OTHER.id }]);
  });
});
