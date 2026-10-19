import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_copyToClipboard as copyToClipboard,
  useSidebarThreadRowStatus,
  type PluginSidebarProject,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import {
  Archive,
  ArrowRight,
  Copy,
  Folder,
  FolderOpen,
  Link,
  MailOpen,
  Mail,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  Send,
  Settings,
  SplitSquareHorizontal,
  Square,
  SquarePen,
  User,
} from "lucide-react";
import { toast } from "sonner";
import type { LauncherContextValue } from "./context";
import { reportError } from "./data";
import { isRunning, projectKey, threadKey } from "./rank";
import type { Action, Item, Shortcut } from "./types";

const COPY_ID_SHORTCUT: Shortcut = { key: "c", mod: true, shift: true };

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

function ThreadAccessory({ thread, now }: { thread: PluginSidebarThread; now: number }) {
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      {thread.isPinned ? <Pin className="size-3" aria-label="Pinned" /> : null}
      <ThreadStatusGlyph indicator={thread.indicator} rowStatus={rowStatus} size="compact" />
      <span className="w-7 text-right tabular-nums">{relativeTime(thread.updatedAt, now)}</span>
    </span>
  );
}

export function ThreadIcon({ thread, ctx }: { thread: PluginSidebarThread; ctx: LauncherContextValue }) {
  return (
    <ProviderIcon
      providerKind="agent"
      provider={ctx.providers.get(thread.providerId) ?? { id: thread.providerId }}
      className="size-4"
      aria-hidden
    />
  );
}

export function ProjectIcon({ project }: { project: PluginSidebarProject }) {
  const Glyph = project.isPersonal ? User : Folder;
  return <Glyph className="size-4 text-muted-foreground" aria-hidden />;
}

export function threadSubtitle(thread: PluginSidebarThread, ctx: LauncherContextValue): string {
  const project = ctx.projectsById.get(thread.projectId)?.name;
  const branch = thread.environment?.branchName;
  return [project, branch].filter(Boolean).join(" · ");
}

function copyAction(id: string, title: string, text: string, icon = Copy, shortcut?: Shortcut): Action {
  return {
    id,
    title,
    icon,
    shortcut,
    run: async () => {
      if (await copyToClipboard({ text })) toast.success("Copied to clipboard");
    },
  };
}

export function newThreadAction(ctx: LauncherContextValue, projectId: string | null, prompt = ""): Action {
  return {
    id: "compose",
    title: prompt === "" ? "New thread" : "Open in composer",
    icon: SquarePen,
    run: () =>
      ctx.navigate.toCompose({
        ...(projectId === null ? {} : { projectId }),
        ...(prompt === "" ? {} : { initialPrompt: prompt }),
        focusPrompt: true,
      }),
  };
}

export function spawnAction(ctx: LauncherContextValue, projectId: string, prompt: string): Action {
  const name = ctx.projectsById.get(projectId)?.name ?? "project";
  return {
    id: "spawn",
    title: `Start thread in ${name}`,
    icon: Send,
    run: async () => {
      const toastId = toast.loading(`Starting a thread in ${name}…`);
      try {
        const thread = await ctx.sdk.threads.spawn({
          projectId,
          environment: { type: "project-default" },
          prompt,
        });
        toast.success(`Started a thread in ${name}`, {
          id: toastId,
          action: { label: "Open", onClick: () => ctx.navigate.toThread(thread.id) },
        });
        ctx.recordUse(projectKey(projectId));
      } catch (cause) {
        toast.dismiss(toastId);
        reportError("Could not start the thread")(cause);
      }
    },
  };
}

