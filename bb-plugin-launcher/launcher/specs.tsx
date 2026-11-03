import { experimental_copyToClipboard as copyToClipboard } from "@get-bb/plugin-sdk/app";
import { Copy, Download, ExternalLink, MessageSquare, TextQuote } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useLauncher, type LauncherContextValue } from "./context";
import { errorMessage, useAsync, useDebounced, type PluginEntry } from "./data";
import { COPY_SHORTCUT, copyAction } from "./items";
import { MOD_ENTER } from "./keys";
import { PluginIcon } from "./plugins";
import { Results } from "./Results";
import { parser } from "./sources";
import type { Action, Item } from "./types";

export const SPEC_PLUGIN_ID = "spec-search";
export const SPEC_SECTION = "3GPP specs";
const PAGE_LIMIT = 30;
const MIN_QUERY = 2;
const MARK = /\u0002([^\u0003]*)\u0003/g;

export interface SpecHit {
  spec: string;
  kind: string;
  version: string;
  clause: string;
  title: string;
  snippet: string;
  match: "clause" | "subclause" | "contents" | "text";
}

export interface SpecResults {
  hits: SpecHit[];
  missing: string | null;
}

interface ClauseRef {
  clause: string;
  title: string;
}

export interface SpecClause {
  spec: { spec: string; kind: string; title: string; version: string; release: number };
  clause: string;
  title: string;
  body: string;
  parent: ClauseRef | null;
  children: ClauseRef[];
}

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";
const isRef = (value: unknown): value is ClauseRef => isFields(value) && isString(value.clause) && isString(value.title);
const isHit = (value: unknown): value is SpecHit =>
  isFields(value) && ["spec", "kind", "version", "clause", "title", "snippet", "match"].every((key) => isString(value[key]));
const isClause = (value: unknown): value is SpecClause =>
  isFields(value) &&
  isFields(value.spec) &&
  isString(value.spec.spec) &&
  isString(value.spec.title) &&
  isString(value.clause) &&
  isString(value.title) &&
  isString(value.body) &&
  (value.parent === null || isRef(value.parent)) &&
  Array.isArray(value.children) &&
  value.children.every(isRef);

const resultsOutput = parser(
  (value): value is SpecResults => isFields(value) && Array.isArray(value.hits) && value.hits.every(isHit) && (value.missing === null || isString(value.missing)),
  "spec search result",
);
const clauseOutput = parser((value): value is { clause: SpecClause | null } => isFields(value) && (value.clause === null || isClause(value.clause)), "spec clause");
const fetchOutput = parser(
  (value): value is { status: string; note: string | null } => isFields(value) && isString(value.status) && (value.note === null || isString(value.note)),
  "spec fetch result",
);

const NO_RESULTS: SpecResults = { hits: [], missing: null };
const clauseCache = new Map<string, SpecClause | null>();

export function specPlugin(ctx: LauncherContextValue): PluginEntry | undefined {
  return ctx.plugins.data?.find((plugin) => plugin.id === SPEC_PLUGIN_ID && plugin.status === "running");
}

export function specCitation(hit: Pick<SpecHit, "kind" | "spec" | "clause">): string {
  return `${hit.kind} ${hit.spec} §${hit.clause}`;
}

function specPage(spec: string): string {
  return `https://www.3gpp.org/DynaReport/${spec.replace(".", "").replace(/-.*/, "")}.htm`;
}

export function Marked({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARK)) {
    parts.push(text.slice(cursor, match.index));
    parts.push(
      <mark key={match.index} className="bg-transparent font-semibold text-foreground">
        {match[1]}
      </mark>,
    );
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function useSpecResults(query: string, limit: number): SpecResults | undefined {
  const ctx = useLauncher();
  const enabled = specPlugin(ctx) !== undefined;
  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 120);
  const { data } = useAsync(
    async (signal) => ({
      query: debounced,
      results:
        enabled && debounced.length >= MIN_QUERY
          ? await ctx.sdk.plugins
              .callRpc({ pluginId: SPEC_PLUGIN_ID, method: "search", input: { query: debounced, limit }, outputSchema: resultsOutput, signal })
              .catch(() => NO_RESULTS)
          : NO_RESULTS,
    }),
    [ctx.sdk, enabled, debounced, limit],
  );
  if (!enabled || trimmed.length < MIN_QUERY) return NO_RESULTS;
  return data?.query === trimmed ? data.results : undefined;
}

function loadClause(ctx: LauncherContextValue, hit: SpecHit, signal?: AbortSignal): Promise<SpecClause | null> {
  const key = `${hit.spec} ${hit.clause}`;
  if (clauseCache.has(key)) return Promise.resolve(clauseCache.get(key)!);
  return ctx.sdk.plugins
    .callRpc({ pluginId: SPEC_PLUGIN_ID, method: "clause", input: { spec: hit.spec, clause: hit.clause }, outputSchema: clauseOutput, signal })
    .then(({ clause }) => {
      clauseCache.set(key, clause);
      return clause;
    });
}

