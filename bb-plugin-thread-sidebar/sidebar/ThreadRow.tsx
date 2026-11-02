import { memo, useMemo, useState } from "react";
import {
  ThreadTitle,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useSidebarThreadSplit,
  experimental_useThreadActions,
  useSidebarThreadShortcut,
  type PluginSidebarThread,
  type PluginSidebarThreadRowStatus,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { Archive, Ellipsis, GitBranch, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { isBusy, rowMeta, threadStatus, type Density, type ThreadStatus } from "./model";

const ARCHIVE_KEYS = ["bb--core/archive"];

const PILLS: Partial<Record<ThreadStatus, { label: string; className: string }>> = {
  input: { label: "Needs input", className: "bg-attention text-attention-foreground" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive-text" },
  working: { label: "Working", className: "bg-state-hover text-foreground" },
  plan: { label: "Plan", className: "bg-state-hover text-foreground" },
  "plan-ready": { label: "Plan ready", className: "bg-success/15 text-success" },
};

export function iconButtonClass(touch: boolean): string {
  return cn(
    "flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
    touch ? "size-9" : "size-6",
  );
}

export function actionTarget(thread: PluginSidebarThread): PluginThreadActionTarget {
  const environment = thread.environment;
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: environment?.id ? { id: environment.id, path: environment.path } : null,
  };
}

function StatusMark({ status }: { status: ThreadStatus }) {
  if (status === "unread") return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />;
  const pill = PILLS[status];
  if (pill === undefined) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium leading-none",
        pill.className,
      )}
    >
      {status === "working" || status === "plan" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-success" />
      ) : null}
      {pill.label}
    </span>
  );
}

function ArchiveButton({ target }: { target: PluginThreadActionTarget }) {
  const [entry] = experimental_useThreadActions(target, { keys: ARCHIVE_KEYS });
  if (entry === undefined || entry.action.disabled) return null;
  return (
    <button
      type="button"
      aria-label={entry.action.label}
      title={entry.action.label}
      onClick={() => void entry.action.run()}
      className={iconButtonClass(false)}
    >
      <Archive className="size-3.5" aria-hidden />
    </button>
  );
}

interface RowActionsProps {
  target: PluginThreadActionTarget;
  touch: boolean;
  onOpenChange(open: boolean): void;
}

function RowActions({ target, touch, onOpenChange }: RowActionsProps) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 pr-1">
      {touch ? null : <ArchiveButton target={target} />}
      <ThreadActionsMenu
        thread={target}
        onOpenChange={onOpenChange}
        align="start"
        trigger={(props) => (
          <button
            type="button"
            {...props}
            aria-label="Thread actions"
            className={cn(props.className, iconButtonClass(touch))}
          >
            <Ellipsis className="size-3.5" aria-hidden />
          </button>
        )}
      />
    </span>
  );
}

export interface ThreadRowProps {
  thread: PluginSidebarThread;
  time: string;
  active: boolean;
  nested: boolean;
  density: Density;
  touch: boolean;
  showBranch: boolean;
  showHost: boolean;
  rowStatus: PluginSidebarThreadRowStatus | null;
  hasDraft: boolean;
  onNavigate(): void;
}

export const ThreadRow = memo(function ThreadRow({
  thread,
  time,
  active,
  nested,
  density,
  touch,
  showBranch,
  showHost,
  rowStatus,
  hasDraft,
  onNavigate,
}: ThreadRowProps) {
  const status = threadStatus(thread);
  const meta = density === "comfortable" ? rowMeta(thread, { branch: showBranch, host: showHost }) : null;
  const target = useMemo(() => actionTarget(thread), [thread]);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const { splitProps } = experimental_useSidebarThreadSplit(thread.id);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const engaged = hovered || menuOpen;
  const label = [thread.displayTitle, thread.indicatorLabel].filter(Boolean).join(", ");

  return (
    <ThreadActionsContextMenu thread={target}>
      <div
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false);
        }}
        className={cn(
          "relative flex items-center rounded-md transition-colors",
          active ? "bg-state-active" : status === "input" ? "bg-attention/10 hover:bg-attention/15" : "hover:bg-state-hover",
        )}
      >
        {status === "input" ? <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-attention" /> : null}
        {nested ? <span aria-hidden className="absolute inset-y-0 left-3.5 w-px bg-border" /> : null}
        <a
          href={thread.href}
          draggable={false}
          {...splitProps}
          data-vim-item=""
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          aria-current={active ? "page" : undefined}
          aria-label={label}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
          onClick={onNavigate}
          className={cn(
            "flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-md pl-2.5 pr-2 outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
            density === "compact" ? "py-1" : "py-1.5",
            nested && "pl-7",
            touch && "min-h-11",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusMark status={status} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                status === "idle" ? "text-sidebar-foreground" : "font-medium text-foreground",
              )}
            >
              <ThreadTitle threadId={thread.id} />
            </span>
            {rowStatus !== null || hasDraft ? (
              <ThreadStatusGlyph
                indicator={hasDraft ? (isBusy(thread) ? "working-draft" : "draft") : "none"}
                rowStatus={rowStatus}
                size="compact"
              />
            ) : null}
            {shortcut !== null ? (
              <kbd className="shrink-0 rounded-sm bg-state-hover px-1.5 py-0.5 font-sans text-xs leading-none tabular-nums text-subtle-foreground">
                {shortcut.label}
              </kbd>
            ) : touch || !engaged ? (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{time}</span>
            ) : null}
          </span>
          {meta !== null ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              {meta.branch !== null ? (
                <>
                  <GitBranch className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{meta.branch}</span>
                </>
              ) : null}
              {meta.host !== null ? (
                <>
                  <Server className={cn("size-3 shrink-0", meta.branch !== null && "ml-1.5")} aria-hidden />
                  <span className="truncate">{meta.host}</span>
                </>
              ) : null}
            </span>
          ) : null}
        </a>
        {touch || engaged ? <RowActions target={target} touch={touch} onOpenChange={setMenuOpen} /> : null}
      </div>
    </ThreadActionsContextMenu>
  );
});