function threadActions(thread: PluginSidebarThread, ctx: LauncherContextValue): Action[] {
  const { sdk, navigate, controls } = ctx;
  const threadId = thread.id;
  const project = ctx.projectsById.get(thread.projectId);
  const actions: Action[] = [
    { id: "open", title: "Open thread", icon: ArrowRight, run: () => navigate.toThread(threadId) },
    {
      id: "split",
      title: "Open in split",
      icon: SplitSquareHorizontal,
      shortcut: { key: "Enter", mod: true },
      run: () => navigate.toThread(threadId, { split: true }),
    },
    {
      id: "send",
      title: "Send message…",
      icon: Send,
      keepOpen: true,
      run: () =>
        controls.push({
          kind: "input",
          title: `Send to ${thread.displayTitle}`,
          placeholder: "Message",
          submitLabel: "Send",
          submit: async (text) => {
            await sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text, mentions: [] }] });
            toast.success("Message sent", {
              action: { label: "Open", onClick: () => navigate.toThread(threadId) },
            });
          },
        }),
    },
    {
      id: "rename",
      title: "Rename…",
      icon: Pencil,
      shortcut: { key: "e", mod: true },
      keepOpen: true,
      run: () =>
        controls.push(
          {
            kind: "input",
            title: "Rename thread",
            placeholder: "Thread title",
            submitLabel: "Rename to",
            submit: (title) => sdk.threads.update({ threadId, title }).then(() => undefined),
          },
          thread.title ?? "",
        ),
    },
    {
      id: "pin",
      title: thread.isPinned ? "Unpin thread" : "Pin thread",
      icon: thread.isPinned ? PinOff : Pin,
      shortcut: { key: "p", mod: true, shift: true },
      keepOpen: true,
      run: async () => {
        await (thread.isPinned ? sdk.threads.unpin({ threadId }) : sdk.threads.pin({ threadId }));
        toast.success(thread.isPinned ? "Unpinned" : "Pinned");
      },
    },
    {
      id: "read",
      title: thread.isUnread ? "Mark as read" : "Mark as unread",
      icon: thread.isUnread ? MailOpen : Mail,
      shortcut: { key: "u", mod: true, shift: true },
      keepOpen: true,
      run: async () => {
        await (thread.isUnread ? sdk.threads.markRead({ threadId }) : sdk.threads.markUnread({ threadId }));
      },
    },
  ];
  if (isRunning(thread)) {
    actions.push({
      id: "stop",
      title: "Stop thread",
      icon: Square,
      keepOpen: true,
      run: async () => {
        await sdk.threads.stop({ threadId });
        toast.success("Stopped");
      },
    });
  }
  if (project !== undefined) {
    actions.push(
      {
        id: "project",
        title: `Show ${project.name} threads`,
        icon: FolderOpen,
        keepOpen: true,
        run: () => controls.push({ kind: "project", projectId: project.id }),
      },
      { ...newThreadAction(ctx, project.id), title: `New thread in ${project.name}`, icon: MessageSquarePlus },
    );
  }
  actions.push(
    copyAction("copy-id", "Copy thread ID", threadId, Copy, COPY_ID_SHORTCUT),
    copyAction("copy-link", "Copy link", new URL(thread.href, window.location.origin).toString(), Link),
    {
      id: "archive",
      title: "Archive thread",
      icon: Archive,
      destructive: true,
      shortcut: { key: "Backspace", mod: true },
      keepOpen: true,
      run: async () => {
        await sdk.threads.archive({ threadId });
        toast.success("Archived", {
          action: {
            label: "Undo",
            onClick: () => void sdk.threads.unarchive({ threadId }).catch(reportError("Could not unarchive")),
          },
        });
      },
    },
  );
  return actions;
}

export function threadItem(thread: PluginSidebarThread, ctx: LauncherContextValue): Item {
  return {
    id: threadKey(thread.id),
    title: thread.displayTitle,
    subtitle: threadSubtitle(thread, ctx),
    icon: <ThreadIcon thread={thread} ctx={ctx} />,
    accessory: <ThreadAccessory thread={thread} now={ctx.now} />,
    preview: { kind: "thread", threadId: thread.id },
    usageKey: threadKey(thread.id),
    actions: threadActions(thread, ctx),
  };
}

export function projectItem(project: PluginSidebarProject, ctx: LauncherContextValue): Item {
  const pinned = ctx.state.pinnedProjectIds.includes(project.id);
  const count = ctx.threads.filter(
    (thread) => thread.projectId === project.id && !thread.isArchived && !thread.isHidden,
  ).length;
  return {
    id: projectKey(project.id),
    title: project.name,
    subtitle: `${count} thread${count === 1 ? "" : "s"}`,
    icon: <ProjectIcon project={project} />,
    accessory: pinned ? <Pin className="size-3 text-muted-foreground" aria-label="Pinned" /> : null,
    preview: { kind: "project", projectId: project.id },
    usageKey: projectKey(project.id),
    actions: [
      {
        id: "threads",
        title: "Show threads",
        icon: FolderOpen,
        keepOpen: true,
        run: () => ctx.controls.push({ kind: "project", projectId: project.id }),
      },
      { ...newThreadAction(ctx, project.id), shortcut: { key: "Enter", mod: true } },
      {
        id: "pin",
        title: pinned ? "Unpin project" : "Pin project",
        icon: pinned ? PinOff : Pin,
        shortcut: { key: "p", mod: true, shift: true },
        keepOpen: true,
        run: () => ctx.setProjectPinned(project.id, !pinned),
      },
      { id: "open", title: "Open project", icon: ArrowRight, run: () => ctx.navigate.toProject(project.id) },
      {
        id: "settings",
        title: "Project settings",
        icon: Settings,
        run: () => ctx.controls.goTo(project.settingsHref),
      },
      copyAction("copy-id", "Copy project ID", project.id, Copy, COPY_ID_SHORTCUT),
    ],
  };
}
