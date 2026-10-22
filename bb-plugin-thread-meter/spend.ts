export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
}

export type SpendEvent =
  | { type: "client/turn/requested"; data: { execution?: { model?: string } } }
  | { type: "thread/tokenUsage/updated"; data: { tokenUsage: { last: TokenUsage } } };

export interface Spend {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  costUsd: number;
  turns: number;
  unpricedTurns: number;
}

export interface SpendTally {
  spend: Spend;
  model: string | undefined;
}

interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const rates = (input: number, output: number, cacheRead = input / 10): Rates => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

const RATES_PER_MTOK: Readonly<Record<string, Rates>> = {
  "claude-fable-5-1": rates(10, 50, 0.25),
  "claude-fable-5": rates(10, 50, 1),
  "claude-opus-5-5": rates(4, 20, 0.2),
  "claude-opus-5": rates(5, 25),
  "claude-opus-4-8": rates(5, 25),
  "claude-opus-4-7": rates(5, 25),
  "claude-opus-4-6": rates(5, 25),
  "claude-sonnet-5": rates(2, 10),
  "claude-sonnet-4-6": rates(3, 15),
  "claude-haiku-4-5": rates(1, 5),
};

export const EMPTY_SPEND: Spend = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  costUsd: 0,
  turns: 0,
  unpricedTurns: 0,
};

export function ratesFor(model: string): Rates | undefined {
  return RATES_PER_MTOK[model.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "")];
}

export function addTurn(spend: Spend, usage: TokenUsage, model: string | undefined): Spend {
  const cacheRead = usage.cacheReadInputTokens ?? usage.cachedInputTokens;
  const cacheWrite = usage.cacheWriteInputTokens ?? 0;
  const price = model === undefined ? undefined : ratesFor(model);
  const cost = price
    ? (usage.inputTokens * price.input +
        cacheRead * price.cacheRead +
        cacheWrite * price.cacheWrite +
        usage.outputTokens * price.output) /
      1e6
    : 0;
  return {
    input: spend.input + usage.inputTokens,
    cacheRead: spend.cacheRead + cacheRead,
    cacheWrite: spend.cacheWrite + cacheWrite,
    output: spend.output + usage.outputTokens,
    costUsd: spend.costUsd + cost,
    turns: spend.turns + 1,
    unpricedTurns: spend.unpricedTurns + (price ? 0 : 1),
  };
}

export function summarizeSpend(events: readonly SpendEvent[], from: SpendTally): SpendTally {
  let { spend, model } = from;
  for (const event of events) {
    if (event.type === "client/turn/requested") {
      model = event.data.execution?.model ?? model;
    } else {
      spend = addTurn(spend, event.data.tokenUsage.last, model);
    }
  }
  return { spend, model };
}
