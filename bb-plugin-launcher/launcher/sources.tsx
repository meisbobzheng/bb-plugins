import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { ZodType } from "zod";
import { useLauncher, type LauncherContextValue } from "./context";
import { errorMessage, useAsync, useDebounced, useFreshOnOpen, type PluginEntry, type SourceMethod } from "./data";
import { PluginIcon } from "./plugins";
import type { Item, Section } from "./types";

export const SEARCH_METHOD = "launcher.search";
export const RUN_METHOD = "launcher.run";

interface SourceItem {
  id: string;
  title: string;
  subtitle: string | null;
  section: string;
  actions: Array<{ id: string; title: string }>;
  keywords: string[];
}

interface RunResult {
  message: string | null;
  navigate: string | null;
}

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown) => value === null || isString(value);

const isSourceItem = (value: unknown): value is SourceItem =>
  isFields(value) &&
  isString(value.id) &&
  isString(value.title) &&
  isNullableString(value.subtitle) &&
  isString(value.section) &&
  Array.isArray(value.keywords) &&
  value.keywords.every(isString) &&
  Array.isArray(value.actions) &&
  value.actions.length > 0 &&
  value.actions.every((action) => isFields(action) && isString(action.id) && isString(action.title));

export function parser<T>(guard: (value: unknown) => value is T, what: string): ZodType<T> {
  const parse = (value: unknown): T => {
    if (guard(value)) return value;
    throw new Error(`Unexpected ${what}`);
  };
  return { parse } as unknown as ZodType<T>;
}

const searchOutput = parser(
  (value): value is { items: SourceItem[] } => isFields(value) && Array.isArray(value.items) && value.items.every(isSourceItem),
  `${SEARCH_METHOD} result`,
);
const runOutput = parser(
  (value): value is RunResult => isFields(value) && isNullableString(value.message) && isNullableString(value.navigate),
  `${RUN_METHOD} result`,
);

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

const NO_SECTIONS: Section[] = [];

export function useSourceMethods(open: boolean): readonly SourceMethod[] | undefined {
  return useFreshOnOpen(open, (sdk, signal) => sdk.plugins.experimental_discoverRpc({ method: SEARCH_METHOD, signal }).catch(() => [])).data;
}

export function useSourceSections(query: string, plugins: readonly PluginEntry[] | undefined): Section[] {
  const ctx = useLauncher();
  const { sources } = ctx;
  const debounced = useDebounced(query.trim(), 200);
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
  const empty = query.trim() === "";
  return useMemo(() => {
    if (empty || results === undefined) return NO_SECTIONS;
    const sections = new Map<string, Item[]>();
    for (const { pluginId, items } of results) {
      const plugin = plugins?.find((entry) => entry.id === pluginId);
      for (const item of items) {
        const list = sections.get(item.section) ?? [];
        if (list.length < 8) list.push(sourceItem(ctx, pluginId, plugin, item));
        sections.set(item.section, list);
      }
    }
    return sections.size === 0 ? NO_SECTIONS : [...sections].map(([title, items]) => ({ title, items }));
  }, [ctx, plugins, results, empty]);
}
