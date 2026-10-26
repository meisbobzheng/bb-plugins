import { useEffect, useState } from "react";
import { experimental_usePluginId, useBbContext, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";

const VISIT_LIMIT = 20;

export function recordVisit(visits: readonly string[], threadId: string): string[] {
  return [threadId, ...visits.filter((id) => id !== threadId)].slice(0, VISIT_LIMIT);
}

export function parseVisits(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, VISIT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function previousThread(
  visits: readonly string[],
  threads: readonly PluginSidebarThread[],
  currentThreadId: string | null,
): PluginSidebarThread | undefined {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  for (const id of visits) {
    if (id === currentThreadId) continue;
    const thread = byId.get(id);
    if (thread !== undefined && !thread.isArchived) return thread;
  }
  return undefined;
}

export function useThreadVisits(): readonly string[] {
  const { threadId } = useBbContext();
  const storageKey = `${experimental_usePluginId()}:visits`;
  const [visits, setVisits] = useState(() => parseVisits(localStorage.getItem(storageKey)));
  useEffect(() => {
    if (threadId === null) return;
    setVisits((current) => {
      if (current[0] === threadId) return current;
      const next = recordVisit(current, threadId);
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [threadId, storageKey]);
  return visits;
}
