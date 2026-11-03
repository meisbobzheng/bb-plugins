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
import { specCitation, useSpecClause, type SpecHit } from "./specs";
import { telecomKind } from "./telecom";
import type { Item } from "./types";

const OUTLINE_LIMIT = 6;
const SETTLE_MS = 120;
const SPEC_PREVIEW_CHARS = 1_500;
const SPEC_PREVIEW_CHILDREN = 8;
const outlineCache = new Map<string, readonly OutlineItem[]>();

function Facts({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([label, value]) =>
        value === null || value === undefined || value === "" ? null : (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate text-foreground" title={typeof value === "string" ? value : undefined}>
              {value}
            </dd>
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

function Conversation({ threadId, settled }: { threadId: string; settled: boolean }) {
  const { sdk } = useLauncher();
  const { data, error } = useAsync(
    async (signal) => {
      if (!settled) return undefined;
      const { items } = await sdk.threads.conversationOutline({ threadId, signal });
      const recent = items.slice(-OUTLINE_LIMIT);
      outlineCache.set(threadId, recent);
      return recent;
    },
    [sdk, threadId, settled],
  );
  const outline = data ?? outlineCache.get(threadId);
  if (outline === undefined) {
    return (
      <p className="text-xs text-muted-foreground">
        {error === null ? "Loading conversation…" : "Could not load messages."}
      </p>
    );
  }
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
  const settledId = useDebounced(threadId, SETTLE_MS);
  const settled = settledId === threadId;
  const { pullRequest } = useSidebarThreadPullRequest(settledId);
  const thread = ctx.threadsById.get(threadId);
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
          ["Pull request", settled && pullRequest ? `#${pullRequest.number} ${pullRequest.title}` : null],
          ["Updated", `${relativeTime(thread.updatedAt, ctx.now)} ago`],
          ["Created", new Date(thread.createdAt).toLocaleString()],
        ]}
      />
      <div className="border-t border-border pt-3">
        <Conversation key={thread.id} threadId={thread.id} settled={settled} />
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

function SpecPreview({ icon, hit }: { icon: ReactNode; hit: SpecHit }) {
  const settled = useDebounced(`${hit.spec} ${hit.clause}`, SETTLE_MS) === `${hit.spec} ${hit.clause}`;
  const clause = useSpecClause(hit, settled);
  const body = clause?.body ?? "";
  return (
    <div className="space-y-4 p-4">
      <Heading icon={icon} title={`${specCitation(hit)} ${hit.title}`} detail={clause?.spec.title ?? `${hit.kind} ${hit.spec} V${hit.version}`} />
      <Facts
        rows={[
          ["Version", clause === undefined || clause === null ? `V${hit.version}` : `V${clause.spec.version} (Release ${clause.spec.release})`],
          ["Parent", clause?.parent ? `§${clause.parent.clause} ${clause.parent.title}` : null],
          ["Subclauses", clause && clause.children.length > 0 ? String(clause.children.length) : null],
        ]}
      />
      {clause === undefined ? (
        <p className="text-xs text-muted-foreground">Loading clause…</p>
      ) : clause === null ? (
        <p className="text-xs text-muted-foreground">This clause is no longer indexed.</p>
      ) : (
        <>
          <p className="whitespace-pre-line text-xs leading-relaxed text-foreground">
            {body === "" ? "This clause has no text of its own." : body.length > SPEC_PREVIEW_CHARS ? `${body.slice(0, SPEC_PREVIEW_CHARS)}…` : body}
          </p>
          {clause.children.length === 0 ? null : (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {clause.children.slice(0, SPEC_PREVIEW_CHILDREN).map((child) => (
                <li key={child.clause} className="truncate">{`§${child.clause} ${child.title}`}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function PreviewPane({ item }: { item: Item }) {
  const { preview } = item;
  if (preview === undefined) {
    return (
      <div className="p-4">
        <Heading icon={item.icon} title={item.title} detail={item.subtitle} />
      </div>
    );
  }
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
    case "telecom": {
      const { hit } = preview;
      return (
        <div className="space-y-4 p-4">
          <Heading icon={item.icon} title={hit.title} detail={hit.name === hit.title ? telecomKind(hit) : hit.name} />
          {hit.summary ? <p className="text-xs text-foreground">{hit.summary}</p> : null}
          <Facts
            rows={[
              ["Kind", telecomKind(hit)],
              ["Flow", hit.flow],
              ["Spec", hit.spec],
              ["ID", hit.id],
            ]}
          />
        </div>
      );
    }
    case "spec":
      return <SpecPreview icon={item.icon} hit={preview.hit} />;
    case "note":
      return (
        <div className="space-y-2 p-4">
          <div className="text-sm font-medium text-foreground">{preview.title}</div>
          <p className="text-xs text-muted-foreground">{preview.body}</p>
        </div>
      );
  }
}
