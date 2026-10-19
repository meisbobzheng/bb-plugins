import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export function makeThread(overrides: Partial<PluginSidebarThread> & { id: string }): PluginSidebarThread {
  return {
    projectId: "proj_a",
    title: null,
    titleFallback: null,
    displayTitle: overrides.id,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/threads/${overrides.id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
    ...overrides,
  };
}

export function makeProject(id: string, name: string): PluginSidebarProject {
  return { id, name, isPersonal: false, href: `/projects/${id}`, settingsHref: `/settings/projects/${id}` };
}
