import { useMemo, type ReactNode } from "react";
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowRight,
  Check,
  Cpu,
  ExternalLink,
  Keyboard,
  MessageSquare,
  MessageSquarePlus,
  Palette,
  Puzzle,
  Send,
  Settings,
  SlidersHorizontal,
  SquarePen,
} from "lucide-react";
import { useLauncher, type LauncherContextValue } from "./context";
import { useMessageSearch, type SearchHit } from "./data";
import { newThreadAction, projectItem, spawnAction, threadItem } from "./items";
import { shortcutLabel } from "./keys";
import { pluginItem, pluginKey, pluginTerms } from "./plugins";
import { commandKey, isRunning, needsAttention, projectKey, rank, rootGroups, threadKey, visibleThreads } from "./rank";
import { Results } from "./Results";
import { useSourceSections } from "./sources";
import { generalToggleItems, settingLinkItems } from "./settings";
import type { Action, Item, Page, Section } from "./types";

interface PageProps {
  query: string;
  showPreview: boolean;
}

const PROJECT_THREAD_LIMIT = 100;

const icon = (Glyph: LucideIcon) => <Glyph className="size-4 text-muted-foreground" aria-hidden />;
const itemTerms = (item: Item) => item.terms ?? [];

function threadTerms(ctx: LauncherContextValue) {
  return (thread: PluginSidebarThread) => [
    thread.displayTitle,
    ctx.projectsById.get(thread.projectId)?.name ?? "",
    thread.environment?.branchName ?? "",
    thread.environment?.name ?? "",
  ];
}

function rankThreads(ctx: LauncherContextValue, threads: readonly PluginSidebarThread[], query: string, limit = 25) {
  return rank(threads, query, threadTerms(ctx), (thread) => threadKey(thread.id), ctx.state.usage, ctx.now, limit);
}

function rankProjects(ctx: LauncherContextValue, query: string) {
  const pinned = new Set(ctx.state.pinnedProjectIds);
  const ranked = rank(ctx.projects, query, (project) => [project.name], (project) => projectKey(project.id), ctx.state.usage, ctx.now, 50);
  return query.trim() === "" ? [...ranked.filter((p) => pinned.has(p.id)), ...ranked.filter((p) => !pinned.has(p.id))] : ranked;
}

function pushAction(ctx: LauncherContextValue, title: string, Glyph: LucideIcon, page: Page): Action {
  return { id: "open", title, icon: Glyph, keepOpen: true, run: () => ctx.controls.push(page) };
}

function command(id: string, title: string, Glyph: LucideIcon, actions: Action[], terms: string[] = []): Item {
  return {
    id: commandKey(id),
    title,
    terms: [title, ...terms],
    icon: icon(Glyph),
    usageKey: commandKey(id),
    actions,
  };
}

function commandItems(ctx: LauncherContextValue): Item[] {
  const project = ctx.currentProjectId === null ? undefined : ctx.projectsById.get(ctx.currentProjectId);
  return [
    command(
      "new-thread",
      project === undefined ? "New thread" : `New thread in ${project.name}`,
      SquarePen,
      [newThreadAction(ctx, project?.id ?? null)],
      ["compose", "create", "start"],
    ),
    command(
      "new-thread-in",
      "New thread in project…",
      MessageSquarePlus,
      [pushAction(ctx, "Choose project", ArrowRight, { kind: "pick-project", prompt: null })],
      ["compose", "create", "start"],
    ),
    command("settings", "Settings…", SlidersHorizontal, [pushAction(ctx, "Show settings", ArrowRight, { kind: "settings" })], ["preferences", "toggle"]),
    command("themes", "Change theme…", Palette, [pushAction(ctx, "Show themes", ArrowRight, { kind: "themes" })], ["appearance", "colors", "dark"]),
    command("providers", "Change default agent…", Cpu, [pushAction(ctx, "Show agents", ArrowRight, { kind: "providers" })], ["provider", "model"]),
    command("plugins", "Plugins…", Puzzle, [pushAction(ctx, "Show plugins", ArrowRight, { kind: "plugins" })], ["extensions"]),
    command("open-settings", "Open bb Settings", Settings, [
      { id: "open", title: "Open", icon: ExternalLink, run: () => ctx.controls.goTo("/settings") },
    ], ["preferences"]),
    command("keyboard", "Keyboard shortcuts", Keyboard, [
      { id: "open", title: "Open", icon: ExternalLink, run: () => ctx.controls.goTo("/settings/keyboard") },
    ], ["keybindings", "hotkeys"]),
    command("archived", "Archived threads", Archive, [
      { id: "open", title: "Open", icon: ExternalLink, run: () => ctx.controls.goTo("/archived") },
    ]),
  ];
}

