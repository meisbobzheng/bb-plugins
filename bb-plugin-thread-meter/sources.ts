import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { summarizeSpend, type SpendEvent, type SpendTally } from "./spend";

const SPEND_EVENT_TYPES = ["client/turn/requested", "thread/tokenUsage/updated"] as const;

export type ContextUsage = NonNullable<
  Awaited<ReturnType<PluginBrowserBbSdk["threads"]["context"]>>["usage"]
>;

export async function loadContext(
  sdk: PluginBrowserBbSdk,
  threadId: string,
  signal: AbortSignal,
): Promise<ContextUsage | null> {
  return (await sdk.threads.context({ threadId, signal })).usage;
}

export interface SpendCursor extends SpendTally {
  afterSeq: string | undefined;
}

export async function loadSpend(
  sdk: PluginBrowserBbSdk,
  threadId: string,
  from: SpendCursor,
  signal: AbortSignal,
): Promise<SpendCursor> {
  let cursor = from;
  for (;;) {
    const page = await sdk.threads.events.list({
      threadId,
      types: SPEND_EVENT_TYPES,
      order: "asc",
      afterSeq: cursor.afterSeq,
      signal,
    });
    const last = page.at(-1);
    if (!last) return cursor;
    const events: SpendEvent[] = [];
    for (const row of page) {
      if (row.type === "client/turn/requested" || row.type === "thread/tokenUsage/updated") {
        events.push(row);
      }
    }
    cursor = { ...summarizeSpend(events, cursor), afterSeq: String(last.seq) };
  }
}
