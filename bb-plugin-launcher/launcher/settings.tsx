import { experimental_ProviderIcon as ProviderIcon, useSettings } from "@get-bb/plugin-sdk/app";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Check,
  Cpu,
  ExternalLink,
  FlaskConical,
  FolderTree,
  Globe,
  Keyboard,
  Paintbrush,
  Palette,
  Puzzle,
  RefreshCcw,
  Server,
  Settings,
  Smartphone,
  SlidersHorizontal,
  Sparkles,
  Store,
  Variable,
} from "lucide-react";
import { toast } from "sonner";
import { Toggle } from "./badges";
import { useLauncher, type LauncherContextValue } from "./context";
import { useAsync, type AppConfig } from "./data";
import { rank } from "./rank";
import { Results } from "./Results";
import type { Item, Section } from "./types";

type GeneralSettings = AppConfig["generalSettings"];
type BooleanSettingKey = {
  [Key in keyof GeneralSettings]-?: GeneralSettings[Key] extends boolean | undefined ? Key : never;
}[keyof GeneralSettings];

const GENERAL_TOGGLES: ReadonlyArray<readonly [BooleanSettingKey, string, string]> = [
  ["showKeyboardHints", "Show keyboard hints", "Show shortcut hints next to buttons and menu items."],
  ["streamerMode", "Streamer mode", "Hide paths, emails, and other personal details on screen."],
  ["confirmThreadArchive", "Confirm before archiving", "Ask before archiving a thread."],
  ["steerActiveThreadOnEnter", "Enter steers a running thread", "Send to a busy thread right away instead of queueing."],
  ["showGitChanges", "Show git changes", "Show changed files for each thread's workspace."],
  ["keepHistoryAfterContextClear", "Keep history after clearing context", "Keep earlier messages visible after a context clear."],
  ["allowFastServiceTier", "Allow fast service tier", "Let threads pick a provider's faster, pricier tier."],
  ["showDiagnosticEvents", "Show diagnostic events", "Show low-level provider events in the timeline."],
];

const SETTINGS_SECTIONS: ReadonlyArray<readonly [string, string, LucideIcon]> = [
  ["general", "General", Settings],
  ["providers", "Providers", Bot],
  ["ai-services", "AI services", Sparkles],
  ["appearance", "Appearance", Paintbrush],
  ["keyboard", "Keyboard", Keyboard],
  ["browser", "Browser", Globe],
  ["files", "Files", FolderTree],
  ["projects", "Projects", FolderTree],
  ["machines", "Machines", Server],
  ["mobile", "Mobile", Smartphone],
  ["environment-variables", "Environment variables", Variable],
  ["updates", "Updates", RefreshCcw],
  ["plugins", "Plugins", Puzzle],
  ["marketplaces", "Marketplaces", Store],
  ["experiments", "Experiments", FlaskConical],
];

const BUILT_IN_THEMES: ReadonlyArray<readonly [string, string, string]> = [
  ["default", "Default", "The standard bb look"],
  ["nord", "Nord", "Cool, muted arctic blues"],
  ["dracula", "Dracula", "Dark, high-contrast purple and pink"],
  ["solarized", "Solarized", "Balanced light and dark"],
  ["gruvbox", "Gruvbox", "Warm retro earth tones"],
  ["catppuccin", "Catppuccin", "Soothing pastel"],
];

const icon = (Glyph: LucideIcon) => <Glyph className="size-4 text-muted-foreground" aria-hidden />;
const settingKey = (id: string) => `setting:${id}`;

export function settingLinkItems(ctx: LauncherContextValue): Item[] {
  return SETTINGS_SECTIONS.map(([slug, label, Glyph]) => ({
    id: settingKey(`link:${slug}`),
    title: `${label} settings`,
    terms: [`${label} settings`, slug, "preferences"],
    icon: icon(Glyph),
    usageKey: settingKey(`link:${slug}`),
    actions: [
      { id: "open", title: "Open settings", icon: ExternalLink, run: () => ctx.controls.goTo(`/settings/${slug}`) },
    ],
  }));
}

export function generalToggleItems(ctx: LauncherContextValue): Item[] {
  const general = ctx.config.data?.generalSettings;
  if (general === undefined) return [];
  return GENERAL_TOGGLES.map(([key, label, description]) => {
    const on = general[key] === true;
    return {
      id: settingKey(key),
      title: label,
      subtitle: description,
      terms: [label, description],
      icon: icon(SlidersHorizontal),
      accessory: <Toggle on={on} />,
      usageKey: settingKey(key),
      actions: [
        {
          id: "toggle",
          title: on ? "Turn off" : "Turn on",
          icon: Check,
          keepOpen: true,
          run: async () => {
            const next: GeneralSettings = { ...general };
            next[key] = !on;
            await ctx.sdk.system.updateGeneralSettings(next);
            toast.success(`${label} ${on ? "off" : "on"}`);
            ctx.config.reload();
          },
        },
      ],
    };
  });
}

