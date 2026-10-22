import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useLauncher, type LauncherContextValue } from "./context";
import { errorMessage, useAsync, useDebounced, type PluginEntry } from "./data";
import { PluginIcon } from "./plugins";
import type { Item, Section } from "./types";

export const SEARCH_METHOD = "launcher.search";
export const RUN_METHOD = "launcher.run";

const sourceItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  section: z.string(),
  actions: z.array(z.object({ id: z.string(), title: z.string() })).min(1),
  keywords: z.array(z.string()),
});

const searchOutput = z.object({ items: z.array(sourceItemSchema) });
const runOutput = z.object({ message: z.string().nullable(), navigate: z.string().nullable() });

type SourceItem = z.infer<typeof sourceItemSchema>;

function sourceItem(ctx: LauncherContextValue, pluginId: string, plugin: PluginEntry | undefined, item: SourceItem): Item {
  const key = `source:${pluginId}:${item.id}`;
  return {
    id: key,
    title: item.title,
    subtitle: item.subtitle ?? undefined,
    terms: [item.title, ...item.keywords],
    icon: plugin === undefined ? <ArrowRight className="size-4 text-muted-foreground" aria-hidden /> : <PluginIcon plugin={plugin} />,
    usageKey: key,
    actions: item.actions.map((action) => ({
      id: action.id,
      title: action.title,
      icon: ArrowRight,
      keepOpen: true,
      run: async () => {
        try {
          const result = await ctx.sdk.plugins.callRpc({ pluginId, method: RUN_METHOD, input: { itemId: item.id, actionId: action.id }, outputSchema: runOutput });
          if (result.navigate !== null) ctx.controls.goTo(result.navigate);
          else ctx.controls.close();
          if (result.message !== null) toast.success(result.message);
        } catch (cause) {
          ctx.controls.close();
          toast.error(errorMessage(cause));
        }
      },
    })),
  };
}

export function useSourceSections(query: string, plugins: readonly PluginEntry[] | undefined): Section[] {
  const ctx = useLauncher();
  const debounced = useDebounced(query.trim(), 200);
  const { data: sources } = useAsync(
    (signal) => ctx.sdk.plugins.experimental_discoverRpc({ method: SEARCH_METHOD, signal }).catch(() => []),
    [ctx.sdk],
  );
  const { data: results } = useAsync(
    (signal) =>
      debounced === "" || sources === undefined
        ? Promise.resolve([])
        : Promise.all(
            sources.map((source) =>
              ctx.sdk.plugins
                .callRpc({ pluginId: source.pluginId, method: SEARCH_METHOD, input: { query: debounced }, outputSchema: searchOutput, signal })
                .then(
                  ({ items }) => ({ pluginId: source.pluginId, items }),
                  () => ({ pluginId: source.pluginId, items: [] as SourceItem[] }),
                ),
            ),
          ),
    [ctx.sdk, sources, debounced],
  );
  if (query.trim() === "" || results === undefined) return [];
  const sections = new Map<string, Item[]>();
  for (const { pluginId, items } of results) {
    const plugin = plugins?.find((entry) => entry.id === pluginId);
    for (const item of items) {
      const list = sections.get(item.section) ?? [];
      if (list.length < 8) list.push(sourceItem(ctx, pluginId, plugin, item));
      sections.set(item.section, list);
    }
  }
  return [...sections].map(([title, items]) => ({ title, items }));
}
