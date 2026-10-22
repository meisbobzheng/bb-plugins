import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { summarizeSpend, type Spend, type SpendEvent } from "./spend";

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

export async function loadSpend(
  sdk: PluginBrowserBbSdk,
  threadId: string,
  fallbackModel: string | undefined,
  signal: AbortSignal,
): Promise<Spend> {
  const events: SpendEvent[] = [];
  let afterSeq: string | undefined;
  for (;;) {
    const page = await sdk.threads.events.list({
      threadId,
      types: SPEND_EVENT_TYPES,
      order: "asc",
      afterSeq,
      signal,
    });
    const last = page.at(-1);
    if (!last) return summarizeSpend(events, fallbackModel);
    for (const row of page) {
      if (row.type === "client/turn/requested" || row.type === "thread/tokenUsage/updated") {
        events.push(row);
      }
    }
    afterSeq = String(last.seq);
  }
}
