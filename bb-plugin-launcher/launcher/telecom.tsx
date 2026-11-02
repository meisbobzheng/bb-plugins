import { useRpc } from "@get-bb/plugin-sdk/app";
import { BookOpen, Copy, Search } from "lucide-react";
import type { rpcContract } from "../server";
import type { TelecomHit } from "../telecom";
import { useLauncher, type LauncherContextValue } from "./context";
import { useAsync, useDebounced, type PluginEntry } from "./data";
import { COPY_SHORTCUT, copyAction } from "./items";
import { MOD_ENTER } from "./keys";
import { PluginIcon } from "./plugins";
import { Results } from "./Results";
import type { Item } from "./types";

export const TELECOM_PLUGIN_ID = "telecom-ref";
export const TELECOM_SECTION = "Telecom reference";
const PAGE_LIMIT = 20;
const NO_HITS: TelecomHit[] = [];

const KIND_LABELS: Record<TelecomHit["kind"], string> = {
  cmd: "command",
  avp: "AVP",
  app: "application",
  if: "interface",
  nf: "network function",
};

export function telecomKind(hit: TelecomHit): string {
  return hit.code === null ? KIND_LABELS[hit.kind] : `${KIND_LABELS[hit.kind]} ${hit.code}`;
}

export function telecomCitation(hit: TelecomHit): string {
  const name = hit.name === hit.title ? hit.title : `${hit.title} · ${hit.name}`;
  return [`${name} (${telecomKind(hit)})`, hit.spec].filter(Boolean).join(" · ");
}

export function telecomPlugin(ctx: LauncherContextValue): PluginEntry | undefined {
  return ctx.plugins.data?.find((plugin) => plugin.id === TELECOM_PLUGIN_ID && plugin.status === "running");
}

export function useTelecomHits(query: string, limit: number): TelecomHit[] | undefined {
  const ctx = useLauncher();
  const rpc = useRpc<typeof rpcContract>();
  const enabled = telecomPlugin(ctx) !== undefined;
  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 120);
  const { data } = useAsync(
    async () => ({ query: debounced, hits: enabled && debounced !== "" ? await rpc.call("telecom_search", { query: debounced, limit }) : NO_HITS }),
    [rpc, enabled, debounced, limit],
  );
  if (!enabled || trimmed === "") return NO_HITS;
  return data?.query === trimmed ? data.hits : undefined;
}

export function telecomItem(ctx: LauncherContextValue, plugin: PluginEntry, hit: TelecomHit, query: string, drill = true): Item {
  const path = `/plugins/${TELECOM_PLUGIN_ID}/ref`;
  return {
    id: `telecom:${hit.id}`,
    title: hit.title,
    subtitle: [hit.name === hit.title ? null : hit.name, telecomKind(hit), hit.spec].filter(Boolean).join(" · "),
    terms: [hit.title, ...hit.title.split(" / "), hit.name, hit.code ?? "", hit.id],
    icon: <PluginIcon plugin={plugin} />,
    preview: { kind: "telecom", hit },
    drill: drill ? { title: "More telecom results", page: { kind: "telecom" }, query } : undefined,
    actions: [
      { id: "open", title: "Open in Telecom reference", icon: BookOpen, keepOpen: true, run: () => ctx.controls.goTo(`${path}/${hit.id}`) },
      {
        id: "search",
        title: "Search Telecom reference",
        icon: Search,
        shortcut: MOD_ENTER,
        keepOpen: true,
        run: () => ctx.controls.goTo(`${path}/q/${encodeURIComponent(query)}`),
      },
      copyAction("copy-citation", "Copy citation", telecomCitation(hit), Copy, COPY_SHORTCUT),
    ],
  };
}

export function TelecomPage({ query, showPreview }: { query: string; showPreview: boolean }) {
  const ctx = useLauncher();
  const plugin = telecomPlugin(ctx);
  const hits = useTelecomHits(query, PAGE_LIMIT);
  const prompt = query.trim();
  const items = plugin === undefined ? [] : (hits ?? []).map((hit) => telecomItem(ctx, plugin, hit, prompt, false));
  const emptyText =
    plugin === undefined
      ? "Telecom reference is not running"
      : prompt === ""
        ? "Type an abbreviation, name, or code"
        : hits === undefined
          ? "Searching…"
          : "No telecom entries match";
  return <Results sections={[{ title: TELECOM_SECTION, items }]} query={query} showPreview={showPreview} emptyText={emptyText} />;
}
