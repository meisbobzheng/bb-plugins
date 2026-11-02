import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import {
  experimental_useSidebarThreads,
  useBbNavigate,
  useSettings,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatuses,
  type PluginSidebarThreadRowStatus,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { ChevronRight, Pin, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeySet, useNow, useStableCallback } from "./hooks";
import {
  PREVIEW_LIMIT,
  buildSidebar,
  groupView,
  relativeTime,
  sharesEnvironment,
  toggleKey,
  type Density,
  type ThreadGroup,
} from "./model";
import { ThreadRow, iconButtonClass } from "./ThreadRow";

const TICK_MS = 30_000;

interface ListState {
  activeThreadId: string | null;
  density: Density;
  touch: boolean;
  showHost: boolean;
  now: number;
  rowStatuses: ReadonlyMap<string, PluginSidebarThreadRowStatus>;
  draftIds: ReadonlySet<string>;
  onNavigate(): void;
}

interface SectionProps {
  group: ThreadGroup;
  title: string;
  icon?: ReactNode;
  current?: boolean;
  limit: number;
  collapsed: boolean;
  showAll: boolean;
  ctx: ListState;
  onToggleCollapsed(key: string): void;
  onToggleShowAll(key: string): void;
  onNewThread?: () => void;
}

function Section({
  group,
  title,
  icon,
  current = false,
  limit,
  collapsed,
  showAll,
  ctx,
  onToggleCollapsed,
  onToggleShowAll,
  onNewThread,
}: SectionProps) {
  const titleId = useId();
  const view = groupView(group, { collapsed, showAll, activeThreadId: ctx.activeThreadId, limit });
  const count = group.needsInput;
  return (
    <section aria-labelledby={titleId} className="flex flex-col">
      <div className="group/header sticky top-0 z-10 flex items-center gap-0.5 bg-sidebar pr-1">
        <button
          type="button"
          data-vim-item=""
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapsed(group.key)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
            current ? "text-foreground" : "text-muted-foreground",
            ctx.touch ? "h-10 text-sm" : "h-7",
          )}
        >
          <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")} />
          {icon}
          <span id={titleId} className="truncate">
            {title}
          </span>
          {count > 0 ? (
            <>
              <span
                aria-hidden
                className="ml-auto min-w-4 shrink-0 rounded-full bg-attention px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-attention-foreground"
              >
                {count}
              </span>
              <span className="sr-only">, {count} waiting for input</span>
            </>
          ) : null}
        </button>
        {onNewThread === undefined ? null : (
          <button
            type="button"
            aria-label={`New thread in ${title}`}
            title={`New thread in ${title}`}
            onClick={onNewThread}
            className={cn(
              iconButtonClass(ctx.touch),
              !ctx.touch && "opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100",
            )}
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      {view.trees.length > 0 ? (
        <ul className="mt-px flex flex-col gap-px">
          {view.trees.flatMap((tree) =>
            [tree.thread, ...tree.children].map((thread) => (
              <li key={thread.id}>
                <ThreadRow
                  thread={thread}
                  time={relativeTime(thread.updatedAt, ctx.now)}
                  active={thread.id === ctx.activeThreadId}
                  nested={thread !== tree.thread}
                  density={ctx.density}
                  touch={ctx.touch}
                  showBranch={thread === tree.thread || !sharesEnvironment(thread, tree.thread)}
                  showHost={ctx.showHost}
                  rowStatus={ctx.rowStatuses.get(thread.id) ?? null}
                  hasDraft={ctx.draftIds.has(thread.id)}
                  onNavigate={ctx.onNavigate}
                />
              </li>
            )),
          )}
        </ul>
      ) : null}
      {view.overflow > 0 ? (
        <button
          type="button"
          data-vim-item=""
          onClick={() => onToggleShowAll(group.key)}
          className={cn(
            "mt-px self-start rounded-md px-2.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
            ctx.touch ? "h-10" : "h-6",
          )}
        >
          {showAll ? "Show less" : `Show ${view.overflow} more`}
        </button>
      ) : null}
    </section>
  );
}

export function ThreadSidebar({ activeThreadId, activeProjectId, isCompactViewport, onNavigate }: PluginThreadListProps) {
  const { status, threads, projects, experimental_hosts: hosts } = experimental_useSidebarThreads();
  const { values } = useSettings();
  const navigate = useBbNavigate();
  const rowStatuses = useSidebarThreadRowStatuses();
  const draftIds = useSidebarThreadDraftIds();
  const now = useNow(TICK_MS);
  const collapsed = useKeySet("collapsed");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const afterNavigate = useStableCallback(onNavigate);
  const groups = useMemo(() => buildSidebar(threads, projects), [threads, projects]);
  const toggleShowAll = useCallback((key: string) => setExpanded((current) => toggleKey(current, key)), []);

  if (status !== "ready" && threads.length === 0) {
    return status === "error" ? <p className="px-3 py-2 text-xs text-muted-foreground">Couldn't load threads.</p> : null;
  }

  const ctx: ListState = {
    activeThreadId,
    density: values?.density === "compact" ? "compact" : "comfortable",
    touch: isCompactViewport,
    showHost: (hosts?.length ?? 0) > 1,
    now,
    rowStatuses,
    draftIds,
    onNavigate: afterNavigate,
  };
  const sectionProps = (group: ThreadGroup) => ({
    group,
    collapsed: collapsed.keys.has(group.key),
    showAll: expanded.has(group.key),
    ctx,
    onToggleCollapsed: collapsed.toggle,
    onToggleShowAll: toggleShowAll,
  });

  return (
    <nav aria-label="Threads" className="flex flex-col gap-2 px-2 pb-3">
      {groups.isEmpty ? (
        <div className="px-2 py-6 text-center">
          <p className="text-sm text-foreground">No threads yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Start one with New thread, or the + beside a project.</p>
        </div>
      ) : null}
      {groups.pinned.trees.length > 0 ? (
        <Section
          {...sectionProps(groups.pinned)}
          title="Pinned"
          icon={<Pin className="size-3 shrink-0" aria-hidden />}
          limit={Infinity}
        />
      ) : null}
      {groups.projects.map((group) => (
        <Section
          key={group.key}
          {...sectionProps(group)}
          title={group.project.name}
          current={activeThreadId === null && group.project.id === activeProjectId}
          limit={PREVIEW_LIMIT}
          onNewThread={() => {
            navigate.toCompose({ projectId: group.project.id, focusPrompt: true });
            afterNavigate();
          }}
        />
      ))}
    </nav>
  );
}