function launcherSettingItems(ctx: LauncherContextValue, values: Record<string, unknown> | undefined): Item[] {
  const toggles: ReadonlyArray<readonly [string, string, string]> = [
    ["replaceShortcut", "Open launcher with ⌘K", "Use ⌘K for this launcher instead of bb's quick palette."],
    ["showPreview", "Show launcher preview", "Show details beside the selected result."],
  ];
  return toggles.map(([key, label, description]) => {
    const on = values?.[key] !== false;
    return {
      id: settingKey(`launcher:${key}`),
      title: label,
      subtitle: description,
      terms: [label, description, "launcher"],
      icon: icon(SlidersHorizontal),
      accessory: <Toggle on={on} />,
      actions: [
        {
          id: "toggle",
          title: on ? "Turn off" : "Turn on",
          icon: Check,
          keepOpen: true,
          run: () => ctx.sdk.plugins.updateSettings({ pluginId: ctx.pluginId, values: { [key]: !on } }).then(() => undefined),
        },
      ],
    };
  });
}

function filtered(ctx: LauncherContextValue, query: string, items: Item[]): Item[] {
  return rank(items, query, (item) => item.terms ?? [], (item) => item.usageKey ?? item.id, ctx.state.usage, ctx.now, 200);
}

export function SettingsPage({ query, showPreview }: { query: string; showPreview: boolean }) {
  const ctx = useLauncher();
  const { values } = useSettings();
  const pages: Item[] = [
    {
      id: "page:themes",
      title: "Theme…",
      terms: ["Theme", "appearance", "colors"],
      icon: icon(Palette),
      actions: [{ id: "open", title: "Choose theme", icon: Palette, keepOpen: true, run: () => ctx.controls.push({ kind: "themes" }) }],
    },
    {
      id: "page:providers",
      title: "Default agent…",
      terms: ["Default agent", "provider", "model"],
      icon: icon(Cpu),
      actions: [{ id: "open", title: "Choose agent", icon: Cpu, keepOpen: true, run: () => ctx.controls.push({ kind: "providers" }) }],
    },
  ];
  const sections: Section[] = [
    { title: "General", items: filtered(ctx, query, [...pages, ...generalToggleItems(ctx)]) },
    { title: "Launcher", items: filtered(ctx, query, launcherSettingItems(ctx, values)) },
    { title: "Open settings", items: filtered(ctx, query, settingLinkItems(ctx)) },
  ];
  return <Results sections={sections} query={query} showPreview={showPreview} emptyText={ctx.config.data ? "No settings match" : "Loading settings…"} />;
}

export function ThemesPage({ query, showPreview }: { query: string; showPreview: boolean }) {
  const ctx = useLauncher();
  const catalog = useAsync((signal) => ctx.sdk.theme.catalog({ signal }), [ctx.sdk]);
  const active = catalog.data?.active.themeId;
  const themes: ReadonlyArray<readonly [string, string, string]> = [
    ...BUILT_IN_THEMES,
    ...(catalog.data?.custom ?? []).map((name) => [name, name, "Custom theme"] as const),
    ...(catalog.data?.plugins ?? []).map(
      (theme) =>
        [
          theme.id.startsWith("plugin:") ? theme.id : `plugin:${theme.pluginId}:${theme.id}`,
          theme.name,
          theme.description ?? `From ${theme.pluginId}`,
        ] as const,
    ),
  ];
  const items: Item[] = themes.map(([id, name, description]) => ({
    id: `theme:${id}`,
    title: name,
    subtitle: description,
    terms: [name, description],
    icon: id === active ? <Check className="size-4" /> : icon(Palette),
    actions: [
      {
        id: "apply",
        title: "Apply theme",
        icon: Palette,
        keepOpen: true,
        run: async () => {
          await ctx.sdk.theme.set(id);
          catalog.reload();
        },
      },
    ],
  }));
  return <Results sections={[{ title: "Themes", items: filtered(ctx, query, items) }]} query={query} showPreview={showPreview} />;
}

export function ProvidersPage({ query, showPreview }: { query: string; showPreview: boolean }) {
  const ctx = useLauncher();
  const general = ctx.config.data?.generalSettings;
  const items: Item[] = [...ctx.providers.values()].map((provider) => ({
    id: `provider:${provider.id}`,
    title: provider.displayName,
    subtitle: provider.available ? undefined : "Unavailable",
    terms: [provider.displayName, provider.id],
    icon: <ProviderIcon providerKind="agent" provider={provider} className="size-4" aria-hidden />,
    accessory: general?.defaultProviderId === provider.id ? <Check className="size-4" aria-label="Default" /> : null,
    actions: [
      {
        id: "default",
        title: "Make default",
        icon: Check,
        keepOpen: true,
        run: async () => {
          if (general === undefined) return;
          await ctx.sdk.system.updateGeneralSettings({ ...general, defaultProviderId: provider.id });
          toast.success(`${provider.displayName} is now the default agent`);
          ctx.config.reload();
        },
      },
    ],
  }));
  return <Results sections={[{ title: "Agents", items: filtered(ctx, query, items) }]} query={query} showPreview={showPreview} />;
}
