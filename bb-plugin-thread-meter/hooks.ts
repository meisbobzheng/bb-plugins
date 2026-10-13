import { useEffect, useReducer, useRef, useState } from "react";
import { experimental_useSidebarThreads, useSdk } from "@get-bb/plugin-sdk/app";
import { loadContext, loadPlanUsage, loadSpend } from "./sources";

type Feed = "context" | "spend" | "plan";
type Ticks = Readonly<Record<Feed, number>>;

const ALL_FEEDS: readonly Feed[] = ["context", "spend", "plan"];

const FEED_BY_EVENT_TYPE: Readonly<Record<string, Feed>> = {
  "thread/contextWindowUsage/updated": "context",
  "thread/compacted": "context",
  "thread/context/cleared": "context",
  "thread/tokenUsage/updated": "spend",
  "turn/completed": "plan",
};

function bump(ticks: Ticks, feeds: Iterable<Feed>): Ticks {
  const next = { ...ticks };
  for (const feed of feeds) next[feed] += 1;
  return next;
}

function useThreadTicks(threadId: string | null): Ticks {
  const sdk = useSdk();
  const [ticks, dispatch] = useReducer(bump, { context: 0, spend: 0, plan: 0 });
  useEffect(() => {
    if (!threadId) return;
    const offThread = sdk.subscribe({
      event: "thread:changed",
      threadId,
      callback: ({ changes, metadata }) => {
        if (changes.includes("history-rewritten") || changes.includes("history-compacted")) {
          dispatch(ALL_FEEDS);
          return;
        }
        if (!changes.includes("events-appended")) return;
        const types = metadata?.eventTypes;
        if (!types) {
          dispatch(ALL_FEEDS);
          return;
        }
        const feeds = new Set(types.flatMap((type) => FEED_BY_EVENT_TYPE[type] ?? []));
        if (feeds.size > 0) dispatch(feeds);
      },
    });
    const offConnection = sdk.subscribe({
      event: "realtime:connection",
      callback: ({ reconnected }) => {
        if (reconnected) dispatch(ALL_FEEDS);
      },
    });
    return () => {
      offThread();
      offConnection();
    };
  }, [sdk, threadId]);
  return ticks;
}

function useLoaded<T>(
  key: string | null,
  tick: number,
  load: (signal: AbortSignal) => Promise<T>,
): T | null {
  const [loaded, setLoaded] = useState<{ key: string; value: T } | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    loadRef.current(controller.signal).then(
      (value) => setLoaded({ key, value }),
      () => {},
    );
    return () => controller.abort();
  }, [key, tick]);
  return loaded?.key === key ? loaded.value : null;
}

export function useThreadMeter({
  threadId,
  providerId,
  model,
}: {
  threadId: string | null;
  providerId: string | undefined;
  model: string | undefined;
}) {
  const sdk = useSdk();
  const ticks = useThreadTicks(threadId);
  const { threads } = experimental_useSidebarThreads();
  const hostId = threads.find((thread) => thread.id === threadId)?.host?.id;
  const context = useLoaded(threadId, ticks.context, (signal) =>
    threadId ? loadContext(sdk, threadId, signal) : Promise.resolve(null),
  );
  const spend = useLoaded(threadId, ticks.spend, (signal) =>
    threadId ? loadSpend(sdk, threadId, model, signal) : Promise.resolve(null),
  );
  const plan = useLoaded(
    providerId ? `${providerId}:${hostId ?? ""}` : null,
    ticks.plan,
    (signal) =>
      providerId
        ? loadPlanUsage(sdk, { providerId, hostId, refresh: ticks.plan > 0, signal })
        : Promise.resolve(null),
  );
  return { context, spend, plan };
}
