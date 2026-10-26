import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse, type FakePluginHarness } from "@get-bb/plugin-sdk/testing";
import type { PluginSettingValue } from "@get-bb/plugin-sdk";
import type { CompleteRequest } from "./claude";
import { createPlugin } from "./server";

const REVIEWS = { id: "sec_reviews", name: "reviews" };
const OTHER = { id: "sec_other", name: "other" };

const logs = (harness: FakePluginHarness) => harness.inspection.logEntries.map((entry) => entry.message);

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
        update: async () => ({}),
      },
      threadSections: { list: async () => sections },
      projects: { get: async () => ({ name: "Bob BB" }) },
    },
  });
  const classifier = {
    calls: [] as CompleteRequest[],
    answer: async (_request: CompleteRequest) => output,
  };
  await createPlugin((request) => {
    classifier.calls.push(request);
    return classifier.answer(request);
  })(bb);
  const created = () => harness.behavior.emitThreadEvent("thread.created", { thread: state.thread });
  const active = () => harness.behavior.emitThreadEvent("thread.active", { thread: state.thread });
  const updates = () => harness.inspection.sdk.callsTo("threads.update").map(([args]) => args);
  return { harness, state, classifier, created, active, updates };
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
    const { harness, created, active, updates } = await setup({ title: "My ULR fix" });
    await created();
    await active();
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: REVIEWS.id }]);
    expect(logs(harness)).toContainEqual(expect.stringMatching(/^routed thr_1 to reviews in \d+\.\ds$/));
  });

  it("asks the configured claude model with the thread's sections and first message", async () => {
    const { classifier, created, active } = await setup({ settings: { model: "haiku", claudePath: "/opt/claude" } });
    await created();
    await active();
    expect(classifier.calls).toEqual([
      expect.objectContaining({ claudePath: "/opt/claude", model: "haiku", prompt: expect.stringContaining("Fix the HSS ULR handler") }),
    ]);
    expect(classifier.calls[0]!.prompt).toContain("- reviews");
  });

  it("warns when the classifier names a section that does not exist", async () => {
    const { harness, created, active, updates } = await setup({ title: "My ULR fix", output: "frontend\nhss" });
    await created();
    await active();
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: OTHER.id }]);
    expect(harness.inspection.logEntries).toContainEqual({
      level: "warn",
      message: 'classifier answered "frontend" for thr_1, which names no section',
    });
  });

  it("files a thread where its same-titled threads are, without classifying it", async () => {
    const { harness, classifier, created, active, updates } = await setup({ title: "Fantasy football daily brief" });
    harness.inspection.sdk.stub("threads.list", async () => [
      { id: "thr_0", title: "Fantasy football daily brief", sectionId: OTHER.id },
      { id: "thr_2", title: "Review hss#639", sectionId: REVIEWS.id },
    ]);
    await created();
    await active();
    expect(classifier.calls).toHaveLength(0);
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: OTHER.id }]);
    expect(logs(harness)).toContainEqual(expect.stringMatching(/^routed thr_1 to other by title in \d+\.\ds$/));
  });

  it("classifies a thread whose same-titled threads sit in different sections", async () => {
    const { harness, classifier, created, active, updates } = await setup({ title: "Standup" });
    harness.inspection.sdk.stub("threads.list", async () => [
      { id: "thr_0", title: "Standup", sectionId: OTHER.id },
      { id: "thr_2", title: "Standup", sectionId: REVIEWS.id },
    ]);
    await created();
    await active();
    expect(classifier.calls).toHaveLength(1);
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: REVIEWS.id }]);
  });

  it("keeps a title the user changes while routing runs", async () => {
    const { harness, classifier, state, created, active, updates } = await setup();
    await created();
    state.thread = { ...state.thread, title: "Fix HSS ULR handler" };
    classifier.answer = async () => {
      state.thread = { ...state.thread, title: "Mine now" };
      return "reviews\nhss";
    };
    await active();
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: REVIEWS.id }]);
  });

  it("files the thread in other when the classifier fails", async () => {
    const { harness, classifier, created, active, updates } = await setup();
    classifier.answer = async () => {
      throw new Error("timed out");
    };
    await created();
    await active();
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: OTHER.id }]);
    expect(harness.inspection.logEntries).toContainEqual({
      level: "error",
      message: "failed to classify thr_1, filing it in other: timed out",
    });
  });

  it("names from the project when the classifier gives no topic, even with no sections to pick", async () => {
    const { harness, classifier, created, active, updates } = await setup({ sections: [OTHER], output: "other" });
    await created();
    await active();
    expect(classifier.calls).toHaveLength(1);
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: OTHER.id, title: expect.stringMatching(/^bob-b[a-z]+$/) }]);
  });

  it("skips naming, and the classifier when only other exists, with naming off", async () => {
    const { harness, classifier, created, active, updates } = await setup({ sections: [OTHER], settings: { naming: false } });
    await created();
    await active();
    expect(classifier.calls).toHaveLength(0);
    expect(updates()).toEqual([{ threadId: "thr_1", sectionId: OTHER.id }]);
  });
});