function quickPromptItems(ctx: LauncherContextValue, prompt: string): Item[] {
  const project = ctx.currentProjectId === null ? undefined : ctx.projectsById.get(ctx.currentProjectId);
  const quoted = `“${prompt}”`;
  const items: Item[] = [];
  if (project !== undefined) {
    items.push({
      id: "prompt:current",
      title: `Ask in ${project.name}`,
      subtitle: quoted,
      icon: icon(Send),
      actions: [spawnAction(ctx, project.id, prompt), newThreadAction(ctx, project.id, prompt)],
    });
  }
  items.push({
    id: "prompt:pick",
    title: "Ask in project…",
    subtitle: quoted,
    icon: icon(MessageSquarePlus),
    actions: [pushAction(ctx, "Choose project", ArrowRight, { kind: "pick-project", prompt })],
  });
  return items;
}

function Snippet({ hit }: { hit: SearchHit }) {
  const match = hit.matches.find((candidate) => candidate.sourceKind.endsWith("_message")) ?? hit.matches[0];
  if (match === undefined) return null;
  const first = match.highlightRanges[0];
  const from = Math.max(0, (first?.start ?? 0) - 24);
  const text = match.text.slice(from, from + 140);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of match.highlightRanges) {
    const start = range.start - from;
    const end = range.end - from;
    if (end <= 0 || start >= text.length) continue;
    parts.push(text.slice(cursor, Math.max(cursor, start)));
    parts.push(
      <mark key={start} className="bg-transparent font-semibold text-foreground">
        {text.slice(Math.max(start, 0), end)}
      </mark>,
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return <>{from > 0 ? "…" : ""}{parts}</>;
}

function messageItem(ctx: LauncherContextValue, hit: SearchHit): Item {
  const thread = ctx.threads.find((candidate) => candidate.id === hit.thread.id);
  const base = thread === undefined ? undefined : threadItem(thread, ctx);
  return {
    id: `message:${hit.thread.id}`,
    title: thread?.displayTitle ?? hit.thread.title ?? hit.thread.titleFallback ?? "Untitled thread",
    subtitle: <Snippet hit={hit} />,
    icon: base?.icon ?? icon(MessageSquare),
    preview: { kind: "thread", threadId: hit.thread.id },
    usageKey: threadKey(hit.thread.id),
    actions: base?.actions ?? [
      { id: "open", title: "Open thread", icon: ArrowRight, run: () => ctx.navigate.toThread(hit.thread.id) },
    ],
  };
}

export function RootPage({ query, showPreview }: PageProps) {
  const ctx = useLauncher();
  const hits = useMessageSearch(query);
  const sources = useSourceSections(query, ctx.plugins.data);
  const sections = useMemo((): Section[] => {
    const toThread = (thread: PluginSidebarThread) => threadItem(thread, ctx);
    const toProject = (project: PluginSidebarProject) => projectItem(project, ctx);
    const commands = commandItems(ctx);
    if (query.trim() === "") {
      const groups = rootGroups(ctx.threads, ctx.projects, ctx.state.pinnedProjectIds, ctx.state.usage, ctx.now);
      return [
        { title: "Needs attention", items: groups.attention.map(toThread) },
        { title: "Running", items: groups.running.map(toThread) },
        { title: "Pinned", items: [...groups.pinnedProjects.map(toProject), ...groups.pinnedThreads.map(toThread)] },
        { title: "Recent", items: groups.recent.map(toThread) },
        { title: "Projects", items: groups.projects.map(toProject) },
        { title: "Commands", items: commands },
      ];
    }
    const rankItems = (items: Item[], limit = 8) =>
      rank(items, query, itemTerms, (item) => item.usageKey ?? item.id, ctx.state.usage, ctx.now, limit);
    const { plugins } = ctx;
    return [
      { title: "Threads", items: rankThreads(ctx, visibleThreads(ctx.threads), query).map(toThread) },
      { title: "Projects", items: rankProjects(ctx, query).slice(0, 8).map(toProject) },
      { title: "Commands", items: rankItems(commands) },
      ...sources,
      { title: "Settings", items: rankItems([...generalToggleItems(ctx), ...settingLinkItems(ctx)], 6) },
      {
        title: "Plugins",
        items: rank(plugins.data ?? [], query, pluginTerms, (plugin) => pluginKey(plugin.id), ctx.state.usage, ctx.now, 6).map(
          (plugin) => pluginItem(ctx, plugin, plugins.reload),
        ),
      },
      { title: "Ask an agent", items: quickPromptItems(ctx, query.trim()) },
      { title: "Messages", items: hits.map((hit) => messageItem(ctx, hit)) },
    ];
  }, [ctx, query, hits, sources]);
  return <Results sections={sections} query={query} showPreview={showPreview} />;
}

export function ProjectPage({ projectId, query, showPreview }: PageProps & { projectId: string }) {
  const ctx = useLauncher();
  const project = ctx.projectsById.get(projectId);
  const sections = useMemo((): Section[] => {
    if (project === undefined) return [];
    const threads = visibleThreads(ctx.threads).filter((thread) => thread.projectId === projectId);
    const toThread = (thread: PluginSidebarThread) => threadItem(thread, ctx);
    const prompt = query.trim();
    if (prompt !== "") {
      return [
        { title: "Threads", items: rankThreads(ctx, threads, prompt, 50).map(toThread) },
        {
          title: "Ask an agent",
          items: [
            {
              id: "prompt",
              title: `Ask in ${project.name}`,
              subtitle: `“${prompt}”`,
              icon: icon(Send),
              usageKey: projectKey(projectId),
              actions: [spawnAction(ctx, projectId, prompt), newThreadAction(ctx, projectId, prompt)],
            },
          ],
        },
      ];
    }
    const byUpdated = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
    const attention = byUpdated.filter(needsAttention);
    const running = byUpdated.filter((thread) => isRunning(thread) && !needsAttention(thread));
    const listed = new Set([...attention, ...running].map((thread) => thread.id));
    const pinned = byUpdated.filter((thread) => thread.isPinned && !listed.has(thread.id));
    for (const thread of pinned) listed.add(thread.id);
    const rest = byUpdated.filter((thread) => !listed.has(thread.id));
    return [
      {
        title: project.name,
        items: [
          {
            id: "new",
            title: `New thread in ${project.name}`,
            subtitle: "Type a prompt to start one right away",
            icon: icon(SquarePen),
            usageKey: projectKey(projectId),
            actions: [newThreadAction(ctx, projectId)],
          },
        ],
      },
      { title: "Needs attention", items: attention.map(toThread) },
      { title: "Running", items: running.map(toThread) },
      { title: "Pinned", items: pinned.map(toThread) },
      {
        title: rest.length > PROJECT_THREAD_LIMIT ? `Threads · latest ${PROJECT_THREAD_LIMIT} of ${rest.length.toLocaleString()}` : "Threads",
        items: rest.slice(0, PROJECT_THREAD_LIMIT).map(toThread),
      },
    ];
  }, [ctx, project, projectId, query]);
  return <Results sections={sections} query={query} showPreview={showPreview} emptyText="Project not found" />;
}

export function PickProjectPage({ prompt, query, showPreview }: PageProps & { prompt: string | null }) {
  const ctx = useLauncher();
  const items = rankProjects(ctx, query).map((project): Item => {
    const base = projectItem(project, ctx);
    const actions =
      prompt === null
        ? [newThreadAction(ctx, project.id), ...base.actions.filter((action) => action.id === "threads")]
        : [spawnAction(ctx, project.id, prompt), newThreadAction(ctx, project.id, prompt)];
    return { ...base, subtitle: prompt === null ? base.subtitle : `“${prompt}”`, actions };
  });
  return <Results sections={[{ title: "Projects", items }]} query={query} showPreview={showPreview} />;
}

export function ActionsPage({ item, query }: PageProps & { item: Item }) {
  const ctx = useLauncher();
  const items = item.actions.map(
    (action): Item => ({
      id: `action:${action.id}`,
      title: <span className={action.destructive ? "text-destructive" : undefined}>{action.title}</span>,
      terms: [action.title],
      icon: <action.icon className={action.destructive ? "size-4 text-destructive" : "size-4 text-muted-foreground"} />,
      accessory: action.shortcut ? (
        <span className="text-xs text-muted-foreground">{shortcutLabel(action.shortcut)}</span>
      ) : null,
      usageKey: item.usageKey,
      actions: [
        action.keepOpen
          ? {
              ...action,
              run: () => {
                ctx.controls.pop();
                return action.run();
              },
            }
          : action,
      ],
    }),
  );
  const ranked = rank(items, query, itemTerms, (candidate) => candidate.id, {}, ctx.now, 100);
  return <Results sections={[{ title: "Actions", items: ranked }]} query={query} showPreview={false} />;
}

export function ChoicesPage({ sections, query }: PageProps & { sections: readonly Section[] }) {
  const ctx = useLauncher();
  const ranked = sections.map((section) => ({
    ...section,
    items: rank(section.items, query, itemTerms, (item) => item.id, {}, ctx.now, 500),
  }));
  return <Results sections={ranked} query={query} showPreview={false} />;
}

export function InputPage({ page, query }: PageProps & { page: Extract<Page, { kind: "input" }> }) {
  const value = query.trim();
  const item: Item = {
    id: "submit",
    title: value === "" ? page.placeholder : `${page.submitLabel} “${value}”`,
    icon: icon(value === "" ? SlidersHorizontal : Check),
    actions: value === "" ? [] : [{ id: "submit", title: page.submitLabel, icon: Check, run: () => page.submit(value) }],
  };
  return <Results sections={[{ title: page.title, items: [item] }]} query={query} showPreview={false} />;
}