export function useSpecClause(hit: SpecHit, settled: boolean): SpecClause | null | undefined {
  const ctx = useLauncher();
  const key = `${hit.spec} ${hit.clause}`;
  const { data } = useAsync((signal) => (settled ? loadClause(ctx, hit, signal) : Promise.resolve(undefined)), [ctx.sdk, key, settled]);
  return data ?? clauseCache.get(key);
}

function clauseTitle(hit: Pick<SpecHit, "clause" | "title">): string {
  return hit.clause === hit.title ? hit.title : `§${hit.clause} ${hit.title}`;
}

function askAction(ctx: LauncherContextValue, hit: SpecHit): Action {
  return {
    id: "ask",
    title: "Ask about this clause",
    icon: MessageSquare,
    run: () =>
      ctx.navigate.toCompose({
        ...(ctx.currentProjectId === null ? {} : { projectId: ctx.currentProjectId }),
        initialPrompt: `Read 3GPP ${specCitation(hit)} (${hit.title}, V${hit.version}) and explain it.`,
        focusPrompt: true,
      }),
  };
}

function copyClauseAction(ctx: LauncherContextValue, hit: SpecHit): Action {
  return {
    id: "copy-clause",
    title: "Copy clause text",
    icon: TextQuote,
    shortcut: MOD_ENTER,
    run: async () => {
      try {
        const clause = await loadClause(ctx, hit);
        if (clause === null) throw new Error(`${specCitation(hit)} is no longer indexed`);
        const text = `${specCitation(hit)} ${clause.title} (V${clause.spec.version})\n\n${clause.body}`;
        if (await copyToClipboard({ text })) toast.success("Copied to clipboard");
      } catch (cause) {
        toast.error("Could not copy the clause", { description: errorMessage(cause) });
      }
    },
  };
}

export function specItem(ctx: LauncherContextValue, plugin: PluginEntry, hit: SpecHit, query: string, drill = true): Item {
  const citation = specCitation(hit);
  return {
    id: `spec:${hit.spec}:${hit.clause}`,
    title: clauseTitle(hit),
    subtitle: (
      <>
        {`${hit.kind} ${hit.spec} V${hit.version}`}
        {hit.snippet === "" ? null : (
          <>
            {" · "}
            <Marked text={hit.snippet} />
          </>
        )}
      </>
    ),
    terms: [`${hit.spec} ${hit.clause}`, hit.title, citation, hit.clause],
    icon: <PluginIcon plugin={plugin} />,
    preview: { kind: "spec", hit },
    drill: drill ? { title: "More spec results", page: { kind: "specs" }, query } : undefined,
    actions: [
      askAction(ctx, hit),
      copyClauseAction(ctx, hit),
      copyAction("copy-citation", "Copy citation", `${citation} ${hit.title} (V${hit.version})`, Copy, COPY_SHORTCUT),
      { id: "open-3gpp", title: "Open spec page on 3gpp.org", icon: ExternalLink, run: () => void ctx.navigate.openUrl(specPage(hit.spec)) },
    ],
  };
}

export function fetchSpecItem(ctx: LauncherContextValue, plugin: PluginEntry, spec: string): Item {
  return {
    id: `spec-fetch:${spec}`,
    title: `Fetch ${spec} from 3GPP`,
    subtitle: "Not indexed yet · downloads the newest Rel-19 version from www.3gpp.org",
    terms: [spec],
    icon: <PluginIcon plugin={plugin} />,
    actions: [
      {
        id: "fetch",
        title: "Fetch and index",
        icon: Download,
        run: async () => {
          const toastId = toast.loading(`Fetching ${spec} from 3GPP…`);
          try {
            const { status, note } = await ctx.sdk.plugins.callRpc({ pluginId: SPEC_PLUGIN_ID, method: "fetch", input: { spec }, outputSchema: fetchOutput });
            if (status === "failed") toast.error(`Could not fetch ${spec}`, { id: toastId, description: note ?? undefined });
            else if (status === "done") toast.success(note ?? `Indexed ${spec}`, { id: toastId });
            else toast.info(`Still indexing ${spec}; search again in a minute.`, { id: toastId });
          } catch (cause) {
            toast.error(`Could not fetch ${spec}`, { id: toastId, description: errorMessage(cause) });
          }
        },
      },
    ],
  };
}

export function specItems(ctx: LauncherContextValue, plugin: PluginEntry, results: SpecResults, query: string, drill = true): Item[] {
  return results.missing === null ? results.hits.map((hit) => specItem(ctx, plugin, hit, query, drill)) : [fetchSpecItem(ctx, plugin, results.missing)];
}

export function SpecsPage({ query, showPreview }: { query: string; showPreview: boolean }) {
  const ctx = useLauncher();
  const plugin = specPlugin(ctx);
  const results = useSpecResults(query, PAGE_LIMIT);
  const prompt = query.trim();
  const items = plugin === undefined || results === undefined ? [] : specItems(ctx, plugin, results, prompt, false);
  const emptyText =
    plugin === undefined
      ? "Spec Search is not running"
      : prompt.length < MIN_QUERY
        ? "Type a spec and clause, like 29.228 B.1, or words from the spec"
        : results === undefined
          ? "Searching…"
          : "No clauses match";
  return <Results sections={[{ title: SPEC_SECTION, items }]} query={query} showPreview={showPreview} emptyText={emptyText} />;
}
