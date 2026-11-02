import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

type Thread = PluginSidebarThread;
type Project = PluginSidebarProject;

export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

export const PINNED_KEY = "pinned";
export const PREVIEW_LIMIT = 8;
export const projectKey = (id: string) => `project:${id}`;

export type ThreadStatus = "input" | "failed" | "plan" | "plan-ready" | "working" | "unread" | "idle";

const BUSY_STATUSES = new Set<string>(["active", "starting", "pending", "stopping"]);
const WORKING_INDICATORS = new Set<string>(["runtime", "workflow", "background-agent", "background-command", "goal"]);

export function isBusy(thread: Thread): boolean {
  return BUSY_STATUSES.has(thread.status);
}

export function threadStatus(thread: Thread): ThreadStatus {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "input";
  if (thread.indicator === "unread-error" || thread.indicator === "queued-failed") return "failed";
  if (thread.indicator === "plan-mode") return isBusy(thread) ? "plan" : "plan-ready";
  if (isBusy(thread) || WORKING_INDICATORS.has(thread.indicator)) return "working";
  if (thread.indicator === "unread-success") return "unread";
  return "idle";
}

export function needsInput(thread: Thread): boolean {
  return threadStatus(thread) === "input";
}

function tier(thread: Thread): number {
  const status = threadStatus(thread);
  if (status === "input") return 0;
  return status === "working" || status === "plan" ? 1 : 2;
}

export interface ThreadTree {
  thread: Thread;
  children: readonly Thread[];
  tier: number;
  updatedAt: number;
}

export interface ThreadGroup {
  key: string;
  trees: readonly ThreadTree[];
  needsInput: number;
}

export interface ProjectGroup extends ThreadGroup {
  project: Project;
}

export interface SidebarGroups {
  pinned: ThreadGroup;
  projects: readonly ProjectGroup[];
  isEmpty: boolean;
}

function byActivity(a: Thread, b: Thread): number {
  return tier(a) - tier(b) || b.updatedAt - a.updatedAt;
}

function byTreeActivity(a: ThreadTree, b: ThreadTree): number {
  return a.tier - b.tier || b.updatedAt - a.updatedAt;
}

export function byPinOrder(a: ThreadTree, b: ThreadTree): number {
  const keyA = a.thread.pinSortKey;
  const keyB = b.thread.pinSortKey;
  if (keyA !== keyB) {
    if (keyA === null) return 1;
    if (keyB === null) return -1;
    return keyA < keyB ? -1 : 1;
  }
  return (a.thread.pinnedAt ?? 0) - (b.thread.pinnedAt ?? 0);
}

function rootOf(thread: Thread, byId: ReadonlyMap<string, Thread>): Thread {
  const seen = new Set<string>();
  let root = thread;
  while (root.parentThreadId !== null && !seen.has(root.id)) {
    seen.add(root.id);
    const parent = byId.get(root.parentThreadId);
    if (parent === undefined) break;
    root = parent;
  }
  return root;
}

export function buildTrees(threads: readonly Thread[]): ThreadTree[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const roots: Thread[] = [];
  const childrenOf = new Map<string, Thread[]>();
  for (const thread of threads) {
    const root = rootOf(thread, byId);
    if (root === thread) roots.push(thread);
    else if (childrenOf.has(root.id)) childrenOf.get(root.id)!.push(thread);
    else childrenOf.set(root.id, [thread]);
  }
  return roots.map((thread) => {
    const children = (childrenOf.get(thread.id) ?? []).sort(byActivity);
    return {
      thread,
      children,
      tier: Math.min(tier(thread), ...children.map(tier)),
      updatedAt: Math.max(thread.updatedAt, ...children.map((child) => child.updatedAt)),
    };
  });
}

function treeThreads(tree: ThreadTree): Thread[] {
  return [tree.thread, ...tree.children];
}

function group(key: string, trees: ThreadTree[]): ThreadGroup {
  return { key, trees, needsInput: trees.flatMap(treeThreads).filter(needsInput).length };
}

export function buildSidebar(threads: readonly Thread[], projects: readonly Project[]): SidebarGroups {
  const pinned: Thread[] = [];
  const byProject = new Map<string, Thread[]>(projects.map((project) => [project.id, []]));
  for (const thread of threads) {
    if (thread.isArchived || thread.isHidden) continue;
    if (thread.isPinned) pinned.push(thread);
    else byProject.get(thread.projectId)?.push(thread);
  }
  const projectGroups = projects.map((project) => ({
    project,
    ...group(projectKey(project.id), buildTrees(byProject.get(project.id)!).sort(byTreeActivity)),
  }));
  return {
    pinned: group(PINNED_KEY, buildTrees(pinned).sort(byPinOrder)),
    projects: projectGroups,
    isEmpty: pinned.length === 0 && projectGroups.every(({ trees }) => trees.length === 0),
  };
}

export interface GroupViewOptions {
  collapsed: boolean;
  showAll: boolean;
  activeThreadId: string | null;
  limit: number;
}

export interface GroupView {
  trees: readonly ThreadTree[];
  overflow: number;
}

export function groupView(group: ThreadGroup, { collapsed, showAll, activeThreadId, limit }: GroupViewOptions): GroupView {
  if (collapsed) {
    const trees = group.trees
      .flatMap(treeThreads)
      .filter((thread) => needsInput(thread) || thread.id === activeThreadId)
      .map((thread) => ({ thread, children: [], tier: tier(thread), updatedAt: thread.updatedAt }));
    return { trees, overflow: 0 };
  }
  let previewed = 0;
  const preview = group.trees.filter(
    (tree) =>
      tree.tier === 0 ||
      previewed++ < limit ||
      treeThreads(tree).some((thread) => thread.id === activeThreadId),
  );
  const overflow = group.trees.length - preview.length;
  return { trees: showAll ? group.trees : preview, overflow };
}

export function sharesEnvironment(thread: Thread, other: Thread): boolean {
  return thread.environment?.id != null && thread.environment.id === other.environment?.id;
}

export function rowMeta(
  thread: Thread,
  show: { branch: boolean; host: boolean },
): { branch: string | null; host: string | null } | null {
  const branch = show.branch ? (thread.environment?.branchName ?? null) : null;
  const host = show.host ? (thread.host?.name ?? null) : null;
  return branch === null && host === null ? null : { branch, host };
}

export function relativeTime(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function toggleKey(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return next;
}

export function parseKeys(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}
