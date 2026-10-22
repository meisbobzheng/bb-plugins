import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const LIST_RESOURCES = "provider-usage.v1.listResources";
const GET_RESOURCE = "provider-usage.v1.getResource";

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

const planUsageSchema = z.object({
  planLabel: z.string().nullable(),
  windows: z.array(usageWindowSchema),
});

export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type PlanUsage = z.infer<typeof planUsageSchema>;

export const rpcContract = defineRpcContract({
  plan_usage_get: {
    input: z.object({
      providerId: z.string().min(1),
      hostId: z.string().nullable(),
      refresh: z.boolean(),
    }),
    output: planUsageSchema.nullable(),
  },
});

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async plan_usage_get({ providerId, hostId, refresh }) {
      const sources = await bb.sdk.plugins.experimental_discoverRpc({ method: LIST_RESOURCES });
      const listed = await Promise.allSettled(
        sources.map(async ({ pluginId }) => {
          const { resources } = await bb.sdk.plugins.callRpc({
            pluginId,
            method: LIST_RESOURCES,
            input: {},
            outputSchema: resourceListSchema,
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
        candidates.find((candidate) => (candidate.scope.hostId ?? null) === hostId) ?? candidates[0];
      if (!resource) return null;
      const { usage } = await bb.sdk.plugins.callRpc({
        pluginId: resource.pluginId,
        method: GET_RESOURCE,
        input: { resourceId: resource.id, refresh },
        outputSchema: resourceUsageSchema,
      });
      return usage.status === "ok"
        ? { planLabel: usage.planLabel ?? null, windows: usage.windows ?? [] }
        : null;
    },
  });
}
