import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { frecency, type Usage } from "../model";
import { matchScore } from "./match";

type Thread = PluginSidebarThread;
type Project = PluginSidebarProject;

export const threadKey = (id: string) => `thread:${id}`;
export const projectKey = (id: string) => `project:${id}`;
export const commandKey = (id: string) => `command:${id}`;

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
  const take = (candidates: Thread[], limit: number) => {
    const picked = candidates.filter((thread) => !shown.has(thread.id)).slice(0, limit);
    for (const thread of picked) shown.add(thread.id);
    return picked;
  };
  const score = (key: string) => frecency(usage[key], now);

  const attention = take(
    visible.filter(needsAttention).sort((a, b) => b.latestAttentionAt - a.latestAttentionAt),
    6,
  );
  const running = take(
    visible.filter(isRunning).sort((a, b) => b.updatedAt - a.updatedAt),
    6,
  );
  const pinnedThreads = take(visible.filter((thread) => thread.isPinned).sort(byPinOrder), 20);
  const recent = take(
    [...visible].sort(
      (a, b) => score(threadKey(b.id)) - score(threadKey(a.id)) || b.updatedAt - a.updatedAt,
    ),
    8,
  );

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const pinned = new Set(pinnedProjectIds);
  return {
    attention,
    running,
    pinnedThreads,
    pinnedProjects: pinnedProjectIds.flatMap((id) => projectsById.get(id) ?? []),
    recent,
    projects: projects
      .filter((project) => !pinned.has(project.id))
      .sort((a, b) => score(projectKey(b.id)) - score(projectKey(a.id))),
  };
}

export function rank<T>(
  candidates: readonly T[],
  query: string,
  fields: (candidate: T) => readonly string[],
  key: (candidate: T) => string,
  usage: Record<string, Usage>,
  now: number,
  limit = 30,
): T[] {
  return candidates
    .flatMap((candidate) => {
      const score = matchScore(query, fields(candidate));
      if (score === null) return [];
      return [{ candidate, score: score + Math.min(frecency(usage[key(candidate)], now) / 20, 40) }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
