import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { summarizeSpend, type Spend, type SpendEvent } from "./spend";

const LIST_RESOURCES = "provider-usage.v1.listResources";
const GET_RESOURCE = "provider-usage.v1.getResource";
const SPEND_EVENT_TYPES = ["client/turn/requested", "thread/tokenUsage/updated"] as const;

const resourceListSchema = z.object({
  resources: z.array(
    z.object({
      id: z.string(),
      providerId: z.string(),
      scope: z.object({ kind: z.string(), hostId: z.string().optional() }),
    }),
  ),
});

const usageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPercent: z.number(),
  resetsAt: z.string().nullable(),
});

const resourceUsageSchema = z.object({
  usage: z.object({
    status: z.string(),
    planLabel: z.string().nullish(),
    windows: z.array(usageWindowSchema).optional(),
  }),
});

export type UsageWindow = z.infer<typeof usageWindowSchema>;

export interface PlanUsage {
  planLabel: string | null;
  windows: UsageWindow[];
}

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

export async function loadPlanUsage(
  sdk: PluginBrowserBbSdk,
  { providerId, hostId, refresh, signal }: {
    providerId: string;
    hostId: string | undefined;
    refresh: boolean;
    signal: AbortSignal;
  },
): Promise<PlanUsage | null> {
  const sources = await sdk.plugins.experimental_discoverRpc({ method: LIST_RESOURCES });
  const listed = await Promise.allSettled(
    sources.map(async ({ pluginId }) => {
      const { resources } = await sdk.plugins.callRpc({
        pluginId,
        method: LIST_RESOURCES,
        input: {},
        outputSchema: resourceListSchema,
        signal,
      });
      return resources
        .filter((resource) => resource.providerId === providerId)
        .map((resource) => ({ ...resource, pluginId }));
    }),
  );
  const candidates = listed.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const resource =
    candidates.find((candidate) => candidate.scope.hostId === hostId) ?? candidates[0];
  if (!resource) return null;
  const { usage } = await sdk.plugins.callRpc({
    pluginId: resource.pluginId,
    method: GET_RESOURCE,
    input: { resourceId: resource.id, refresh },
    outputSchema: resourceUsageSchema,
    signal,
  });
  return usage.status === "ok"
    ? { planLabel: usage.planLabel ?? null, windows: usage.windows ?? [] }
    : null;
}
