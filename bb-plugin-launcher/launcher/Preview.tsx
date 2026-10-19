import type { ReactNode } from "react";
import {
  ThreadTitle,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useSidebarThreadPullRequest as useSidebarThreadPullRequest,
} from "@get-bb/plugin-sdk/app";
import { useLauncher } from "./context";
import { useAsync, useDebounced, type OutlineItem } from "./data";
import { ProjectIcon, ThreadIcon, relativeTime } from "./items";
import { PluginIcon, pluginStatusLabel } from "./plugins";
import { isRunning, needsAttention, visibleThreads } from "./rank";
import type { Preview } from "./types";

const OUTLINE_LIMIT = 6;
const outlineCache = new Map<string, readonly OutlineItem[]>();

function Facts({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([label, value]) =>
        value === null || value === undefined || value === "" ? null : (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate text-foreground">{value}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

function Heading({ icon, title, detail }: { icon: ReactNode; title: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-medium leading-snug text-foreground">{title}</div>
        {detail ? <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div> : null}
      </div>
    </div>
  );
}

function useOutline(threadId: string): readonly OutlineItem[] | undefined {
  const { sdk } = useLauncher();
  const settledId = useDebounced(threadId, 120);
  const { data } = useAsync(
    async (signal) => {
      const { items } = await sdk.threads.conversationOutline({ threadId: settledId, signal });
      const recent = items.slice(-OUTLINE_LIMIT);
      outlineCache.set(settledId, recent);
      return recent;
    },
    [sdk, settledId],
  );
  return outlineCache.get(threadId) ?? (settledId === threadId ? data : undefined);
}

function Conversation({ threadId }: { threadId: string }) {
  const outline = useOutline(threadId);
  if (outline === undefined) return <p className="text-xs text-muted-foreground">Loading conversation…</p>;
  if (outline.length === 0) return <p className="text-xs text-muted-foreground">No messages yet.</p>;
  return (
    <ol className="space-y-2.5">
      {outline.map((item) => (
        <li key={item.id} className="text-xs">
          <div className="mb-0.5 font-medium text-muted-foreground">
            {item.role === "user" ? "You" : "Agent"}
          </div>
          <p className="line-clamp-3 whitespace-pre-line break-words text-foreground">{item.preview}</p>
        </li>
      ))}
    </ol>
  );
}

function ThreadPreview({ threadId }: { threadId: string }) {
  const ctx = useLauncher();
  const { pullRequest } = useSidebarThreadPullRequest(threadId);
  const thread = ctx.threads.find((candidate) => candidate.id === threadId);
  if (thread === undefined) return null;
  const environment = thread.environment;
  return (
    <div className="space-y-4 p-4">
      <Heading
        icon={<ThreadIcon thread={thread} ctx={ctx} />}
        title={<ThreadTitle threadId={thread.id} />}
        detail={thread.indicatorLabel ?? thread.status}
      />
      <Facts
        rows={[
          ["Project", ctx.projectsById.get(thread.projectId)?.name],
          ["Branch", environment?.branchName],
          ["Workspace", environment?.isWorktree ? `${environment.name ?? "worktree"} (worktree)` : environment?.name],
          ["Machine", thread.host?.name],
          ["Agent", ctx.providers.get(thread.providerId)?.displayName ?? thread.providerId],
          ["Pull request", pullRequest ? `#${pullRequest.number} ${pullRequest.title}` : null],
          ["Updated", `${relativeTime(thread.updatedAt, ctx.now)} ago`],
          ["Created", new Date(thread.createdAt).toLocaleString()],
        ]}
      />
      <div className="border-t border-border pt-3">
        <Conversation threadId={thread.id} />
      </div>
    </div>
  );
}

function ProjectPreview({ projectId }: { projectId: string }) {
  const ctx = useLauncher();
  const project = ctx.projectsById.get(projectId);
  if (project === undefined) return null;
  const threads = visibleThreads(ctx.threads)
    .filter((thread) => thread.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="space-y-4 p-4">
      <Heading
        icon={<ProjectIcon project={project} />}
        title={project.name}
        detail={ctx.state.pinnedProjectIds.includes(projectId) ? "Pinned project" : "Project"}
      />
      <Facts
        rows={[
          ["Threads", String(threads.length)],
          ["Running", String(threads.filter(isRunning).length)],
          ["Need attention", String(threads.filter(needsAttention).length)],
        ]}
      />
      {threads.length > 0 ? (
        <ul className="space-y-1.5 border-t border-border pt-3">
          {threads.slice(0, 8).map((thread) => (
            <li key={thread.id} className="flex items-center gap-2 text-xs">
              <ThreadStatusGlyph indicator={thread.indicator} size="compact" />
              <span className="min-w-0 flex-1 truncate text-foreground">{thread.displayTitle}</span>
              <span className="text-muted-foreground">{relativeTime(thread.updatedAt, ctx.now)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PreviewPane({ preview }: { preview: Preview }) {
  switch (preview.kind) {
    case "thread":
      return <ThreadPreview threadId={preview.threadId} />;
    case "project":
      return <ProjectPreview projectId={preview.projectId} />;
    case "plugin": {
      const { plugin } = preview;
      return (
        <div className="space-y-4 p-4">
          <Heading
            icon={<PluginIcon plugin={plugin} />}
            title={plugin.name ?? plugin.id}
            detail={pluginStatusLabel(plugin)}
          />
          {plugin.description ? <p className="text-xs text-foreground">{plugin.description}</p> : null}
          <Facts
            rows={[
              ["ID", plugin.id],
              ["Version", plugin.version],
              ["Source", plugin.sourceDisplay],
              ["Command", plugin.cliCommand ? `bb ${plugin.cliCommand.name}` : null],
              ["Settings", plugin.hasSettings ? "Yes" : "None"],
              ["Detail", plugin.statusDetail],
            ]}
          />
        </div>
      );
    }
    case "note":
      return (
        <div className="space-y-2 p-4">
          <div className="text-sm font-medium text-foreground">{preview.title}</div>
          <p className="text-xs text-muted-foreground">{preview.body}</p>
        </div>
      );
  }
}
