import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { frecency, type Usage } from "../model";
import { exactBonus, isExact, matchTerms, queryTerms } from "./match";

type Thread = PluginSidebarThread;
type Project = PluginSidebarProject;

export const threadKey = (id: string) => `thread:${id}`;
export const projectKey = (id: string) => `project:${id}`;
export const commandKey = (id: string) => `command:${id}`;

const EARLY_SLOTS = 6;
const SECTION_SLOTS = 3;
const ATTENTION_INDICATORS = new Set(["waiting-for-input", "unread-error", "queued-failed"]);
const RUNNING_STATUSES = new Set(["active", "starting", "pending"]);

export function needsAttention(thread: Thread): boolean {
  return thread.hasPendingInteraction || thread.isUnread || ATTENTION_INDICATORS.has(thread.indicator);
}

export function isRunning(thread: Thread): boolean {
  return RUNNING_STATUSES.has(thread.status);
}

export function visibleThreads(threads: readonly Thread[]): Thread[] {
  return threads.filter((thread) => !thread.isArchived && !thread.isHidden);
}

function byPinOrder(a: Thread, b: Thread): number {
  const keyA = a.pinSortKey ?? "";
  const keyB = b.pinSortKey ?? "";
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0);
}

export interface RootGroups {
  attention: Thread[];
  running: Thread[];
  pinnedThreads: Thread[];
  pinnedProjects: Project[];
  recent: Thread[];
  projects: Project[];
}

export function rootGroups(
  threads: readonly Thread[],
  projects: readonly Project[],
  pinnedProjectIds: readonly string[],
  usage: Record<string, Usage>,
  now: number,
): RootGroups {
  const visible = visibleThreads(threads);
  const shown = new Set<string>();
  let budget = EARLY_SLOTS;
  const slots = () => Math.min(SECTION_SLOTS, budget);
  const take = (candidates: Thread[], limit = slots()) => {
    const picked = candidates.filter((thread) => !shown.has(thread.id)).slice(0, limit);
    for (const thread of picked) shown.add(thread.id);
    budget -= picked.length;
    return picked;
  };
  const score = (key: string) => frecency(usage[key], now);

  const attention = take(visible.filter(needsAttention).sort((a, b) => b.latestAttentionAt - a.latestAttentionAt));
  const running = take(visible.filter(isRunning).sort((a, b) => b.updatedAt - a.updatedAt));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const pinnedProjects = pinnedProjectIds.flatMap((id) => projectsById.get(id) ?? []).slice(0, slots());
  budget -= pinnedProjects.length;
  const pinnedThreads = take(visible.filter((thread) => thread.isPinned).sort(byPinOrder));
  const recent = take(
    visible
      .map((thread) => ({ thread, score: score(threadKey(thread.id)) }))
      .sort((a, b) => b.score - a.score || b.thread.updatedAt - a.thread.updatedAt)
      .map(({ thread }) => thread),
    8,
  );

  const listed = new Set(pinnedProjects.map((project) => project.id));
  return {
    attention,
    running,
    pinnedThreads,
    pinnedProjects,
    recent,
    projects: projects
      .filter((project) => !listed.has(project.id))
      .sort((a, b) => score(projectKey(b.id)) - score(projectKey(a.id))),
  };
}

export interface Ranked<T> {
  candidate: T;
  score: number;
}

export function rankScored<T>(
  candidates: readonly T[],
  query: string,
  fields: (candidate: T) => readonly string[],
  key: (candidate: T) => string,
  usage: Record<string, Usage>,
  now: number,
  limit = 30,
  exact = fields,
): Ranked<T>[] {
  const terms = queryTerms(query);
  const phrase = terms.join(" ");
  return candidates
    .flatMap((candidate) => {
      const score = terms.length === 0 ? 0 : matchTerms(terms, fields(candidate));
      if (score === null) return [];
      const bonus = isExact(phrase, exact(candidate)) ? exactBonus(terms) : 0;
      return [{ candidate, score: score + bonus + Math.min(frecency(usage[key(candidate)], now) / 20, 40) }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function rank<T>(...args: Parameters<typeof rankScored<T>>): T[] {
  return rankScored(...args).map(({ candidate }) => candidate);
}

export function remoteScore(query: string, fields: readonly string[], exact?: boolean): number {
  const terms = queryTerms(query);
  return (matchTerms(terms, fields) ?? 0) + ((exact ?? isExact(terms.join(" "), fields)) ? exactBonus(terms) : 0);
}

export const TOP_HIT = "Top hit";

export interface RankedSection<T> {
  title: string;
  items: readonly Ranked<T>[];
  fallback?: boolean;
}

export function withTopHit<T>(sections: readonly RankedSection<T>[]): Array<{ title: string; items: T[] }> {
  const best = (fallback: boolean) =>
    sections
      .filter((section) => (section.fallback ?? false) === fallback)
      .flatMap((section) => section.items)
      .reduce<Ranked<T> | undefined>((top, entry) => (top === undefined || entry.score > top.score ? entry : top), undefined);
  const top = best(false) ?? best(true);
  return [
    { title: TOP_HIT, items: top === undefined ? [] : [top.candidate] },
    ...sections.map(({ title, items }) => ({ title, items: items.filter((entry) => entry !== top).map((entry) => entry.candidate) })),
  ];
}
