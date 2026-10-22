import { describe, expect, it } from "vitest";
import { EMPTY_SPEND, ratesFor, summarizeSpend, type SpendEvent, type TokenUsage } from "./spend";

const usage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 1_000_000,
  cachedInputTokens: 3_000_000,
  cacheReadInputTokens: 2_000_000,
  cacheWriteInputTokens: 1_000_000,
  outputTokens: 1_000_000,
  ...overrides,
});

const requested = (model?: string): SpendEvent => ({
  type: "client/turn/requested",
  data: { execution: model === undefined ? undefined : { model } },
});

const turn = (last: TokenUsage): SpendEvent => ({
  type: "thread/tokenUsage/updated",
  data: { tokenUsage: { last } },
});

const summarize = (events: readonly SpendEvent[], model?: string) =>
  summarizeSpend(events, { spend: EMPTY_SPEND, model }).spend;

describe("ratesFor", () => {
  it("does not let a shorter model id shadow a longer one", () => {
    expect(ratesFor("claude-opus-5-5")?.input).toBe(4);
    expect(ratesFor("claude-opus-5")?.input).toBe(5);
    expect(ratesFor("claude-fable-5-1")?.cacheRead).toBe(0.25);
    expect(ratesFor("claude-fable-5")?.cacheRead).toBe(1);
  });

  it("ignores date snapshots and context-size suffixes", () => {
    expect(ratesFor("claude-haiku-4-5-20251001")?.input).toBe(1);
    expect(ratesFor("claude-sonnet-5[1m]")?.input).toBe(2);
  });

  it("returns undefined for models it has no price for", () => {
    expect(ratesFor("gpt-5.5")).toBeUndefined();
  });
});

describe("summarizeSpend", () => {
  it("prices each turn with the model that ran it", () => {
    const spend = summarize([
      requested("claude-opus-5-5"),
      turn(usage()),
      requested("claude-sonnet-5"),
      turn(usage()),
    ]);
    const opus = 4 + 2 * 0.2 + 1 * 5 + 20;
    const sonnet = 2 + 2 * 0.2 + 1 * 2.5 + 10;
    expect(spend.costUsd).toBeCloseTo(opus + sonnet);
    expect(spend).toMatchObject({
      input: 2_000_000,
      cacheRead: 4_000_000,
      cacheWrite: 2_000_000,
      output: 2_000_000,
      turns: 2,
      unpricedTurns: 0,
    });
  });

  it("keeps the previous model when a request omits execution", () => {
    const spend = summarize([requested("claude-haiku-4-5"), requested(), turn(usage())]);
    expect(spend.costUsd).toBeCloseTo(1 + 2 * 0.1 + 1 * 1.25 + 5);
  });

  it("falls back to the given model before any request is seen", () => {
    expect(summarize([turn(usage())], "claude-sonnet-5").unpricedTurns).toBe(0);
  });

  it("treats cached input as cache reads when the provider does not split it", () => {
    const spend = summarize(
      [
        requested("claude-sonnet-5"),
        turn(usage({ cacheReadInputTokens: undefined, cacheWriteInputTokens: undefined })),
      ],
    );
    expect(spend.cacheRead).toBe(3_000_000);
    expect(spend.cacheWrite).toBe(0);
  });

  it("continues an earlier tally with the model it last saw", () => {
    const earlier = summarizeSpend([requested("claude-haiku-4-5"), turn(usage())], {
      spend: EMPTY_SPEND,
      model: undefined,
    });
    const next = summarizeSpend([turn(usage())], earlier);
    expect(next.spend.turns).toBe(2);
    expect(next.spend.costUsd).toBeCloseTo(2 * (1 + 2 * 0.1 + 1 * 1.25 + 5));
  });

  it("counts turns on unknown models without pricing them", () => {
    const spend = summarize([requested("gpt-5.5"), turn(usage())]);
    expect(spend).toMatchObject({ costUsd: 0, turns: 1, unpricedTurns: 1 });
  });
});
